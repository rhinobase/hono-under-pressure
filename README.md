<h1 align="center"><code>🌀hono-under-pressure🌀</code></h1>

<div align="center">

[![tests](https://img.shields.io/github/actions/workflow/status/rhinobase/hono-under-pressure/test.yml)](https://github.com/rhinobase/hono-under-pressure/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/hono-under-pressure.svg)](https://npmjs.org/package/hono-under-pressure "View this project on NPM")
[![npm downloads](https://img.shields.io/npm/dm/hono-under-pressure)](https://www.npmjs.com/package/hono-under-pressure)
[![license](https://img.shields.io/npm/l/hono-under-pressure)](LICENSE)

</div>

Measure process load with automatic handling of _"Service Unavailable"_ plugin for Hono.
It can check `maxEventLoopDelay`, `maxHeapUsedBytes`, `maxRssBytes` and `maxEventLoopUtilization` values.
You can also specify a custom health check, to verify the status of
external resources.

<a name="install"></a>

## Install

```sh
# Using npm/yarn/pnpm/bun
npm add hono-under-pressure
```

<a name="usage"></a>

## Usage

Wrap the function around your server instance and the provided middlewares can be added to Hono instance to apply them.

```js
import { underPressure } from "hono-under-pressure";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();
app.get("/", (c) => {
  const isUnderPressure = c.get("isUnderPressure");
  if (isUnderPressure()) {
    // skip complex computation
  }
  return c.text("Hello Node.js!");
});

underPressure(
  (handlers) => {
    const newApp = Hono().use(...handlers);
    newApp.route("/", app);
    return serve(newApp);
  },
  {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 100000000,
    maxRssBytes: 100000000,
    maxEventLoopUtilization: 0.98,
  }
);
```

`hono-under-pressure` will automatically handle for you the `Service Unavailable` error once one of the thresholds has been reached.
You can configure the error handler by passing `pressureHandler` function.

```js
underPressure(createServer, {
  pressureHandler: () => {
    throw new HTTPException(SERVICE_UNAVAILABLE, {
      message: "Under pressure!",
    });
  },
});
```

The default value for `maxEventLoopDelay`, `maxHeapUsedBytes`, `maxRssBytes` and `maxEventLoopUtilization` is `0`.
If the value is `0` the check will not be performed.

Since [`eventLoopUtilization`](https://nodejs.org/api/perf_hooks.html#perf_hooks_performance_eventlooputilization_utilization1_utilization2) is only available in Node version 14.0.0 and 12.19.0 the check will be disabled in other versions.

#### `memoryUsage`

This plugin also exposes a function that will tell you the current values of `heapUsed`, `rssBytes`, `eventLoopDelay` and `eventLoopUtilized`.

```js
const memoryUsage = c.get("memoryUsage");
console.log(memoryUsage());
```

#### Pressure Handler

You can provide a pressure handler in the options to handle the pressure errors. The advantage is that you know why the error occurred. Moreover, the request can be handled as if nothing happened.

```js
underPressure(createServer, {
  maxHeapUsedBytes: 100000000,
  maxRssBytes: 100000000,
  pressureHandler: (c, type, value) => {
    if (type === underPressure.TYPE_HEAP_USED_BYTES) {
      console.warn(`too many heap bytes used: ${value}`);
    } else if (type === underPressure.TYPE_RSS_BYTES) {
      console.warn(`too many rss bytes used: ${value}`);
    }

    throw new HTTPException(503, { message: "out of memory" }); // if you omit this line, the request will be handled normally
  },
});
```

It is possible as well to return a Promise that will call `c.text` (or something else).

```js
underPressure(createServer, {
  maxHeapUsedBytes: 100000000,
  pressureHandler: (c, type, value) => {
    return getPromise().then(() => {
      throw new HTTPException(503, { message: "out of memory" });
    });
  },
});
```

If you don't throw a HTTPException, the request will be handled normally.

It's also possible to specify the `pressureHandler` on the route:

```js
import { underPressure } from "hono-under-pressure";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.use((c, next) => {
  c.set("pressureHandler", (c, type, value) => {
    if (type === underPressure.TYPE_HEAP_USED_BYTES) {
      console.warn(`too many heap bytes used: ${value}`);
    } else if (type === underPressure.TYPE_RSS_BYTES) {
      console.warn(`too many rss bytes used: ${value}`);
    }

    throw new HTTPException(503, { message: "out of memory" }); // if you omit this line, the request will be handled normally
  });
});

app.get("/", (c) => {
  return c.text("A");
});

underPressure(
  (handlers) => {
    const newApp = Hono().use(...handlers);
    newApp.route("/", app);
    return serve(newApp);
  },
  {
    maxHeapUsedBytes: 100000000,
    maxRssBytes: 100000000,
  }
);
```

#### Custom health checks

If needed you can pass a custom `healthCheck` property, which is an async function, and `hono-under-pressure` will allow you to check the status of other components of your service.

This function should return a promise that resolves to a boolean value or to an object. The `healthCheck` function can be called every X milliseconds, the time can be configured with the `healthCheckInterval` option.

By default when this function is supplied your service health is considered unhealthy, until it has started to return true.

```js
underPressure(createServer, {
  healthCheck: async function () {
    // do some magic to check if your db connection is healthy, etc...
    return true;
  },
  healthCheckInterval: 500,
});
```

<a name="sample-interval"></a>

#### Sample interval

You can set a custom value for sampling the metrics returned by `memoryUsage` using the `sampleInterval` option, which accepts a number that represents the interval in milliseconds.

The default value is different depending on which Node version is used. In version 8 and 10 it is `5`, while on version 11.10.0 and up it is `1000`. This difference is because from version 11.10.0 the event loop delay can be sampled with [`monitorEventLoopDelay`](https://nodejs.org/docs/latest-v12.x/api/perf_hooks.html#perf_hooks_perf_hooks_monitoreventloopdelay_options) and this allows to increase the interval value.

```js
underPressure(
  createServer,
  {
    sampleInterval: <your custom sample interval in ms>
  }
);
```

<a name="additional-information"></a>

## Additional information

<a name="set-timeout-vs-set-interval"></a>

#### `setTimeout` vs `setInterval`

Under the hood the `hono-under-pressure` uses the `setTimeout` method to perform its polling checks. The choice is based on the fact that we do not want to add additional pressure to the system.

In fact, it is known that `setInterval` will call repeatedly at the scheduled time regardless of whether the previous call ended or not, and if the server is already under load, this will likely increase the problem, because those `setInterval` calls will start piling up. `setTimeout`, on the other hand, is called only once and does not cause the mentioned problem.

One note to consider is that because the two methods are not identical, the timer function is not guaranteed to run at exactly the same rate when the system is under pressure or running a long-running process.

<a name="articles"></a>

#### Articles

These can help you understand how it can improve your Hono Nodejs server performance -

- <https://nodesource.com/blog/event-loop-utilization-nodejs/>
- <https://blog.platformatic.dev/the-nodejs-event-loop>

## Contributing

We would love to have more contributors involved!

To get started, please read our [Contributing Guide](https://github.com/rhinobase/hono-under-pressure/blob/main/CONTRIBUTING.md).

## Credits

The `hono-under-pressure` project is heavily inspired by [@fastify/under-pressure](https://github.com/fastify/under-pressure)

import {
  type EventLoopUtilization,
  type IntervalHistogram,
  monitorEventLoopDelay,
  performance,
} from "node:perf_hooks";
import type { Context, Env, Input, Next } from "hono";
import { createFactory } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type ConfigType, PressureType } from "./types";
import assert = require("node:assert");
const eventLoopUtilization = performance.eventLoopUtilization;

const SERVICE_UNAVAILABLE = 503;
const createError = (message = "Service Unavailable") =>
  new HTTPException(SERVICE_UNAVAILABLE, { message });

export function factoryWithUnderPressure<
  E extends Env = Env,
  P extends string = string,
  I extends Input = Input,
>(config: ConfigType<E, P, I> = {}) {
  const resolution = 10;
  const sampleInterval = getSampleInterval(config.sampleInterval, resolution);

  const {
    maxEventLoopDelay = 0,
    maxHeapUsedBytes = 0,
    maxRssBytes = 0,
    healthCheck = false,
    healthCheckInterval = -1,
    maxEventLoopUtilization = 0,
    pressureHandler,
    retryAfter = 10,
  } = config;

  const underPressureError = config.customError || createError(config.message);

  const statusRoute = mapExposeStatusRoute(config.exposeStatusRoute);

  const checkMaxEventLoopDelay = maxEventLoopDelay > 0;
  const checkMaxHeapUsedBytes = maxHeapUsedBytes > 0;
  const checkMaxRssBytes = maxRssBytes > 0;
  const checkMaxEventLoopUtilization = eventLoopUtilization
    ? maxEventLoopUtilization > 0
    : false;

  return createFactory({
    async initApp(app) {
      let heapUsed = 0;
      let rssBytes = 0;
      let eventLoopDelay = 0;
      let lastCheck: number;
      let histogram: IntervalHistogram;
      let elu: EventLoopUtilization;
      let eventLoopUtilized = 0;

      if (monitorEventLoopDelay) {
        histogram = monitorEventLoopDelay({ resolution });
        histogram.enable();
      } else {
        lastCheck = now();
      }

      if (eventLoopUtilization) {
        elu = eventLoopUtilization();
      }

      // Setting stats values
      app.use(async (c, next) => {
        // Memory usage
        c.set("memoryUsage", memoryUsage());

        // Is under pressure
        c.set("isUnderPressure", isUnderPressure());

        await next();
      });

      const timer = setTimeout(beginMemoryUsageUpdate, sampleInterval);
      timer.unref();

      let externalsHealthy: Record<string, unknown> | boolean = false;
      let externalHealthCheckTimer: NodeJS.Timeout;
      if (healthCheck) {
        assert(
          typeof healthCheck === "function",
          "config.healthCheck should be a function that returns a promise that resolves to true or false",
        );
        assert(
          healthCheckInterval > 0 || statusRoute,
          "config.healthCheck requires config.healthCheckInterval or config.exposeStatusRoute",
        );

        const doCheck = async () => {
          try {
            externalsHealthy = await healthCheck(app);
          } catch (error) {
            externalsHealthy = false;
            console.error(
              { error },
              "external healthCheck function supplied to `under-pressure` threw an error. setting the service status to unhealthy.",
            );
          }
        };

        await doCheck();

        if (healthCheckInterval > 0) {
          const beginCheck = async () => {
            await doCheck();
            externalHealthCheckTimer.refresh();
          };

          externalHealthCheckTimer = setTimeout(
            beginCheck,
            healthCheckInterval,
          );
          externalHealthCheckTimer.unref();
        }
      } else {
        externalsHealthy = true;
      }

      if (statusRoute) {
        app.get(statusRoute, async (c) => {
          const okResponse = { status: "ok" };

          if (healthCheck) {
            try {
              const checkResult = await healthCheck(c);

              if (!checkResult) {
                console.error("external health check failed");
                c.status(SERVICE_UNAVAILABLE);
                c.header("Retry-After", String(retryAfter));
                throw underPressureError;
              }

              return c.json(Object.assign(okResponse, checkResult));
            } catch (err) {
              console.error({ err }, "external health check failed with error");
              c.status(SERVICE_UNAVAILABLE);
              c.header("Retry-After", String(retryAfter));
              throw underPressureError;
            }
          }

          return c.json(okResponse);
        });
      }

      if (
        checkMaxEventLoopUtilization === false &&
        checkMaxEventLoopDelay === false &&
        checkMaxHeapUsedBytes === false &&
        checkMaxRssBytes === false &&
        healthCheck === false
      ) {
        return;
      }

      // TODO: Add the middleware
      fastify.addHook("onRequest", onRequest);

      function onRequest(c: Context<E, P, I>, next: Next) {
        const _pressureHandler = config.pressureHandler || pressureHandler;
        if (checkMaxEventLoopDelay && eventLoopDelay > maxEventLoopDelay) {
          handlePressure(
            _pressureHandler,
            c,
            next,
            PressureType.EVENT_LOOP_DELAY,
            eventLoopDelay,
          );
          return;
        }

        if (checkMaxHeapUsedBytes && heapUsed > maxHeapUsedBytes) {
          handlePressure(
            _pressureHandler,
            c,
            next,
            PressureType.HEAP_USED_BYTES,
            heapUsed,
          );
          return;
        }

        if (checkMaxRssBytes && rssBytes > maxRssBytes) {
          handlePressure(
            _pressureHandler,
            c,
            next,
            PressureType.RSS_BYTES,
            rssBytes,
          );
          return;
        }

        if (!externalsHealthy) {
          handlePressure(
            _pressureHandler,
            c,
            next,
            PressureType.HEALTH_CHECK,
            undefined,
          );
          return;
        }

        if (
          checkMaxEventLoopUtilization &&
          eventLoopUtilized > maxEventLoopUtilization
        ) {
          handlePressure(
            _pressureHandler,
            c,
            next,
            PressureType.EVENT_LOOP_UTILIZATION,
            eventLoopUtilized,
          );
          return;
        }

        next();
      }

      function handlePressure(
        pressureHandler: ConfigType<E, P, I>["pressureHandler"],
        c: Context<E, P, I>,
        next: Next,
        type: PressureType,
        value: number | undefined,
      ) {
        if (typeof pressureHandler === "function") {
          const result = pressureHandler(c, type, value);
          if (result instanceof Promise) {
            result.then(() => next(), next);
          } else if (result == null) {
            next();
          } else {
            c.body(result);
          }
        } else {
          c.status(SERVICE_UNAVAILABLE);
          c.header("Retry-After", String(retryAfter));
          next(underPressureError);
        }
      }

      function updateEventLoopDelay() {
        if (histogram) {
          eventLoopDelay = Math.max(0, histogram.mean / 1e6 - resolution);
          if (Number.isNaN(eventLoopDelay))
            eventLoopDelay = Number.POSITIVE_INFINITY;
          histogram.reset();
        } else {
          const toCheck = now();
          eventLoopDelay = Math.max(0, toCheck - lastCheck - sampleInterval);
          lastCheck = toCheck;
        }
      }

      function updateEventLoopUtilization() {
        if (elu) {
          eventLoopUtilized = eventLoopUtilization(elu).utilization;
        } else {
          eventLoopUtilized = 0;
        }
      }

      function beginMemoryUsageUpdate() {
        updateMemoryUsage();
        timer.refresh();
      }

      function updateMemoryUsage() {
        const mem = process.memoryUsage();
        heapUsed = mem.heapUsed;
        rssBytes = mem.rss;
        updateEventLoopDelay();
        updateEventLoopUtilization();
      }

      function isUnderPressure() {
        if (checkMaxEventLoopDelay && eventLoopDelay > maxEventLoopDelay) {
          return true;
        }

        if (checkMaxHeapUsedBytes && heapUsed > maxHeapUsedBytes) {
          return true;
        }

        if (checkMaxRssBytes && rssBytes > maxRssBytes) {
          return true;
        }

        if (!externalsHealthy) {
          return true;
        }

        if (
          checkMaxEventLoopUtilization &&
          eventLoopUtilized > maxEventLoopUtilization
        ) {
          return true;
        }

        return false;
      }

      function memoryUsage() {
        return {
          eventLoopDelay,
          rssBytes,
          heapUsed,
          eventLoopUtilized,
        };
      }
    },
  });
}

function getSampleInterval(
  value: number | undefined,
  eventLoopResolution: number,
) {
  const defaultValue = monitorEventLoopDelay ? 1000 : 5;
  const sampleInterval = value || defaultValue;
  return monitorEventLoopDelay
    ? Math.max(eventLoopResolution, sampleInterval)
    : sampleInterval;
}

function mapExposeStatusRoute(opts?: boolean | string) {
  if (opts) {
    if (typeof opts === "string") return opts;
    return "/status";
  }

  return false;
}

function now() {
  const ts = process.hrtime();
  return ts[0] * 1e3 + ts[1] / 1e6;
}

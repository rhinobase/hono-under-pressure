import { promisify } from "node:util";
import { createAdaptorServer } from "@hono/node-server";
import { HTTPException } from "hono/http-exception";
import { agent as request } from "supertest";
import { PressureType, underPressure } from "../";
import { createServer } from "./helpers";

const wait = promisify(setTimeout);

describe("health check", () => {
  it("simple", async () => {
    const app = underPressure(
      (handlers) =>
        createAdaptorServer(
          createServer({
            middleware: handlers,
          }),
        ),
      {
        healthCheck: async () => false,
        healthCheckInterval: 1,
        pressureHandler: (c, type, value) => {
          expect(type).toEqual(PressureType.HEALTH_CHECK);
          expect(value).toEqual(undefined);
          throw new HTTPException(503, { message: "B" });
        },
      },
    );

    await request(app).get("/").expect(503, "B");
    app.close();
  });

  it("delayed handling with promise success", async () => {
    const app = underPressure(
      (handlers) =>
        createAdaptorServer(
          createServer({
            middleware: handlers,
          }),
        ),
      {
        healthCheck: async () => false,
        healthCheckInterval: 1,
        pressureHandler: async () => {
          await wait(250);
          throw new HTTPException(503, { message: "B" });
        },
      },
    );

    await request(app).get("/").expect(503, "B");
    app.close();
  });

  it("no handling", async () => {
    const app = underPressure(
      (handlers) =>
        createAdaptorServer(
          createServer({
            middleware: handlers,
          }),
        ),
      {
        healthCheck: async () => false,
        healthCheckInterval: 1,
        pressureHandler: () => {},
      },
    );

    await request(app).get("/").expect(200, "Hi there!");
    app.close();
  });

  it("interval reentrance", async (t) => {
    const healthCheckInterval = 100;

    const healthCheck = vi.fn(async () => {
      await wait(healthCheckInterval * 2);
      return true;
    });

    const app = underPressure(
      (handlers) =>
        createAdaptorServer(
          createServer({
            middleware: handlers,
          }),
        ),
      {
        healthCheck,
        healthCheckInterval,
      },
    );

    // called immediately when registering the plugin
    expect(healthCheck).toBeCalledTimes(1);

    // wait until next execution
    await wait(healthCheckInterval);

    // scheduled by the timer
    expect(healthCheck).toBeCalledTimes(2);

    await wait(healthCheckInterval);

    // still running the previous invocation
    expect(healthCheck).toBeCalledTimes(2);

    // wait until the last call resolves and schedules another invocation
    expect(healthCheck).toReturn();

    await wait(healthCheckInterval * 2);

    // next timer invocation
    expect(healthCheck).toBeCalledTimes(3);
    app.close();
  });
});

it.skip("event loop delay", async () => {
  const app = underPressure(
    (handlers) =>
      createAdaptorServer(
        createServer({
          middleware: handlers,
        }),
      ),
    {
      maxEventLoopDelay: 1,
      pressureHandler: (c, type, value) => {
        expect(type).toEqual(PressureType.EVENT_LOOP_DELAY);
        expect(value).gt(1);

        throw new HTTPException(503, { message: "B" });
      },
    },
  );

  await request(app).get("/").expect(503, "B");
  app.close();
});

it.todo("heap bytes");
it.todo("rss bytes");
it.todo("event loop utilization");
it.todo("event loop delay (NaN)");

describe("pressureHandler on route", () => {
  test.todo("simple");
  test.todo("delayed handling with promise error");
  test.todo("no handling");
});

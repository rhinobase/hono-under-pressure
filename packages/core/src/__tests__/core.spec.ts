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
        pressureHandler: async (c, type, value) => {
          await wait(250);
          throw new HTTPException(503, { message: "B" });
        },
      },
    );

    await request(app).get("/").expect(503, "B");
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
        pressureHandler: async (c, type, value) => {},
      },
    );

    await request(app).get("/").expect(200, "Hi there!");
  });

  it.skip("interval reentrance", async (t) => {
    vi.useFakeTimers();
    t.onTestFinished(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const healthCheckInterval = 500;

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
    vi.advanceTimersByTime(healthCheckInterval);

    // scheduled by the timer
    expect(healthCheck).toBeCalledTimes(2);

    vi.advanceTimersByTime(healthCheckInterval);

    // still running the previous invocation
    expect(healthCheck).toBeCalledTimes(2);

    // wait until the last call resolves and schedules another invocation
    expect(healthCheck).toReturn();

    vi.advanceTimersByTime(healthCheckInterval);

    // next timer invocation
    expect(healthCheck).toBeCalledTimes(3);
  });
});

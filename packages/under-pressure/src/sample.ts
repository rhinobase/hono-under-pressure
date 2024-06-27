import type { Env, Input } from "hono";
import { createFactory } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import {
  monitorEventLoopDelay,
  performance,
  type EventLoopUtilization,
  type IntervalHistogram,
} from "node:perf_hooks";
import type { ConfigType } from "./types";
const eventLoopUtilization = performance.eventLoopUtilization;

const SERVICE_UNAVAILABLE = 503;
const createError = (message = "Service Unavailable") =>
  new HTTPException(SERVICE_UNAVAILABLE, { message });

export function factoryWithUnderPressure<
  E extends Env = Env,
  P extends string = string,
  I extends Input = Input
>(config: ConfigType<E, P, I> = {}) {
  const resolution = 10;
  const {
    sampleInterval = getSampleInterval(config.sampleInterval, resolution),
    maxEventLoopDelay = 0,
    maxHeapUsedBytes = 0,
    maxRssBytes = 0,
    healthCheck = false,
    healthCheckInterval = -1,
    maxEventLoopUtilization = 0,
    pressureHandler,
  } = config;

  const underPressureError = config.customError || createError(config.message);
  const retryAfter = config.retryAfter || 10;

  const statusRoute = mapExposeStatusRoute(config.exposeStatusRoute);

  const checkMaxEventLoopDelay = maxEventLoopDelay > 0;
  const checkMaxHeapUsedBytes = maxHeapUsedBytes > 0;
  const checkMaxRssBytes = maxRssBytes > 0;
  const checkMaxEventLoopUtilization = eventLoopUtilization
    ? maxEventLoopUtilization > 0
    : false;

  return createFactory({
    initApp(app) {
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
  eventLoopResolution: number
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

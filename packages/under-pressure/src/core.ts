import {
  type EventLoopUtilization,
  type IntervalHistogram,
  monitorEventLoopDelay,
  performance,
} from "node:perf_hooks";
import type { ServerType } from "@hono/node-server";
import type { Input, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import {
  type ConfigType,
  PressureType,
  type UnderPressureVariables,
} from "./types";
import assert = require("node:assert");

const eventLoopUtilization = performance.eventLoopUtilization;

export function underPressure<
  E extends { Variables: UnderPressureVariables },
  P extends string = string,
  I extends Input = Input,
>(
  handler: (middleware: MiddlewareHandler<E, P, I>[]) => ServerType,
  config: ConfigType<E, P, I>,
) {
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
  } = config;

  const checkMaxEventLoopDelay = maxEventLoopDelay > 0;
  const checkMaxHeapUsedBytes = maxHeapUsedBytes > 0;
  const checkMaxRssBytes = maxRssBytes > 0;
  const checkMaxEventLoopUtilization = eventLoopUtilization
    ? maxEventLoopUtilization > 0
    : false;

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
      healthCheckInterval > 0,
      "config.healthCheck requires config.healthCheckInterval",
    );

    const doCheck = async () => {
      try {
        externalsHealthy = await healthCheck();
      } catch (error) {
        externalsHealthy = false;
        console.error(
          { error },
          "external healthCheck function supplied to `under-pressure` threw an error. setting the service status to unhealthy.",
        );
      }
    };

    doCheck().then(() => {
      if (healthCheckInterval > 0) {
        const beginCheck = async () => {
          await doCheck();
          externalHealthCheckTimer.refresh();
        };

        externalHealthCheckTimer = setTimeout(beginCheck, healthCheckInterval);
        externalHealthCheckTimer.unref();
      }
    });
  } else {
    externalsHealthy = true;
  }

  const middlewares = [
    createMiddleware<E, P, I>(async (c, next) => {
      c.set("memoryUsage", memoryUsage);
      c.set("isUnderPressure", isUnderPressure);
      await next();
    }),
    createMiddleware<E, P, I>(async (c, next) => {
      if (checkMaxEventLoopDelay && eventLoopDelay > maxEventLoopDelay)
        await pressureHandler(c, PressureType.EVENT_LOOP_DELAY, eventLoopDelay);

      if (checkMaxHeapUsedBytes && heapUsed > maxHeapUsedBytes)
        await pressureHandler(c, PressureType.HEAP_USED_BYTES, heapUsed);

      if (checkMaxRssBytes && rssBytes > maxRssBytes)
        await pressureHandler(c, PressureType.RSS_BYTES, rssBytes);

      if (!externalsHealthy)
        await pressureHandler(c, PressureType.HEALTH_CHECK);

      if (
        checkMaxEventLoopUtilization &&
        eventLoopUtilized > maxEventLoopUtilization
      )
        await pressureHandler(
          c,
          PressureType.EVENT_LOOP_UTILIZATION,
          eventLoopUtilized,
        );

      await next();
    }),
  ];

  const server = handler(middlewares);
  server.on("close", onClose);

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

  function onClose() {
    clearTimeout(timer);
    clearTimeout(externalHealthCheckTimer);
  }

  return server;
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

function now() {
  const ts = process.hrtime();
  return ts[0] * 1e3 + ts[1] / 1e6;
}

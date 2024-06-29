import type { Context, Input } from "hono";

export type UnderPressureVariables = {
  memoryUsage: () => {
    eventLoopDelay: number;
    rssBytes: number;
    heapUsed: number;
    eventLoopUtilized: number;
  };
  isUnderPressure: () => boolean;
  pressureHandler?: <
    E extends { Variables: UnderPressureVariables },
    P extends string = string,
    I extends Input = Input,
  >(
    c: Context<E, P, I>,
    type: PressureType,
    value?: number,
  ) => Promise<void> | void;
};

/**
 * The configuration options for the rate limiter.
 */
export interface ConfigType<
  E extends { Variables: UnderPressureVariables },
  P extends string = string,
  I extends Input = Input,
> {
  maxEventLoopDelay?: number;
  maxEventLoopUtilization?: number;
  maxHeapUsedBytes?: number;
  maxRssBytes?: number;
  healthCheck?: (
    c: Context<E, P, I>,
  ) => Promise<Record<string, unknown> | boolean>;
  healthCheckInterval?: number;
  sampleInterval?: number;
  pressureHandler?: (
    c: Context<E, P, I>,
    type: PressureType,
    value?: number,
  ) => Promise<void> | void;
}

export enum PressureType {
  EVENT_LOOP_DELAY = "eventLoopDelay",
  HEAP_USED_BYTES = "heapUsedBytes",
  RSS_BYTES = "rssBytes",
  HEALTH_CHECK = "healthCheck",
  EVENT_LOOP_UTILIZATION = "eventLoopUtilization",
}

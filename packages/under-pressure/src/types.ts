import type { Context, Env, Hono, Input, Schema } from "hono";
import type { HTTPException } from "hono/http-exception";
import type { BlankEnv, BlankSchema } from "hono/types";

/**
 * The configuration options for the rate limiter.
 */
export interface ConfigType<
  E extends Env = Env,
  P extends string = string,
  I extends Input = Input,
> {
  maxEventLoopDelay?: number;
  maxEventLoopUtilization?: number;
  maxHeapUsedBytes?: number;
  maxRssBytes?: number;
  message?: string;
  retryAfter?: number;
  healthCheck?: <
    E extends Env = BlankEnv,
    S extends Schema = BlankSchema,
    BasePath extends string = "/",
  >(
    app: Hono<E, S, BasePath>,
  ) => Promise<Record<string, unknown> | boolean>;
  healthCheckInterval?: number;
  pressureHandler?: (
    c: Context<E, P, I>,
    type: PressureType,
    value: number | undefined,
  ) => Promise<void> | void;
  sampleInterval?: number;
  exposeStatusRoute?: boolean | string;
  customError?: HTTPException;
}

export enum PressureType {
  EVENT_LOOP_DELAY = "eventLoopDelay",
  HEAP_USED_BYTES = "heapUsedBytes",
  RSS_BYTES = "rssBytes",
  HEALTH_CHECK = "healthCheck",
  EVENT_LOOP_UTILIZATION = "eventLoopUtilization",
}

import type { Env, Input, Context } from "hono";

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
    healthCheck?: (c: Context<E, P, I>) => Promise<Record<string, unknown> | boolean>;
    healthCheckInterval?: number;
    pressureHandler?: (c: Context<E, P, I>, type: PressureType, value: number | undefined) => Promise<void> | void;
    sampleInterval?: number;
    exposeStatusRoute?: boolean | string | { routeOpts: object; routeSchemaOpts?: object; routeResponseSchemaOpts?: object; url?: string };
    customError?: Error;
}

export enum PressureType {
    EVENT_LOOP_DELAY = "eventLoopDelay",
    HEAP_USED_BYTES = "heapUsedBytes",
    RSS_BYTES = "rssBytes",
    HEALTH_CHECK = "healthCheck",
    EVENT_LOOP_UTILIZATION = "eventLoopUtilization",
}
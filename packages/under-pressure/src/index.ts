import type { Env, Input, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

export function underPressure<
  E extends Env = Env,
  P extends string = string,
  I extends Input = Input,
>(): MiddlewareHandler<E, P, I> {
  return createMiddleware(async (c, next) => {
    await next();
  });
}

import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { underPressure } from "hono-under-pressure";

const wait = promisify(setTimeout);

const app = new Hono();

app.get("/", async (c) => {
  await wait(1000); // Synthetic load
  return c.text("Hello Hono!");
});

const port = 3000;
console.log(`Server is running on port ${port}`);

// serve({
//   fetch: app.fetch,
//   port,
// });

underPressure(
  (handlers) => {
    const newApp = new Hono().use(...handlers).route("/", app);

    return serve({
      fetch: newApp.fetch,
      port,
    });
  },
  {
    maxEventLoopDelay: 200,
    maxEventLoopUtilization: 0.8,
  },
);

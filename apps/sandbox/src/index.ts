import { promisify } from "node:util";
import { createAdaptorServer, serve } from "@hono/node-server";
import { Hono } from "hono";
import { underPressure } from "hono-under-pressure";

const wait = promisify(setTimeout);

const app = new Hono();

app.get("/", async (c) => {
  await wait(900); // Synthetic load
  return c.text("Hello Hono!");
});

const port = 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

// const server = underPressure(
//   (handlers) => {
//     const newApp = new Hono().use(...handlers).route("/", app);

//     return createAdaptorServer(newApp);
//   },
//   {
//     maxEventLoopDelay: 3,
//     maxEventLoopUtilization: 0.3,
//   }
// );

// server.listen(3000, "0.0.0.0");

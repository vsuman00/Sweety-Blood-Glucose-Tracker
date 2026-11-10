import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, createConnection } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const directory = await mkdtemp(join(tmpdir(), "sweety-redis-tests-"));
let redis;
try {
  let url = process.env.TEST_REDIS_URL;
  if (!url) {
    const port = await new Promise((resolve) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
    redis = spawn(
      process.env.REDIS_SERVER_BIN || "redis-server",
      [
        "--bind",
        "127.0.0.1",
        "--port",
        String(port),
        "--save",
        "",
        "--appendonly",
        "no",
        "--maxmemory-policy",
        "noeviction",
        "--dir",
        directory,
        "--logfile",
        join(directory, "redis.log"),
      ],
      { stdio: "ignore" },
    );
    let startupError;
    redis.on("error", (error) => {
      startupError = error;
    });
    const deadline = Date.now() + 5000;
    while (true) {
      if (startupError) throw startupError;
      if (redis.exitCode !== null || Date.now() > deadline)
        throw new Error(
          "Temporary Redis did not start; install native Redis or set TEST_REDIS_URL.",
        );
      const ready = await new Promise((resolve) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
      });
      if (ready) break;
      await delay(50);
    }
    url = `redis://127.0.0.1:${port}`;
  }
  const child = spawn(
    process.execPath,
    [
      "scripts/test-isolated.js",
      process.execPath,
      "--test",
      "tests/jobs.integration.js",
    ],
    { env: { ...process.env, TEST_REDIS_URL: url }, stdio: "inherit" },
  );
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  const [code] = await once(child, "exit");
  if (code !== 0) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (redis && redis.exitCode === null) {
    const exited = once(redis, "exit");
    redis.kill("SIGTERM");
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}

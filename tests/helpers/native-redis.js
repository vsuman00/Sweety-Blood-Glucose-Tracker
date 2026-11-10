import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, createConnection } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

export async function nativeRedis() {
  const directory = await mkdtemp(join(tmpdir(), "sweety-outage-test-"));
  const port = await new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
  let child;
  const resource = {
    url: `redis://127.0.0.1:${port}`,
    async start() {
      let failure;
      child = spawn(
        process.env.REDIS_SERVER_BIN || "redis-server",
        [
          "--bind",
          "127.0.0.1",
          "--port",
          String(port),
          "--appendonly",
          "yes",
          "--appendfsync",
          "always",
          "--maxmemory-policy",
          "noeviction",
          "--dir",
          directory,
          "--logfile",
          join(directory, "redis.log"),
        ],
        { stdio: "ignore" },
      );
      child.on("error", (error) => {
        failure = error;
      });
      const deadline = Date.now() + 5000;
      while (true) {
        if (failure) throw failure;
        if (child.exitCode !== null || Date.now() > deadline)
          throw new Error("Private Redis did not start.");
        const ready = await new Promise((resolve) => {
          const socket = createConnection({ host: "127.0.0.1", port });
          socket.once("connect", () => {
            socket.destroy();
            resolve(true);
          });
          socket.once("error", () => resolve(false));
        });
        if (ready) return;
        await delay(30);
      }
    },
    async stop() {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    },
    async close() {
      await resource.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
  try {
    await resource.start();
    return resource;
  } catch (error) {
    await resource.close();
    throw error;
  }
}

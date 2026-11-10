import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "sweety-tests-"));
const data = join(directory, "pg");
const binary =
  process.env.POSTGRES_BIN ||
  dirname(execFileSync("which", ["initdb"], { encoding: "utf8" }).trim());
const run = (command, args, env = process.env, quiet = false) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: quiet ? "pipe" : "inherit",
    });
    let error = "";
    child.stderr?.on("data", (chunk) => {
      error += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed (${code}). ${error}`)),
    );
  });
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
let started = false;
try {
  await run(
    join(binary, "initdb"),
    [
      "-D",
      data,
      "-A",
      "trust",
      "-U",
      "sweety_test",
      "--no-locale",
      "-E",
      "UTF8",
    ],
    process.env,
    true,
  );
  await run(
    join(binary, "pg_ctl"),
    [
      "-D",
      data,
      "-l",
      join(directory, "pg.log"),
      "-o",
      `-h 127.0.0.1 -p ${port} -k ${directory}`,
      "-w",
      "start",
    ],
    process.env,
    true,
  );
  started = true;
  await run(join(binary, "createdb"), [
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    "sweety_test",
    "sweety_test",
  ]);
  const base = `postgresql://sweety_test@127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DATABASE_URL: `${base}/sweety`,
    TEST_DATABASE_URL: `${base}/sweety_test`,
  };
  // Integration suites inject caches explicitly; never inherit production services.
  for (const key of [
    "DATABASE_URL_UNPOOLED",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "REDIS_URL",
    "CACHE_NAMESPACE",
    "QUEUE_PREFIX",
  ])
    env[key] = "";
  const custom = process.argv.slice(2);
  const commands = custom.length
    ? [custom]
    : [
        ["npm", "test"],
        ["npm", "run", "build"],
        ["npm", "run", "test:browser"],
      ];
  for (const [command, ...args] of commands) await run(command, args, env);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started)
    await run(
      join(binary, "pg_ctl"),
      ["-D", data, "-m", "fast", "-w", "stop"],
      process.env,
      true,
    );
  await rm(directory, { recursive: true, force: true });
}

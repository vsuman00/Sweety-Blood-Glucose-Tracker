import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAccessArgs } from "../server/access.js";
test("access commands validate all flags before connecting to the database", () => {
  assert.deepEqual(
    parseAccessArgs(["role", "--email", "d@example.test", "--role", "doctor"]),
    { action: "role", email: "d@example.test", role: "doctor" },
  );
  assert.deepEqual(parseAccessArgs(["--help"]), { help: true });
  for (const args of [
    [],
    ["promote"],
    ["role", "--email", "a@example.test"],
    ["role", "--email", "a@example.test", "--role", "admin"],
    [
      "role",
      "--email",
      "a@example.test",
      "--email",
      "b@example.test",
      "--role",
      "doctor",
    ],
    [
      "assign",
      "--doctor",
      "a@example.test",
      "--patient",
      "b@example.test",
      "--unknown",
      "x",
    ],
  ])
    assert.throws(() => parseAccessArgs(args));
});

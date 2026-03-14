import test from "node:test";
import assert from "node:assert/strict";

import { toModelMessages, validateAgent, clearProviderCache } from "../src/services/chat.js";

test("validateAgent rejects incomplete agent config", () => {
  assert.throws(() => validateAgent({ name: "Pro Agent", baseUrl: "", apiKey: "", model: "" }));
});

test("toModelMessages normalizes plain string content", () => {
  const messages = toModelMessages([
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
  ]);

  assert.deepEqual(messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
  ]);
});

test("clearProviderCache does not throw", () => {
  assert.doesNotThrow(() => clearProviderCache());
});

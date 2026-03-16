import test from "node:test";
import assert from "node:assert/strict";

import { toModelMessages, validateAgent, clearProviderCache, createToolBudgetGuard } from "../src/services/chat.js";

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

test("createToolBudgetGuard returns undefined for steps within budget", () => {
  const guard = createToolBudgetGuard(3);
  assert.equal(guard({ stepNumber: 0 }), undefined);
  assert.equal(guard({ stepNumber: 1 }), undefined);
  assert.equal(guard({ stepNumber: 2 }), undefined);
  assert.equal(guard({ stepNumber: 3 }), undefined);
});

test("createToolBudgetGuard forces toolChoice none when budget is exhausted", () => {
  const guard = createToolBudgetGuard(3);
  assert.deepEqual(guard({ stepNumber: 4 }), { toolChoice: "none" });
  assert.deepEqual(guard({ stepNumber: 5 }), { toolChoice: "none" });
});

test("createToolBudgetGuard with maxToolSteps=0 forces toolChoice none from step 1", () => {
  const guard = createToolBudgetGuard(0);
  assert.equal(guard({ stepNumber: 0 }), undefined);
  assert.deepEqual(guard({ stepNumber: 1 }), { toolChoice: "none" });
});

test("createToolBudgetGuard with maxToolSteps=1 allows one tool round", () => {
  const guard = createToolBudgetGuard(1);
  assert.equal(guard({ stepNumber: 0 }), undefined);
  assert.equal(guard({ stepNumber: 1 }), undefined);
  assert.deepEqual(guard({ stepNumber: 2 }), { toolChoice: "none" });
});

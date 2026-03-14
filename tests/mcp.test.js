import test from "node:test";
import assert from "node:assert/strict";

import { createMcpRuntime } from "../src/services/mcp.js";

test("createMcpRuntime returns MCP runtime facade", async () => {
  const runtime = createMcpRuntime([]);

  assert.equal(typeof runtime.listTools, "function");
  assert.equal(typeof runtime.getTools, "function");
  assert.equal(typeof runtime.close, "function");

  await runtime.close();
});

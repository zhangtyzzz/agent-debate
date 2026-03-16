import test from "node:test";
import assert from "node:assert/strict";

import { createMcpRuntime, resolveTransportUrl } from "../src/services/mcp.js";

test("createMcpRuntime returns MCP runtime facade", async () => {
  const runtime = createMcpRuntime([]);

  assert.equal(typeof runtime.listTools, "function");
  assert.equal(typeof runtime.getTools, "function");
  assert.equal(typeof runtime.close, "function");

  await runtime.close();
});

test("resolveTransportUrl uses proxy URL by default", () => {
  const server = { url: "https://mcp.example.com/mcp", directConnect: false };
  const result = resolveTransportUrl(server);
  assert.ok(result.includes("/api/mcp"));
  assert.ok(result.includes("url="));
  assert.ok(result.includes(encodeURIComponent("https://mcp.example.com/mcp")));
});

test("resolveTransportUrl uses raw URL when directConnect is true", () => {
  const server = { url: "https://mcp.example.com/mcp", directConnect: true };
  const result = resolveTransportUrl(server);
  assert.equal(result, "https://mcp.example.com/mcp");
});

test("resolveTransportUrl uses proxy when directConnect is undefined", () => {
  const server = { url: "https://mcp.example.com/mcp" };
  const result = resolveTransportUrl(server);
  assert.ok(result.includes("/api/mcp"));
});

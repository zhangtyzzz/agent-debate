import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeRequestBody } from "../src/services/chat.js";

test("sanitizeRequestBody nulls empty string content on assistant with tool_calls", () => {
  const body = {
    messages: [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "t1", type: "function", function: { name: "search", arguments: "{}" } }],
      },
    ],
  };

  const result = sanitizeRequestBody(body);
  assert.equal(result.messages[0].content, null);
  assert.equal(result.messages[0].tool_calls.length, 1);
});

test("sanitizeRequestBody strips empty text blocks from array content", () => {
  const body = {
    messages: [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "tool_use", id: "t1", name: "search", input: {} },
        ],
        tool_calls: [{ id: "t1", type: "function", function: { name: "search", arguments: "{}" } }],
      },
    ],
  };

  const result = sanitizeRequestBody(body);
  assert.equal(result.messages[0].content.length, 1);
  assert.equal(result.messages[0].content[0].type, "tool_use");
});

test("sanitizeRequestBody preserves non-empty text content", () => {
  const body = {
    messages: [
      {
        role: "assistant",
        content: "Hello",
        tool_calls: [{ id: "t1", type: "function", function: { name: "search", arguments: "{}" } }],
      },
    ],
  };

  const result = sanitizeRequestBody(body);
  assert.equal(result.messages[0].content, "Hello");
});

test("sanitizeRequestBody does not touch assistant messages without tool_calls", () => {
  const body = {
    messages: [
      { role: "assistant", content: "" },
    ],
  };

  const result = sanitizeRequestBody(body);
  assert.equal(result.messages[0].content, "");
});

test("sanitizeRequestBody does not touch user messages", () => {
  const body = {
    messages: [
      { role: "user", content: "", tool_calls: [{ id: "t1" }] },
    ],
  };

  const result = sanitizeRequestBody(body);
  assert.equal(result.messages[0].content, "");
});

test("sanitizeRequestBody nulls array content when all blocks are empty text", () => {
  const body = {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        tool_calls: [{ id: "t1", type: "function", function: { name: "search", arguments: "{}" } }],
      },
    ],
  };

  const result = sanitizeRequestBody(body);
  assert.equal(result.messages[0].content, null);
});

test("sanitizeRequestBody returns body unchanged when no modifications needed", () => {
  const body = {
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ],
  };

  const result = sanitizeRequestBody(body);
  assert.equal(result, body); // Same reference — no copy
});

test("sanitizeRequestBody handles missing messages", () => {
  assert.deepEqual(sanitizeRequestBody({}), {});
  assert.deepEqual(sanitizeRequestBody({ model: "gpt-4" }), { model: "gpt-4" });
});

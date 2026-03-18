import test from "node:test";
import assert from "node:assert/strict";

import {
  streamdownControls,
  streamdownPlugins,
} from "../src/components/ai-elements/streamdown-config.js";

test("streamdown controls disable wrapper actions for rich markdown blocks", () => {
  assert.deepEqual(streamdownControls, {
    table: false,
    code: false,
    mermaid: false,
  });
});

test("streamdown plugins keep rich markdown rendering enabled", () => {
  assert.equal(typeof streamdownPlugins.cjk, "object");
  assert.equal(typeof streamdownPlugins.code, "object");
  assert.equal(typeof streamdownPlugins.math, "object");
  assert.equal(typeof streamdownPlugins.mermaid, "object");
});

import test from "node:test";
import assert from "node:assert/strict";

import { createTranslator, detectLocale } from "../src/i18n.js";

test("detectLocale maps zh variants to zh-CN", () => {
  assert.equal(detectLocale("zh"), "zh-CN");
  assert.equal(detectLocale("zh-TW"), "zh-CN");
  assert.equal(detectLocale("en-US"), "en");
});

test("createTranslator returns translated strings with interpolation", () => {
  const zh = createTranslator("zh-CN");
  const en = createTranslator("en");

  assert.equal(zh("runDebate"), "开始辩论");
  assert.equal(en("runDebate"), "Run Debate");
  assert.equal(zh("configuredCount", { count: 3 }), "3 个已配置");
  assert.equal(en("configuredCount", { count: 3 }), "3 configured");
});

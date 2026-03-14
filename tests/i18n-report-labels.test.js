import test from "node:test";
import assert from "node:assert/strict";

import { createReportLabels, createTranslator } from "../src/i18n.js";

test("createReportLabels returns localized labels for zh-CN", () => {
  const labels = createReportLabels("zh-CN");
  assert.equal(labels.reportTitle, "辩论报告");
  assert.equal(labels.winnerPro, "正方 Agent");
  assert.equal(labels.winnerCon, "反方 Agent");
  assert.equal(labels.reportArticle, "综合文章");
  assert.equal(labels.confidence, "置信度");
});

test("createReportLabels returns localized labels for en", () => {
  const labels = createReportLabels("en");
  assert.equal(labels.reportTitle, "Debate Report");
  assert.equal(labels.winnerPro, "Pro Agent");
  assert.equal(labels.winnerCon, "Con Agent");
  assert.equal(labels.reportArticle, "Synthesis Report");
  assert.equal(labels.confidence, "Confidence");
});

test("createReportLabels defaults to en for unknown locale", () => {
  const labels = createReportLabels("fr");
  assert.equal(labels.reportTitle, "Debate Report");
});

test("createReportLabels has all expected keys", () => {
  const labels = createReportLabels("en");
  const expectedKeys = [
    "reportTitle",
    "reportTopic",
    "winnerLabel",
    "winnerPro",
    "winnerCon",
    "keyArgumentsPro",
    "keyArgumentsCon",
    "keyDisagreements",
    "unresolvedQuestions",
    "judgeReasoning",
    "reportArticle",
    "confidence",
  ];
  for (const key of expectedKeys) {
    assert.ok(key in labels, `Missing key: ${key}`);
  }
});

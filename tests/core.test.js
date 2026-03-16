import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULTS,
  DEFAULT_EXA_MCP_ID,
  buildMarkdownReport,
  clampInt,
  createMarkdownFilename,
  detectVerdictWinner,
  isToolEnabled,
  mergeDefaults,
  mergeMcps,
  normalizeJudgeVerdictText,
  parseHeadersJson,
  safeParseJson,
} from "../src/core.js";

test("mergeDefaults preserves defaults and merges nested agent config", () => {
  const merged = mergeDefaults({
    defaults: { rounds: 3 },
    agents: { pro: { model: "custom-model" } },
  });

  assert.equal(merged.defaults.rounds, 3);
  assert.equal(merged.defaults.maxTokensPerTurn, 4096);
  assert.equal(merged.agents.pro.model, "custom-model");
  assert.deepEqual(merged.agents.con.mcpIds, DEFAULTS.agents.con.mcpIds);
  assert.equal(merged.mcps[0].id, DEFAULT_EXA_MCP_ID);
  assert.ok(merged.agents.pro.mcpIds.includes(DEFAULT_EXA_MCP_ID));
});

test("safeParseJson supports fenced json", () => {
  const parsed = safeParseJson('```json\n{"winner":"Pro"}\n```');
  assert.deepEqual(parsed, { winner: "Pro" });
});

test("normalizeJudgeVerdictText extracts winner and generates markdown", () => {
  const verdict = normalizeJudgeVerdictText(
    "Winner: Con\n\nThe negative side won because it exposed the core reliability gap.",
    "Test topic",
  );
  assert.equal(verdict.winner, "Con");
  assert.equal(verdict.reportArticle, "");
  assert.match(verdict.markdown, /## Debate Topic/);
  assert.match(verdict.markdown, /## Synthesis Report/);
});

test("detectVerdictWinner supports English and Chinese labels", () => {
  assert.equal(detectVerdictWinner("Winner: Pro\n\nReasoning"), "Pro");
  assert.equal(detectVerdictWinner("胜方：反方\n\n理由"), "Con");
  assert.equal(detectVerdictWinner("No explicit winner"), "Unknown");
});

test("parseHeadersJson requires a plain object", () => {
  assert.deepEqual(parseHeadersJson('{"Authorization":"Bearer x"}'), {
    Authorization: "Bearer x",
  });
  assert.throws(() => parseHeadersJson('["bad"]'));
});

test("buildMarkdownReport renders empty sections safely", () => {
  const markdown = buildMarkdownReport("Topic", {
    winner: "Pro",
    keyArgumentsPro: [],
    keyArgumentsCon: [],
    keyDisagreements: [],
    unresolvedQuestions: [],
    judgeReasoning: "Because",
    reportArticle: "",
  });

  assert.match(markdown, /No article generated/);
  assert.doesNotMatch(markdown, /Confidence/);
});

test("buildMarkdownReport supports localized labels", () => {
  const markdown = buildMarkdownReport(
    "主题",
    {
      winner: "Pro",
      keyArgumentsPro: [],
      keyArgumentsCon: [],
      keyDisagreements: [],
      unresolvedQuestions: [],
      judgeReasoning: "原因",
      reportArticle: "综合分析",
    },
    {
      reportTitle: "辩论报告",
      reportTopic: "辩题",
      winnerLabel: "胜方",
      keyArgumentsPro: "关键论点（正方）",
      keyArgumentsCon: "关键论点（反方）",
      keyDisagreements: "核心分歧",
      unresolvedQuestions: "未解决问题",
      judgeReasoning: "裁判理由",
      reportArticle: "综合文章",
    },
  );

  assert.match(markdown, /# 辩论报告/);
  assert.match(markdown, /## 胜方/);
  assert.match(markdown, /## 裁判理由/);
  assert.match(markdown, /## 综合文章/);
});

test("createMarkdownFilename slugifies topic", () => {
  assert.equal(createMarkdownFilename("Should AI replace PMs?"), "should-ai-replace-pms.md");
  assert.equal(clampInt(999, 0, 100), 100);
});

test("isToolEnabled returns true when tool is not in disabledTools", () => {
  const server = { disabledTools: ["disabled_tool"] };
  assert.equal(isToolEnabled(server, "enabled_tool"), true);
});

test("isToolEnabled returns false when tool is in disabledTools", () => {
  const server = { disabledTools: ["web_search", "other"] };
  assert.equal(isToolEnabled(server, "web_search"), false);
});

test("isToolEnabled returns true when disabledTools is null or missing", () => {
  assert.equal(isToolEnabled({}, "any_tool"), true);
  assert.equal(isToolEnabled({ disabledTools: null }, "any_tool"), true);
  assert.equal(isToolEnabled(null, "any_tool"), true);
});

test("mergeMcps normalizes disabledTools to an array", () => {
  const mcps = mergeMcps([
    { id: DEFAULT_EXA_MCP_ID, name: "Exa", url: "https://example.com", disabledTools: ["a"] },
    { id: "custom", name: "Custom", url: "https://custom.com", disabledTools: null },
    { id: "other", name: "Other", url: "https://other.com" },
  ]);

  assert.deepEqual(mcps[0].disabledTools, ["a"]);
  assert.deepEqual(mcps[1].disabledTools, []);
  assert.deepEqual(mcps[2].disabledTools, []);
});

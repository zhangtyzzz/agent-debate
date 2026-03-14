import test from "node:test";
import assert from "node:assert/strict";

// Only test pure JS helpers (no JSX rendering)
import {
  applyTranscriptPatch,
  findLastJudgeIndex,
  resolveEntrySide,
  getEntryBadge,
  formatWinner,
  summarizeToolParts,
  humanizeErrorMessage,
  toggleId,
  capitalize,
  hasValidSettings,
  buildActiveChips,
} from "../src/utils/app-helpers.js";

test("resolveEntrySide maps agent to correct side", () => {
  assert.equal(resolveEntrySide("pro"), "outgoing");
  assert.equal(resolveEntrySide("con"), "incoming");
  assert.equal(resolveEntrySide("judge"), "center");
  assert.equal(resolveEntrySide("system"), "center");
});

test("getEntryBadge maps agent to correct badge", () => {
  assert.equal(getEntryBadge("pro"), "P");
  assert.equal(getEntryBadge("con"), "C");
  assert.equal(getEntryBadge("judge"), "J");
  assert.equal(getEntryBadge("unknown"), "A");
});

test("capitalize capitalizes first letter", () => {
  assert.equal(capitalize("balanced"), "Balanced");
  assert.equal(capitalize(""), "");
  assert.equal(capitalize(null), "");
});

test("toggleId adds and removes ids", () => {
  assert.deepEqual(toggleId(["a", "b"], "c", true), ["a", "b", "c"]);
  assert.deepEqual(toggleId(["a", "b", "c"], "b", false), ["a", "c"]);
  // Should not duplicate
  assert.deepEqual(toggleId(["a", "b"], "b", true), ["a", "b"]);
});

test("humanizeErrorMessage returns user-friendly messages", () => {
  assert.match(humanizeErrorMessage("Failed to fetch", "zh-CN"), /连接失败/);
  assert.match(humanizeErrorMessage("Failed to fetch", "en"), /Connection failed/);
  assert.equal(humanizeErrorMessage("Some error"), "Some error");
  assert.equal(humanizeErrorMessage(""), "");
  assert.equal(humanizeErrorMessage(null), "");
});

test("findLastJudgeIndex returns correct index", () => {
  const transcript = [
    { agent: "pro" },
    { agent: "con" },
    { agent: "judge" },
    { agent: "pro" },
    { agent: "judge" },
  ];
  assert.equal(findLastJudgeIndex(transcript), 4);
});

test("findLastJudgeIndex returns -1 when no judge entry", () => {
  assert.equal(findLastJudgeIndex([{ agent: "pro" }, { agent: "con" }]), -1);
  assert.equal(findLastJudgeIndex([]), -1);
});

test("applyTranscriptPatch updates matching entry", () => {
  const transcript = [
    { id: "a", body: "hello", reasoning: "" },
    { id: "b", body: "world", reasoning: "" },
  ];
  const patched = applyTranscriptPatch(transcript, "a", { body: "updated" });
  assert.equal(patched[0].body, "updated");
  assert.equal(patched[1].body, "world");
});

test("applyTranscriptPatch appends bodyDelta", () => {
  const transcript = [{ id: "a", body: "hello", reasoning: "" }];
  const patched = applyTranscriptPatch(transcript, "a", { bodyDelta: " world" });
  assert.equal(patched[0].body, "hello world");
});

test("applyTranscriptPatch appends reasoningDelta", () => {
  const transcript = [{ id: "a", body: "", reasoning: "think" }];
  const patched = applyTranscriptPatch(transcript, "a", { reasoningDelta: "ing" });
  assert.equal(patched[0].reasoning, "thinking");
});

test("applyTranscriptPatch does not mutate non-matching entries", () => {
  const transcript = [{ id: "a", body: "a" }, { id: "b", body: "b" }];
  const patched = applyTranscriptPatch(transcript, "c", { body: "new" });
  assert.equal(patched[0].body, "a");
  assert.equal(patched[1].body, "b");
});

test("hasValidSettings returns true when all agents configured", () => {
  const data = {
    agents: {
      pro: { baseUrl: "http://x", apiKey: "k", model: "m" },
      con: { baseUrl: "http://x", apiKey: "k", model: "m" },
      judge: { baseUrl: "http://x", apiKey: "k", model: "m" },
    },
  };
  assert.equal(hasValidSettings(data), true);
});

test("hasValidSettings returns false when an agent is missing fields", () => {
  const data = {
    agents: {
      pro: { baseUrl: "http://x", apiKey: "k", model: "m" },
      con: { baseUrl: "", apiKey: "k", model: "m" },
      judge: { baseUrl: "http://x", apiKey: "k", model: "m" },
    },
  };
  assert.equal(hasValidSettings(data), false);
});

test("buildActiveChips returns empty array for no topic", () => {
  const t = (key) => key;
  assert.deepEqual(buildActiveChips({}, t), []);
  assert.deepEqual(buildActiveChips(null, t), []);
});

test("buildActiveChips returns chips for valid topic", () => {
  const t = (key) => key;
  const chips = buildActiveChips({ topic: "AI Ethics", rounds: 3, outputLanguage: "English" }, t);
  assert.equal(chips.length, 3);
  assert.match(chips[0], /AI Ethics/);
});

test("formatWinner maps winner to localized strings", () => {
  const t = (key) => {
    const map = { winnerCon: "Con Agent", winnerPro: "Pro Agent", winnerUnknown: "Unknown" };
    return map[key] || key;
  };
  assert.equal(formatWinner("Con", t), "Con Agent");
  assert.equal(formatWinner("Pro", t), "Pro Agent");
  assert.equal(formatWinner("Unknown", t), "Unknown");
  assert.equal(formatWinner("Other", t), "Unknown");
});

test("summarizeToolParts summarizes tool parts correctly", () => {
  const t = (key, vars) => {
    if (key === "toolRunningCount") return `${vars.count} running`;
    if (key === "toolCountMeta") return `${vars.count} tools`;
    return key;
  };
  const parts = [
    { toolName: "search", state: "input-available" },
    { toolName: "calc", state: "output-available" },
  ];
  assert.equal(summarizeToolParts(parts, t), "1 running");

  const doneParts = [
    { toolName: "search", state: "output-available" },
    { toolName: "calc", state: "output-available" },
  ];
  assert.equal(summarizeToolParts(doneParts, t), "2 tools");

  const singlePart = [{ toolName: "search", state: "output-available" }];
  assert.equal(summarizeToolParts(singlePart, t), "search");
});

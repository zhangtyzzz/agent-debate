import test from "node:test";
import assert from "node:assert/strict";

import { buildDebatePlan, buildJudgeMessages, buildTurnMessages } from "../src/services/debate-orchestrator.js";

const debateContext = {
  topic: "Should teams adopt AI code review by default?",
  context: "Evaluate reliability, velocity, and maintenance tradeoffs.",
  rounds: 3,
  outputLanguage: "English",
  writingStyle: "balanced",
};

const baseAgent = {
  name: "Pro Agent",
  systemPrompt: "You are a debate agent.",
  mcpIds: ["search"],
};

test("buildDebatePlan ends with separate judge verdict and judge article steps", () => {
  const labels = {
    openingArgument: "Opening",
    initialRebuttal: "Initial rebuttal",
    roundRebuttal: (round) => `Round ${round} rebuttal`,
    closingSummary: "Closing",
    finalVerdict: "Final verdict",
    reportArticleTitle: "Synthesis report",
  };

  const plan = buildDebatePlan(debateContext, labels);

  assert.equal(plan.at(-2).kind, "judge-verdict");
  assert.equal(plan.at(-1).kind, "judge-article");
  assert.equal(plan.at(-1).title, "Synthesis report");
});

test("buildTurnMessages preserves alternating chat history instead of flattening transcript into one user message", () => {
  const messages = buildTurnMessages({
    agent: baseAgent,
    agentKey: "pro",
    debateContext,
    instructions: "Answer the strongest negative argument and add one new support.",
    round: 2,
    toolCatalog: [
      {
        serverId: "search",
        name: "web_search",
        description: "Search the web",
        inputSchema: { properties: { query: { type: "string" } } },
      },
    ],
    transcript: [
      {
        agent: "pro",
        roleLabel: "Pro Agent",
        title: "Opening",
        body: "AI review improves consistency.",
      },
      {
        agent: "con",
        roleLabel: "Con Agent",
        title: "Rebuttal",
        body: "It introduces false confidence.",
      },
      {
        agent: "pro",
        roleLabel: "Pro Agent",
        title: "Defense",
        body: "Human review still stays in the loop.",
      },
    ],
  });

  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "user", "assistant", "user", "assistant", "user"],
  );
  assert.match(messages[1].content, /Total rounds: 3/);
  assert.match(messages[2].content, /^Pro Agent · Opening/);
  assert.match(messages[3].content, /^Con Agent · Rebuttal/);
  assert.match(messages[4].content, /^Pro Agent · Defense/);
  assert.match(messages[5].content, /<system-reminder>/);
  assert.match(messages[5].content, /Current round: 2 of 3\./);
  assert.doesNotMatch(messages[0].content, /Current assignment:/);
  assert.doesNotMatch(messages[0].content, /Current round:/);
});

test("buildTurnMessages skips empty transcript entries so the current placeholder turn is not injected into context", () => {
  const messages = buildTurnMessages({
    agent: baseAgent,
    agentKey: "con",
    debateContext,
    instructions: "Deliver the next rebuttal.",
    round: 1,
    toolCatalog: [],
    transcript: [
      {
        agent: "pro",
        roleLabel: "Pro Agent",
        title: "Opening",
        body: "AI review catches style regressions.",
      },
      {
        agent: "con",
        roleLabel: "Con Agent",
        title: "Pending",
        body: "",
      },
    ],
  });

  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "user", "user", "user"],
  );
  assert.equal(messages.length, 4);
  assert.match(messages[2].content, /^Pro Agent · Opening/);
  assert.match(messages[3].content, /<system-reminder>/);
  assert.match(messages[3].content, /Deliver the next rebuttal\./);
});

test("buildTurnMessages keeps the leading system and context messages stable across rounds", () => {
  const firstTurn = buildTurnMessages({
    agent: baseAgent,
    agentKey: "pro",
    debateContext,
    instructions: "Write the opening argument.",
    round: 0,
    toolCatalog: [],
    transcript: [],
  });

  const laterTurn = buildTurnMessages({
    agent: baseAgent,
    agentKey: "pro",
    debateContext,
    instructions: "Answer the strongest objection.",
    round: 2,
    toolCatalog: [],
    transcript: [
      {
        agent: "pro",
        roleLabel: "Pro Agent",
        title: "Opening",
        body: "AI review improves consistency.",
      },
      {
        agent: "con",
        roleLabel: "Con Agent",
        title: "Rebuttal",
        body: "It also creates automation bias.",
      },
    ],
  });

  assert.equal(firstTurn[0].content, laterTurn[0].content);
  assert.equal(firstTurn[1].content, laterTurn[1].content);
  assert.match(firstTurn.at(-1).content, /<system-reminder>/);
  assert.match(laterTurn.at(-1).content, /<system-reminder>/);
});

test("buildJudgeMessages uses transcript turns as separate messages and appends a final verdict request", () => {
  const judge = {
    name: "Judge Agent",
    systemPrompt: "You are the judge.",
    mcpIds: [],
  };

  const messages = buildJudgeMessages(
    judge,
    debateContext,
    [
      {
        agent: "pro",
        roleLabel: "Pro Agent",
        title: "Opening",
        body: "AI review speeds up feedback loops.",
      },
      {
        agent: "con",
        roleLabel: "Con Agent",
        title: "Rebuttal",
        body: "It can normalize shallow reasoning.",
      },
    ],
    0,
  );

  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "user", "user", "user", "user"],
  );
  assert.match(messages[1].content, /Read the following debate turns/);
  assert.match(messages[2].content, /^Pro Agent · Opening/);
  assert.match(messages[3].content, /^Con Agent · Rebuttal/);
  assert.match(messages[4].content, /<system-reminder>/);
  assert.match(messages[4].content, /Winner: Pro/);
});

test("buildTurnMessages shows 'No tools available' when toolCatalog is empty", () => {
  const messages = buildTurnMessages({
    agent: baseAgent,
    agentKey: "pro",
    debateContext,
    instructions: "Write the opening argument.",
    round: 0,
    toolCatalog: [],
    transcript: [],
  });

  assert.match(messages[0].content, /No tools available\./);
});

test("buildJudgeMessages adds correction guidance on retry without changing transcript shape", () => {
  const judge = {
    name: "Judge Agent",
    systemPrompt: "You are the judge.",
    mcpIds: [],
  };

  const messages = buildJudgeMessages(
    judge,
    debateContext,
    [
      {
        agent: "con",
        roleLabel: "Con Agent",
        title: "Closing",
        body: "The unresolved risk is trust calibration.",
      },
    ],
    1,
  );

  assert.deepEqual(messages.map((message) => message.role), ["system", "user", "user", "user"]);
  assert.match(messages.at(-1).content, /did not clearly state the winner/i);
});

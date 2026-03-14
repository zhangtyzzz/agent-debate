import {
  buildMarkdownReport,
  clampInt,
  normalizeJudgeVerdictText,
  safeParseJson,
} from "../core.js";
import { createTranslator, createReportLabels } from "../i18n.js";
import { chatCompletion } from "./chat.js";
import { createMcpRuntime } from "./mcp.js";

const EMPTY_RESULT = "";

export async function runDebate(payload, handlers = {}) {
  return runDebateFromStep(payload, [], 0, handlers, null);
}

export async function runDebateFromStep(payload, seedTranscript = [], startStepIndex = 0, handlers = {}, seedReport = null) {
  const labels = createClientLabels(payload.locale || "zh-CN");
  const debateContext = {
    topic: String(payload.debate?.topic || "").trim(),
    context: String(payload.debate?.context || "").trim(),
    rounds: clampInt(Number(payload.debate?.rounds || 5), 1, 10),
    outputLanguage: String(payload.debate?.outputLanguage || "简体中文"),
    maxTokensPerTurn: clampInt(Number(payload.debate?.maxTokensPerTurn || 4096), 128, 8000),
    writingStyle: String(payload.defaults?.writingStyle || "balanced"),
  };

  const signal = handlers.signal;
  const transcript = seedTranscript.map((item) => structuredClone(item));
  const mcpRuntime = createMcpRuntime(payload.mcps || [], { signal });
  const toolCatalog = await buildToolCatalog(payload.mcps || [], mcpRuntime);
  const steps = buildDebatePlan(debateContext, labels);
  let report = seedReport;

  try {
    for (let stepIndex = startStepIndex; stepIndex < steps.length; stepIndex += 1) {
      const step = steps[stepIndex];
      if (step.kind === "turn") {
        await runTurn({
          ...step,
          stepIndex,
          debateContext,
          payload,
          transcript,
          toolCatalog,
          mcpRuntime,
          labels,
          handlers,
          signal,
        });
        continue;
      }

      if (step.kind === "judge-verdict") {
        report = await runJudgeVerdict({
          ...step,
          stepIndex,
          debateContext,
          payload,
          transcript,
          labels,
          handlers,
          signal,
        });
        handlers.onReport?.(report);
        continue;
      }

      if (step.kind === "judge-article") {
        const article = await runJudgeArticle({
          ...step,
          stepIndex,
          debateContext,
          payload,
          transcript,
          labels,
          handlers,
          signal,
          report,
        });
        report = {
          ...report,
          reportArticle: article,
          markdown: buildMarkdownReport(
            debateContext.topic,
            { ...report, reportArticle: article },
            createReportLabels(payload.locale || "zh-CN"),
          ),
        };
        handlers.onReport?.(report);
      }
    }

    handlers.onComplete?.({ transcript, report });
    return { transcript, report };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    throw error;
  } finally {
    await mcpRuntime.close();
  }
}

export function buildDebatePlan(debateContext, labels) {
  const steps = [
    {
      kind: "turn",
      agentKey: "pro",
      title: labels.openingArgument,
      instructions: `Write the opening argument for the affirmative side.
Output language: ${debateContext.outputLanguage}.
Structure:
- Thesis
- Core arguments (3 bullets)
- Direct implications`,
      round: 0,
      phase: "opening",
    },
  ];

  for (let round = 1; round <= debateContext.rounds; round += 1) {
    steps.push({
      kind: "turn",
      agentKey: "con",
      title: round === 1 ? labels.initialRebuttal : labels.roundRebuttal(round),
      instructions: `Respond to the strongest affirmative point, expose weaknesses, and add one new line of attack.
Output language: ${debateContext.outputLanguage}.
Structure:
- Main rebuttal
- Vulnerabilities
- New challenge`,
      round,
      phase: "rebuttal",
    });
    steps.push({
      kind: "turn",
      agentKey: "pro",
      title: labels.roundRebuttal(round),
      instructions: `Answer the strongest negative attack, repair exposed weaknesses, and add one new supporting idea.
Output language: ${debateContext.outputLanguage}.
Structure:
- Response
- Defense
- New support`,
      round,
      phase: "rebuttal",
    });
  }

  steps.push(
    {
      kind: "turn",
      agentKey: "pro",
      title: labels.closingSummary,
      instructions: `Summarize the affirmative case for final evaluation.
Output language: ${debateContext.outputLanguage}.
Structure:
- Best arguments
- Why the opposition failed
- Final claim`,
      round: debateContext.rounds,
      phase: "closing",
    },
    {
      kind: "turn",
      agentKey: "con",
      title: labels.closingSummary,
      instructions: `Summarize the negative case for final evaluation.
Output language: ${debateContext.outputLanguage}.
Structure:
- Best criticisms
- Why the affirmative failed
- Final claim`,
      round: debateContext.rounds,
      phase: "closing",
    },
    {
      kind: "judge-verdict",
      title: labels.finalVerdict,
      phase: "judge-verdict",
    },
    {
      kind: "judge-article",
      title: labels.reportArticleTitle,
      phase: "judge-article",
    },
  );

  return steps;
}

async function buildToolCatalog(mcps, mcpRuntime) {
  const catalog = [];
  for (const server of mcps.filter((item) => item.enabled !== false && item.url)) {
    try {
      const tools = await mcpRuntime.listTools(server);
      server.toolCache = tools;
      for (const tool of tools) {
        catalog.push({
          serverId: server.id,
          name: tool.name,
          description: tool.description || "",
          inputSchema: tool.inputSchema || {},
        });
      }
    } catch {
      continue;
    }
  }
  return catalog;
}

async function runTurn({
  stepIndex,
  phase,
  agentKey,
  title,
  instructions,
  debateContext,
  payload,
  transcript,
  toolCatalog,
  mcpRuntime,
  labels,
  handlers,
  signal,
  round,
}) {
  throwIfAborted(signal);
  const agent = payload.agents[agentKey];
  const priorTranscript = transcript.filter((item) => item.agent !== "judge");
  const entry = createDebateEntry({
    agent: agentKey,
    role: agent.name,
    title,
    meta: round ? labels.roundMeta(round) : labels.statementMeta,
    stepIndex,
    phase,
  });

  const messages = buildTurnMessages({
    agent,
    agentKey,
    debateContext,
    instructions,
    transcript: priorTranscript,
    round,
    toolCatalog,
  });

  transcript.push(entry);
  handlers.onEntry?.(entry);
  handlers.onStatus?.(labels.runningStatus(agent.name));

  const tools = await buildAgentToolSet(agent, payload.mcps || [], mcpRuntime);

  const response = await chatCompletion(agent, messages, debateContext.maxTokensPerTurn, {
    signal,
    stream: payload.defaults?.streamResponses !== false,
    maxToolSteps: clampInt(Number(payload.defaults?.maxToolSteps || 0), 0, 5),
    tools,
    onDelta(delta) {
      entry.body += delta;
      syncEntryParts(entry);
      handlers.onEntryUpdate?.({
        id: entry.id,
        patch: {
          bodyDelta: delta,
          parts: entry.parts,
          metadata: entry.metadata,
        },
      });
    },
    onReasoningDelta(delta) {
      entry.reasoning += delta;
      entry.reasoningOpen = true;
      syncEntryParts(entry);
      handlers.onEntryUpdate?.({
        id: entry.id,
        patch: {
          reasoningDelta: delta,
          reasoningOpen: true,
          parts: entry.parts,
          metadata: entry.metadata,
        },
      });
    },
    onToolEvent(event) {
      upsertToolCall(entry, {
        id: event.id,
        tool: event.tool,
        note: summarizeArguments(event.args),
        status: event.status,
        result: event.result || EMPTY_RESULT,
      });
      entry.meta = `${round ? labels.roundMeta(round) : labels.statementMeta} · ${labels.toolMeta(entry.toolCalls.length)}`;
      syncEntryParts(entry);
      handlers.onEntryUpdate?.({
        id: entry.id,
        patch: {
          toolCalls: entry.toolCalls,
          meta: entry.meta,
          parts: entry.parts,
          metadata: entry.metadata,
        },
      });
    },
  });

  entry.body = String(response.text || entry.body || "").trim();
  entry.reasoning = String(response.reasoningText || entry.reasoning || "").trim();
  entry.reasoningOpen = false;
  entry.streaming = false;
  entry.truncated = Boolean(response.truncated);
  syncEntryParts(entry);
  handlers.onEntryUpdate?.({
    id: entry.id,
    patch: {
      body: entry.body,
      reasoning: entry.reasoning,
      reasoningOpen: false,
      streaming: false,
      truncated: entry.truncated,
      finishReason: response.finishReason || null,
      toolCalls: entry.toolCalls,
      meta: entry.meta,
      parts: entry.parts,
      metadata: entry.metadata,
    },
  });
}

async function runJudgeVerdict({ stepIndex, phase, debateContext, payload, transcript, labels, handlers, signal, title }) {
  const judge = payload.agents.judge;
  const priorTranscript = transcript.filter((item) => item.agent !== "judge");
  const entry = createDebateEntry({
    agent: "judge",
    role: judge.name,
    title,
    meta: labels.runningStatus(judge.name),
    stepIndex,
    phase,
  });

  const retries = clampInt(Number(payload.defaults?.judgeRetries || 2), 0, 4);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const messages = buildJudgeMessages(judge, debateContext, priorTranscript, attempt);

    if (attempt === 0) {
      transcript.push(entry);
      handlers.onEntry?.(entry);
      handlers.onStatus?.(labels.runningStatus(judge.name));
    }

    entry.body = "";
    entry.reasoning = "";
    entry.reasoningOpen = false;
    entry.streaming = true;
    syncEntryParts(entry);
    handlers.onEntryUpdate?.({
      id: entry.id,
      patch: {
        body: "",
        reasoning: "",
        reasoningOpen: false,
        streaming: true,
        parts: entry.parts,
        metadata: entry.metadata,
      },
    });

    const response = await chatCompletion(judge, messages, debateContext.maxTokensPerTurn, {
      signal,
      stream: payload.defaults?.streamResponses !== false,
      onDelta(delta) {
        entry.body += delta;
        syncEntryParts(entry);
        handlers.onEntryUpdate?.({
          id: entry.id,
          patch: {
            bodyDelta: delta,
            parts: entry.parts,
            metadata: entry.metadata,
          },
        });
        handlers.onReportUpdate?.({
          draftBody: entry.body,
          draftReasoning: entry.reasoning,
        });
      },
      onReasoningDelta(delta) {
        entry.reasoning += delta;
        entry.reasoningOpen = true;
        syncEntryParts(entry);
        handlers.onEntryUpdate?.({
          id: entry.id,
          patch: {
            reasoningDelta: delta,
            reasoningOpen: true,
            parts: entry.parts,
            metadata: entry.metadata,
          },
        });
        handlers.onReportUpdate?.({
          draftBody: entry.body,
          draftReasoning: entry.reasoning,
        });
      },
    });

    const finalVerdictText = String(response.text || entry.body || "").trim();
    const report = normalizeJudgeVerdictText(finalVerdictText, debateContext.topic, createReportLabels(payload.locale || "zh-CN"));
    report.judgeThinking = entry.reasoning;
    entry.body = finalVerdictText;
    entry.reasoning = String(response.reasoningText || entry.reasoning || "").trim();
    entry.streaming = false;
    entry.reasoningOpen = false;
    entry.meta = labels.verdictMeta(report.winner);
    syncEntryParts(entry);
    handlers.onEntryUpdate?.({
      id: entry.id,
      patch: {
        body: entry.body,
        reasoning: entry.reasoning,
        reasoningOpen: false,
        streaming: false,
        meta: entry.meta,
        parts: entry.parts,
        metadata: entry.metadata,
      },
    });
    if (report.winner !== "Unknown" || attempt === retries) {
      return report;
    }
  }

  throw new Error("Judge verdict generation failed.");
}

async function runJudgeArticle({ stepIndex, phase, debateContext, payload, transcript, labels, handlers, signal, report, title }) {
  if (!report) {
    throw new Error("Judge article generation requires a parsed verdict first.");
  }

  const judge = payload.agents.judge;
  const priorTranscript = transcript.filter((item) => item.agent !== "judge");
  const entry = createDebateEntry({
    agent: "judge",
    role: judge.name,
    title,
    meta: labels.runningStatus(judge.name),
    stepIndex,
    phase,
  });

  transcript.push(entry);
  handlers.onEntry?.(entry);
  handlers.onStatus?.(labels.runningStatus(judge.name));

  const response = await chatCompletion(
    judge,
    buildJudgeArticleMessages(judge, debateContext, priorTranscript, report),
    debateContext.maxTokensPerTurn,
    {
      signal,
      stream: payload.defaults?.streamResponses !== false,
      onDelta(delta) {
        entry.body += delta;
        syncEntryParts(entry);
        handlers.onEntryUpdate?.({
          id: entry.id,
          patch: {
            bodyDelta: delta,
            parts: entry.parts,
            metadata: entry.metadata,
          },
        });
      },
      onReasoningDelta(delta) {
        entry.reasoning += delta;
        entry.reasoningOpen = true;
        syncEntryParts(entry);
        handlers.onEntryUpdate?.({
          id: entry.id,
          patch: {
            reasoningDelta: delta,
            reasoningOpen: true,
            parts: entry.parts,
            metadata: entry.metadata,
          },
        });
      },
    },
  );

  entry.body = String(response.text || entry.body || "").trim();
  entry.reasoning = String(response.reasoningText || entry.reasoning || "").trim();
  entry.reasoningOpen = false;
  entry.streaming = false;
  entry.meta = labels.completed;
  syncEntryParts(entry);
  handlers.onEntryUpdate?.({
    id: entry.id,
    patch: {
      body: entry.body,
      reasoning: entry.reasoning,
      reasoningOpen: false,
      streaming: false,
      meta: entry.meta,
      parts: entry.parts,
      metadata: entry.metadata,
    },
  });

  return entry.body;
}

export function buildTurnMessages({ agent, agentKey, debateContext, instructions, transcript, round, toolCatalog }) {
  const system = buildAgentInstructions(agent, debateContext, agentKey, toolCatalog);

  return [
    {
      role: "system",
      content: system,
    },
    {
      role: "user",
      content: buildDebateContextMessage(debateContext),
    },
    ...mapDebateTranscriptToMessages(transcript, agentKey),
    {
      role: "user",
      content: buildDebateTaskMessage(debateContext, instructions, round),
    },
  ];
}

export function buildJudgeMessages(agent, debateContext, transcript, attempt) {
  const system = buildAgentInstructions(agent, debateContext, "judge", []);
  const correction = attempt > 0
    ? "\n\nYour previous answer did not clearly state the winner. Rewrite it and make the winner explicit in the first line."
    : "";

  return [
    {
      role: "system",
      content: system,
    },
    {
      role: "user",
      content: buildJudgeContextMessage(debateContext),
    },
    ...mapJudgeTranscriptToMessages(transcript),
    {
      role: "user",
      content: `${buildJudgeVerdictPrompt()}${correction}`,
    },
  ];
}

function buildAgentInstructions(agentConfig, debateContext, agentKey, toolCatalog) {
  const side = agentKey === "pro" ? "affirmative" : agentKey === "con" ? "negative" : "judge";
  const styleGuide = buildStyleGuide(debateContext.writingStyle);
  const toolText = buildToolCatalogText(toolCatalog.filter((tool) => agentConfig.mcpIds.includes(tool.serverId)));
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentTime = `${now.toLocaleDateString("en-CA", { timeZone })} ${now.toLocaleTimeString("en-GB", { timeZone })} (${timeZone})`;
  return `${agentConfig.systemPrompt}

You must debate in ${debateContext.outputLanguage}.
Keep answers concise, structured, and incremental.
Current time: ${currentTime}
Debate topic: ${debateContext.topic}
${debateContext.context ? `Context:\n${debateContext.context}` : ""}
Total rounds: ${debateContext.rounds}
You are the ${side} side in a structured adversarial debate.
Style guide: ${styleGuide}
${agentKey === "judge" ? "Return plain text only." : "Treat opponent turns as user messages and your prior turns as assistant context."}
${toolText ? `Available tools:\n${toolText}` : "No tools available."}`;
}

function buildJudgeVerdictPrompt() {
  return wrapSystemReminder(`Return a natural-language verdict in markdown.

Requirements:
- The first line must be exactly: "Winner: Pro" or "Winner: Con"
- Then write a concise but substantive verdict explaining who won and why
- Focus on reasoning quality, rebuttal quality, and unresolved weaknesses
- Keep the output language consistent with the requested debate language.`);
}

function buildStyleGuide(writingStyle) {
  const style = String(writingStyle || "balanced");
  const map = {
    balanced: "Balanced, clear, analytical, and reader-friendly.",
    conversational: "Natural, approachable, and slightly conversational without becoming casual filler.",
    sharp: "Direct, vivid, and incisive, but still structured and professional.",
    formal: "Formal, restrained, and polished with higher informational density.",
  };
  return map[style] || map.balanced;
}

function buildToolCatalogText(tools) {
  if (!tools.length) return "";
  return tools
    .map((tool) => {
      const properties = Object.keys(tool.inputSchema?.properties || {});
      const inputs = properties.length ? properties.join(", ") : "no arguments";
      return `- ${tool.name}: ${tool.description || "No description"} | inputs: ${inputs}`;
    })
    .join("\n");
}

function summarizeArguments(rawArguments) {
  if (!rawArguments) return "";
  if (typeof rawArguments === "object") {
    return Object.values(rawArguments).map(String).filter(Boolean).join(" · ").slice(0, 180);
  }
  const parsed = safeParseJson(String(rawArguments));
  if (!parsed || typeof parsed !== "object") return String(rawArguments).slice(0, 180);
  return Object.values(parsed).map(String).filter(Boolean).join(" · ").slice(0, 180);
}

function upsertToolCall(entry, nextToolCall) {
  const index = entry.toolCalls.findIndex((item) => item.id === nextToolCall.id);
  if (index === -1) {
    entry.toolCalls = [...entry.toolCalls, nextToolCall];
    return;
  }
  entry.toolCalls = entry.toolCalls.map((item, currentIndex) => (currentIndex === index ? { ...item, ...nextToolCall } : item));
}

function createDebateEntry({ agent, role, title, meta, stepIndex = null, phase = null }) {
  const entry = {
    id: crypto.randomUUID(),
    role: "assistant",
    agent,
    roleLabel: role,
    title,
    stepIndex,
    phase,
    body: "",
    reasoning: "",
    reasoningOpen: false,
    streaming: true,
    meta,
    toolCalls: [],
    truncated: false,
    parts: [],
    metadata: {
      agent,
      roleLabel: role,
      title,
      meta,
      streaming: true,
      truncated: false,
      stepIndex,
      phase,
      rerunnable: stepIndex != null,
    },
  };
  syncEntryParts(entry);
  return entry;
}

function syncEntryParts(entry) {
  entry.parts = [];

  if (entry.reasoning || entry.streaming) {
    entry.parts.push({
      type: "reasoning",
      text: entry.reasoning || "",
      state: entry.streaming ? "streaming" : "done",
    });
  }

  entry.toolCalls.forEach((toolCall) => {
    entry.parts.push({
      type: "dynamic-tool",
      toolName: toolCall.tool,
      toolCallId: toolCall.id,
      state: mapToolState(toolCall.status),
      input: toolCall.note ? { note: toolCall.note } : undefined,
      ...(toolCall.status === "completed" ? { output: toolCall.result || "" } : {}),
      ...(toolCall.status === "failed" ? { errorText: toolCall.result || "" } : {}),
    });
  });

  entry.parts.push({
    type: "text",
    text: entry.body || "",
    state: entry.streaming ? "streaming" : "done",
  });

  entry.metadata = {
    agent: entry.agent,
    roleLabel: entry.roleLabel,
    title: entry.title,
    meta: entry.meta,
    streaming: entry.streaming,
    truncated: entry.truncated,
    stepIndex: entry.stepIndex,
    phase: entry.phase,
    rerunnable: entry.stepIndex != null,
  };
}

function mapToolState(status) {
  if (status === "completed") return "output-available";
  if (status === "failed") return "output-error";
  if (status === "running") return "input-available";
  return "input-streaming";
}

function buildDebateContextMessage(debateContext) {
  return [
    `Debate topic: ${debateContext.topic}`,
    debateContext.context ? `Context:\n${debateContext.context}` : "",
    `Output language: ${debateContext.outputLanguage}`,
    `Total rounds: ${debateContext.rounds}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildDebateTaskMessage(debateContext, instructions, round) {
  return wrapSystemReminder([
    roundReminder(round, debateContext.rounds),
    `Current assignment:\n${instructions}`,
  ]
    .filter(Boolean)
    .join("\n\n"));
}

function buildJudgeArticleMessages(agent, debateContext, transcript, report) {
  const system = buildAgentInstructions(agent, debateContext, "judge", []);

  return [
    {
      role: "system",
      content: system,
    },
    {
      role: "user",
      content: buildJudgeContextMessage(debateContext),
    },
    ...mapJudgeTranscriptToMessages(transcript),
    {
      role: "user",
      content: buildJudgeArticlePrompt(report),
    },
  ];
}

function mapDebateTranscriptToMessages(transcript, agentKey) {
  return transcript
    .filter((item) => (item.body || "").trim())
    .map((item) => ({
      role: item.agent === agentKey ? "assistant" : "user",
      content: formatTranscriptTurn(item),
    }));
}

function mapJudgeTranscriptToMessages(transcript) {
  return transcript
    .filter((item) => (item.body || "").trim())
    .map((item) => ({
      role: "user",
      content: formatTranscriptTurn(item),
    }));
}

function formatTranscriptTurn(item) {
  return `${item.roleLabel || item.role} · ${item.title}\n${item.body}`;
}

function roundReminder(round, totalRounds) {
  return round ? `Current round: ${round} of ${totalRounds}.` : "Current phase: opening statement.";
}

function buildJudgeContextMessage(debateContext) {
  return [
    `Debate topic: ${debateContext.topic}`,
    debateContext.context ? `Context:\n${debateContext.context}` : "",
    `Output language: ${debateContext.outputLanguage}`,
    `Total rounds: ${debateContext.rounds}`,
    "Read the following debate turns before producing your answer.",
  ].filter(Boolean).join("\n\n");
}

function buildJudgeArticlePrompt(report) {
  return wrapSystemReminder([
    "Write a high-quality synthesis article about the debate topic.",
    "Do not return JSON.",
    `Verdict winner: ${report.winner}`,
    report.judgeReasoning ? `Verdict reasoning:\n${report.judgeReasoning}` : "",
    "Integrate both sides' strongest arguments, the key tradeoffs, likely real-world implications, and a practical takeaway for the user.",
    "Now write the final synthesis article only.",
  ].filter(Boolean).join("\n\n"));
}

function wrapSystemReminder(content) {
  return `<system-reminder>\n${String(content || "").trim()}\n</system-reminder>`;
}

function createClientLabels(locale) {
  const t = createTranslator(locale);
  return {
    openingArgument: t("openingArgument"),
    initialRebuttal: t("initialRebuttal"),
    roundRebuttal: (round) => t("roundRebuttal", { round }),
    closingSummary: t("closingSummary"),
    finalVerdict: t("finalVerdict"),
    reportArticleTitle: t("reportArticle"),
    statementMeta: t("statementMeta"),
    roundMeta: (round) => t("roundMeta", { round }),
    toolMeta: (count) => t("toolCountMeta", { count }),
    runningStatus: (name) => `${name} ${locale === "zh-CN" ? "运行中" : "running"}`,
    verdictMeta: (winner) => `${t("verdictMeta")} · ${winner}`,
    completed: t("completed"),
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason || new DOMException("Aborted", "AbortError");
  }
}

async function buildAgentToolSet(agent, servers, mcpRuntime) {
  const selectedServers = servers.filter((server) => server.enabled !== false && agent.mcpIds.includes(server.id));
  const entries = [];

  for (const server of selectedServers) {
    const tools = await mcpRuntime.getTools(server);
    for (const [name, tool] of Object.entries(tools)) {
      if (entries.some(([existingName]) => existingName === name)) {
        throw new Error(`Duplicate MCP tool name detected: ${name}. Rename one of the tools or disable one server.`);
      }
      entries.push([name, tool]);
    }
  }

  return Object.fromEntries(entries);
}

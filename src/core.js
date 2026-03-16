export const STORAGE_KEY = "agent-debate/v2";
export const HISTORY_LIMIT = 50;
export const DEFAULT_EXA_MCP_ID = "exa-search";

export const DEFAULT_EXA_MCP = {
  id: DEFAULT_EXA_MCP_ID,
  name: "Exa Search",
  url: "https://mcp.exa.ai/mcp",
  description: "Default web search MCP. Add your Exa API key to the URL as ?exaApiKey=YOUR_EXA_API_KEY if needed.",
  headers: "",
  enabled: true,
  toolCache: [],
  disabledTools: [],
};

export const DEFAULTS = {
  defaults: {
    rounds: 5,
    outputLanguage: "简体中文",
    maxTokensPerTurn: 4096,
    streamResponses: true,
    maxToolSteps: 3,
    judgeRetries: 2,
    writingStyle: "balanced",
    locale: "zh-CN",
  },
  mcps: [DEFAULT_EXA_MCP],
  agents: {
    pro: {
      name: "Pro Agent",
      baseUrl: "",
      apiKey: "",
      model: "gpt-4.1-mini",
      temperature: 0.7,
      systemPrompt:
        "You are the Pro Agent in a structured debate. You support the debate topic. Be rigorous, concise, and cumulative. Always respond to the opponent's strongest point, add at least one new argument, and avoid repeating prior phrasing.",
      mcpIds: [DEFAULT_EXA_MCP_ID],
    },
    con: {
      name: "Con Agent",
      baseUrl: "",
      apiKey: "",
      model: "gpt-4.1-mini",
      temperature: 0.7,
      systemPrompt:
        "You are the Con Agent in a structured debate. You oppose the debate topic. Identify weak assumptions, attack the strongest pro claim, and contribute new counterarguments without redundancy.",
      mcpIds: [DEFAULT_EXA_MCP_ID],
    },
    judge: {
      name: "Judge Agent",
      baseUrl: "",
      apiKey: "",
      model: "gpt-4.1-mini",
      temperature: 0.2,
      systemPrompt:
        "You are the Judge Agent in a structured debate. Evaluate fairly, decide a winner based on reasoning quality, rebuttal quality, and unresolved weaknesses, and write a clear verdict for the user.",
      mcpIds: [DEFAULT_EXA_MCP_ID],
    },
  },
  history: [],
  currentDebateId: null,
};

export function mergeDefaults(parsed = {}) {
  const mcps = mergeMcps(parsed.mcps);
  return {
    defaults: {
      ...DEFAULTS.defaults,
      ...(parsed.defaults || {}),
    },
    mcps,
    agents: {
      pro: mergeAgent(parsed.agents?.pro, DEFAULTS.agents.pro, mcps),
      con: mergeAgent(parsed.agents?.con, DEFAULTS.agents.con, mcps),
      judge: mergeAgent(parsed.agents?.judge, DEFAULTS.agents.judge, mcps),
    },
    history: Array.isArray(parsed.history) ? parsed.history : [],
    currentDebateId: parsed.currentDebateId || null,
  };
}

export function mergeAgent(agent, fallback, mcps = []) {
  const mergedMcpIds = Array.isArray(agent?.mcpIds)
    ? agent.mcpIds
    : [...fallback.mcpIds];
  const availableIds = new Set(mcps.map((item) => item.id));
  return {
    ...fallback,
    ...(agent || {}),
    mcpIds: mergedMcpIds.filter((id) => availableIds.has(id)),
  };
}

export function mergeMcps(mcps) {
  const parsedMcps = Array.isArray(mcps) ? mcps : [];
  const hasExa = parsedMcps.some((item) => item?.id === DEFAULT_EXA_MCP_ID);
  const normalized = parsedMcps.map((item) => ({
    ...item,
    toolCache: Array.isArray(item?.toolCache) ? item.toolCache : [],
    disabledTools: Array.isArray(item?.disabledTools) ? item.disabledTools : [],
  }));
  return hasExa ? normalized : [{ ...DEFAULT_EXA_MCP }, ...normalized];
}

export function isToolEnabled(server, toolName) {
  const disabled = Array.isArray(server?.disabledTools) ? server.disabledTools : [];
  return !disabled.includes(toolName);
}

export function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampInt(value, min, max) {
  return Math.round(clamp(Number.isFinite(value) ? value : min, min, max));
}

export function safeParseJson(raw) {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```([\s\S]*?)```/);
    if (!fenced) return null;
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return null;
    }
  }
}

export function ensureStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export function normalizeJudgeVerdictText(rawVerdict, topic, labels = {}) {
  const judgeReasoning = String(rawVerdict || "").trim();
  const normalized = {
    winner: detectVerdictWinner(judgeReasoning),
    keyArgumentsPro: [],
    keyArgumentsCon: [],
    keyDisagreements: [],
    unresolvedQuestions: [],
    judgeReasoning,
    reportArticle: "",
  };
  normalized.markdown = buildMarkdownReport(topic, normalized, labels);
  return normalized;
}

export function renderMarkdownBullets(items) {
  return items.length ? items.map((item) => `- ${item}`) : ["- None"];
}

export function buildMarkdownReport(topic, report, labels = {}) {
  const text = {
    reportTitle: labels.reportTitle || "Debate Report",
    reportTopic: labels.reportTopic || "Debate Topic",
    winnerLabel: labels.winnerLabel || "Winner",
    winnerPro: labels.winnerPro || "Pro",
    winnerCon: labels.winnerCon || "Con",
    keyArgumentsPro: labels.keyArgumentsPro || "Key Arguments (Pro)",
    keyArgumentsCon: labels.keyArgumentsCon || "Key Arguments (Con)",
    keyDisagreements: labels.keyDisagreements || "Key Disagreements",
    unresolvedQuestions: labels.unresolvedQuestions || "Unresolved Questions",
    judgeReasoning: labels.judgeReasoning || "Judge Reasoning",
    reportArticle: labels.reportArticle || "Synthesis Report",
  };
  const sections = [
    `# ${text.reportTitle}`,
    ``,
    `## ${text.reportTopic}`,
    topic,
    ``,
    `## ${text.winnerLabel}`,
    report.winner === "Con" ? text.winnerCon : report.winner === "Pro" ? text.winnerPro : (labels.winnerUnknown || "Unknown"),
    ``,
    `## ${text.judgeReasoning}`,
    report.judgeReasoning || "No verdict generated.",
    ``,
  ];

  if (report.keyArgumentsPro?.length) {
    sections.push(`## ${text.keyArgumentsPro}`, ...renderMarkdownBullets(report.keyArgumentsPro), ``);
  }
  if (report.keyArgumentsCon?.length) {
    sections.push(`## ${text.keyArgumentsCon}`, ...renderMarkdownBullets(report.keyArgumentsCon), ``);
  }
  if (report.keyDisagreements?.length) {
    sections.push(`## ${text.keyDisagreements}`, ...renderMarkdownBullets(report.keyDisagreements), ``);
  }
  if (report.unresolvedQuestions?.length) {
    sections.push(`## ${text.unresolvedQuestions}`, ...renderMarkdownBullets(report.unresolvedQuestions), ``);
  }

  sections.push(`## ${text.reportArticle}`, report.reportArticle || "No article generated.");
  return sections.join("\n");
}

export function detectVerdictWinner(text) {
  const raw = String(text || "");
  const winnerLine = raw.match(/^\s*(winner|胜方)\s*[:：]\s*(pro|con|正方|反方)/im);
  if (winnerLine) {
    const winner = winnerLine[2].toLowerCase();
    if (winner === "con" || winner === "反方") return "Con";
    if (winner === "pro" || winner === "正方") return "Pro";
  }
  return "Unknown";
}

export function parseHeadersJson(raw) {
  if (!String(raw || "").trim()) return {};
  const parsed = safeParseJson(raw.trim());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Headers JSON must be a plain object.");
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

export function createMarkdownFilename(topic) {
  const slug = String(topic || "debate-report")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "debate-report"}.md`;
}

export function shortUrl(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

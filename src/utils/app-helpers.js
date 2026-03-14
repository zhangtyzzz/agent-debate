import {
  DEFAULTS,
  STORAGE_KEY,
  mergeDefaults,
} from "../core.js";
import { createTranslator, createReportLabels, detectLocale } from "../i18n.js";

export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return withLocaleDefaults(structuredClone(DEFAULTS));
  try {
    return withLocaleDefaults(mergeDefaults(JSON.parse(raw)));
  } catch {
    return withLocaleDefaults(structuredClone(DEFAULTS));
  }
}

export function withLocaleDefaults(state) {
  const locale = state.defaults.locale || detectLocale(globalThis.navigator?.language);
  const outputLanguage = state.defaults.outputLanguage || (locale === "zh-CN" ? "简体中文" : "English");
  return {
    ...state,
    defaults: {
      ...state.defaults,
      locale,
      outputLanguage,
      reportLabels: createReportLabels(locale),
    },
  };
}

export function createDebateForm(data) {
  return {
    topic: "",
    context: "",
    rounds: String(data.defaults.rounds),
    language: data.defaults.outputLanguage,
    maxTokens: String(data.defaults.maxTokensPerTurn),
  };
}

export function hasValidSettings(data) {
  return ["pro", "con", "judge"].every((key) => {
    const agent = data.agents[key];
    return Boolean(agent.baseUrl && agent.apiKey && agent.model);
  });
}

export function applyTranscriptPatch(transcript, id, patch) {
  return transcript.map((entry) => {
    if (entry.id !== id) return entry;
    const next = { ...entry };
    if (typeof patch.bodyDelta === "string") next.body = `${next.body || ""}${patch.bodyDelta}`;
    else if (typeof patch.body === "string") next.body = patch.body;
    if (typeof patch.reasoningDelta === "string") next.reasoning = `${next.reasoning || ""}${patch.reasoningDelta}`;
    else if (typeof patch.reasoning === "string") next.reasoning = patch.reasoning;
    for (const key of ["reasoningOpen", "streaming", "meta", "toolCalls", "truncated", "finishReason", "parts", "metadata"]) {
      if (key in patch) next[key] = patch[key];
    }
    return next;
  });
}

export function findLastJudgeIndex(transcript) {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (transcript[index].agent === "judge") return index;
  }
  return -1;
}

export function buildSystemItems(data, t) {
  return [
    { label: t("protocol"), value: t("protocolCompatible") },
    { label: t("mcp"), value: t("enabledCount", { count: data.mcps.filter((server) => server.enabled !== false).length }) },
    { label: t("rounds"), value: t("defaultSuffix", { count: data.defaults.rounds }) },
    { label: t("writingStyle"), value: t(`style${capitalize(data.defaults.writingStyle || "balanced")}`) },
    { label: t("streaming"), value: data.defaults.streamResponses ? t("on") : t("off") },
    { label: t("proAgent"), value: agentSummary(data.agents.pro, t) },
    { label: t("conAgent"), value: agentSummary(data.agents.con, t) },
    { label: t("judgeAgent"), value: agentSummary(data.agents.judge, t) },
  ];
}

export function buildActiveChips(active, t) {
  if (!active?.topic) return [];
  return [
    `${t("activeDebate")}: ${active.topic}`,
    `${t("rounds")}: ${active.rounds || "-"}`,
    `${t("outputLanguage")}: ${active.outputLanguage || active.language || "-"}`,
  ];
}

export function agentSummary(agent, t) {
  if (!agent.baseUrl || !agent.model || !agent.apiKey) return t("notConfigured");
  return `${agent.model} · ${agent.mcpIds.length} ${t("mcp")}`;
}

export function resolveEntrySide(agent) {
  if (agent === "pro") return "outgoing";
  if (agent === "con") return "incoming";
  return "center";
}

export function getEntryBadge(agent) {
  return agent === "pro" ? "P" : agent === "con" ? "C" : agent === "judge" ? "J" : "A";
}

export function getLocalizedAgentName(agentKey, t) {
  if (agentKey === "pro") return t("proAgent");
  if (agentKey === "con") return t("conAgent");
  return t("judgeAgent");
}

export function formatWinner(winner, t) {
  if (winner === "Con") return t("winnerCon");
  if (winner === "Pro") return t("winnerPro");
  return t("winnerUnknown");
}

export function summarizeToolParts(toolParts, t) {
  const runningCount = toolParts.filter((tool) => tool.state === "input-available").length;
  if (runningCount) return t("toolRunningCount", { count: runningCount });
  if (toolParts.length === 1) return toolParts[0].toolName;
  return t("toolCountMeta", { count: toolParts.length });
}

export function humanizeErrorMessage(message, locale) {
  const text = String(message || "").trim();
  if (!text) return "";
  if (text === "Failed to fetch") {
    return locale === "zh-CN"
      ? "连接失败。目标 MCP 无法被浏览器直接访问，或远端返回被拦截。请确认你是通过本项目服务端入口访问，而不是直接打开静态文件。"
      : "Connection failed. The MCP endpoint could not be reached directly from the browser or the upstream response was blocked. Make sure you are using the app through its server entry instead of opening the HTML file directly.";
  }
  return text;
}

export function toggleId(ids, id, checked) {
  return checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id);
}

export function capitalize(value) {
  const text = String(value || "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

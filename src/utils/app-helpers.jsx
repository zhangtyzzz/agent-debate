import { renderMarkdown } from "../render-markdown.js";

// Re-export all pure JS helpers
export {
  loadState,
  withLocaleDefaults,
  createDebateForm,
  hasValidSettings,
  applyTranscriptPatch,
  findLastJudgeIndex,
  buildSystemItems,
  buildActiveChips,
  agentSummary,
  resolveEntrySide,
  getEntryBadge,
  getLocalizedAgentName,
  formatWinner,
  summarizeToolParts,
  humanizeErrorMessage,
  toggleId,
  capitalize,
} from "./app-helpers.js";

// JSX-dependent helper (must live in .jsx)
export function renderSimpleList(items, t) {
  if (!items?.length) return <p className="report-body">{t("none")}.</p>;
  return <ul>{items.map((item, index) => <li key={`${index}:${item}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(item) }} />)}</ul>;
}

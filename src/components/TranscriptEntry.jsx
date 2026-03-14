import { useEffect, useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { resolveEntrySide, getEntryBadge, summarizeToolParts } from "../utils/app-helpers.jsx";

export function TranscriptEntry({ entry, index, locale, t, running, onRerun }) {
  const side = resolveEntrySide(entry.agent);
  const metadata = entry.metadata || {};
  const messageFrom = side === "outgoing" ? "user" : "assistant";
  const roleLabel = locale === "zh-CN" ? (
    entry.agent === "pro" ? t("proAgent")
      : entry.agent === "con" ? t("conAgent")
        : entry.agent === "judge" ? t("judgeAgent")
          : metadata.roleLabel || entry.roleLabel || entry.role
  ) : metadata.roleLabel || entry.roleLabel || entry.role;
  const reasoningPart = (entry.parts || []).find((part) => part.type === "reasoning");
  const textPart = (entry.parts || []).find((part) => part.type === "text");
  const toolParts = (entry.parts || []).filter((part) => part.type === "dynamic-tool");
  const textContent = (textPart?.text || "").trim();
  const loading = metadata.streaming && !textContent && !toolParts.length;

  return (
    <article className={`entry entry-${entry.agent} entry-side-${side}${loading ? " entry-loading" : ""}`}>
      <div className="entry-avatar ai-entry-avatar" aria-hidden="true">{getEntryBadge(entry.agent)}</div>
      <Message from={messageFrom} className={`ai-entry-message ai-entry-message-${entry.agent}${side === "center" ? " ai-entry-message-center" : ""}`}>
        <div className="entry-head ai-entry-head">
          <div className="entry-head-main">
            <span className="entry-role entry-role-chip">{roleLabel}</span>
            <span className="entry-meta">{metadata.meta || index + 1}</span>
          </div>
        </div>
        <p className="entry-title">{metadata.title || entry.title}</p>
        <MessageContent className={`ai-entry-shell ai-entry-shell-${entry.agent}`}>
          {reasoningPart ? (
            <Reasoning
              className="ai-reasoning"
              isStreaming={reasoningPart.state === "streaming"}
            >
              <ReasoningTrigger className="ai-reasoning-trigger">
                <div className="ai-activity-copy">
                  <span className="activity-label">{t("thinking")}</span>
                  <span className="activity-summary">{reasoningPart.state === "streaming" ? t("thinkingLive") : t("thinkingReady")}</span>
                </div>
              </ReasoningTrigger>
              <ReasoningContent className="ai-response ai-reasoning-content">
                {reasoningPart.text || ""}
              </ReasoningContent>
            </Reasoning>
          ) : null}

          {toolParts.length ? (
            <div className="ai-tool-stack">
              <div className="ai-tool-stack-label">
                <span className="activity-label">{t("toolCalls")}</span>
                <span className="activity-summary">{summarizeToolParts(toolParts, t)}</span>
              </div>
              {toolParts.map((toolPart) => (
                <ToolPartCard key={toolPart.toolCallId} toolPart={toolPart} />
              ))}
            </div>
          ) : null}

          {textContent ? (
            <MessageResponse className="ai-response">
              {textPart.text}
            </MessageResponse>
          ) : loading ? (
            <div className="entry-answer">
              <div className="loading-lines"><span></span><span></span><span></span></div>
            </div>
          ) : null}
        </MessageContent>
        {metadata.rerunnable ? (
          <MessageToolbar className="ai-entry-toolbar">
            <MessageActions>
              <MessageAction
                disabled={running}
                label={t("rerun")}
                size="icon-sm"
                tooltip={t("rerun")}
                variant="outline"
                onClick={() => onRerun(metadata)}
              >
                <RotateCcwIcon />
              </MessageAction>
            </MessageActions>
          </MessageToolbar>
        ) : null}
      </Message>
    </article>
  );
}

function ToolPartCard({ toolPart }) {
  const isActive = toolPart.state === "input-available" || toolPart.state === "input-streaming";
  const [isOpen, setIsOpen] = useState(isActive);

  useEffect(() => {
    setIsOpen(isActive);
  }, [isActive]);

  return (
    <Tool className="ai-tool" onOpenChange={setIsOpen} open={isOpen}>
      <ToolHeader
        state={toolPart.state}
        title={toolPart.toolName}
        toolName={toolPart.toolName}
        type={toolPart.type}
      />
      <ToolContent className="ai-tool-content">
        <ToolInput input={toolPart.input ?? {}} />
        <ToolOutput errorText={toolPart.errorText} output={toolPart.output} />
      </ToolContent>
    </Tool>
  );
}

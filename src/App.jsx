import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { toPng } from "html-to-image";
import { RotateCcwIcon } from "lucide-react";

import {
  DEFAULTS,
  HISTORY_LIMIT,
  STORAGE_KEY,
  clamp,
  clampInt,
  createMarkdownFilename,
  formatDate,
  mergeDefaults,
  normalizeBaseUrl,
  parseHeadersJson,
  shortUrl,
} from "./core.js";
import { createTranslator, detectLocale } from "./i18n.js";
import { renderMarkdown } from "./render-markdown.js";
import { runDebate, runDebateFromStep } from "./services/debate-orchestrator.js";
import { chatCompletion } from "./services/chat.js";
import { createMcpRuntime } from "./services/mcp.js";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
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

const DEFAULT_TAB = "debate";

export function App() {
  const [data, setData] = useState(() => loadState());
  const [tab, setTab] = useState(DEFAULT_TAB);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);
  const [feedback, setFeedback] = useState({ text: "", error: false });
  const [settingsBusy, setSettingsBusy] = useState("");
  const [exportingImage, setExportingImage] = useState(false);
  const [engineStatus, setEngineStatus] = useState({ text: "", warn: false });
  const [debateSetupOpen, setDebateSetupOpen] = useState(true);
  const [debateForm, setDebateForm] = useState(() => createDebateForm(loadState()));
  const [currentSession, setCurrentSession] = useState(null);

  const abortRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const exportShellRef = useRef(null);
  const debateChat = useChat({ id: "debate-thread", messages: [] });

  const t = createTranslator(data.defaults.locale);
  const transcript = debateChat.messages;
  const settingsReady = hasValidSettings(data);
  const activeRecord = data.currentDebateId ? data.history.find((item) => item.id === data.currentDebateId) : null;
  const liveRecord = currentSession || activeRecord || null;

  useEffect(() => {
    document.documentElement.lang = data.defaults.locale;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    if (!settingsReady) {
      setTab("settings");
    }
  }, [settingsReady]);

  useEffect(() => {
    if (!activeRecord) {
      setReport(null);
      debateChat.setMessages([]);
      return;
    }
    setReport(activeRecord.report || null);
    debateChat.setMessages(Array.isArray(activeRecord.transcript) ? activeRecord.transcript : []);
    setCurrentSession({
      topic: activeRecord.topic,
      context: activeRecord.context || "",
      rounds: activeRecord.rounds,
      outputLanguage: activeRecord.outputLanguage,
      maxTokensPerTurn: activeRecord.maxTokensPerTurn,
    });
  }, [activeRecord?.id]);

  useEffect(() => {
    setEngineStatus({ text: running ? t("running") : t("idle"), warn: false });
  }, [data.defaults.locale]);

  function setTimedFeedback(text, error = false) {
    clearTimeout(feedbackTimerRef.current);
    setFeedback({ text: humanizeErrorMessage(text, data.defaults.locale), error });
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback({ text: "", error: false });
    }, 4200);
  }

  function updateLocale(locale) {
    const outputLanguage = locale === "zh-CN" ? "简体中文" : "English";
    setData((current) => ({
      ...current,
      defaults: {
        ...current.defaults,
        locale,
        outputLanguage,
        reportLabels: createReportLabels(createTranslator(locale)),
      },
    }));
    setDebateForm((current) => ({
      ...current,
      language: outputLanguage,
    }));
  }

  function updateAgent(agentKey, field, value) {
    setData((current) => ({
      ...current,
      agents: {
        ...current.agents,
        [agentKey]: {
          ...current.agents[agentKey],
          [field]: field === "baseUrl" ? normalizeBaseUrl(value) : value,
        },
      },
    }));
  }

  function updateDefaults(field, value) {
    setData((current) => ({
      ...current,
      defaults: {
        ...current.defaults,
        [field]: value,
      },
    }));
  }

  function updateMcp(index, field, value) {
    setData((current) => ({
      ...current,
      mcps: current.mcps.map((item, itemIndex) => (
        itemIndex === index
          ? {
              ...item,
              [field]: field === "url" ? normalizeBaseUrl(value) : value,
            }
          : item
      )),
    }));
  }

  async function handleAgentTest(agentKey) {
    try {
      const agent = data.agents[agentKey];
      setSettingsBusy(`agent:${agentKey}`);
      setTimedFeedback(t("testingAgent", { name: getLocalizedAgentName(agentKey, t) }));
      const completion = await chatCompletion(
        agent,
        [
          { role: "system", content: "Reply with OK only." },
          { role: "user", content: "Connection test." },
        ],
        24,
        { stream: false },
      );
      setTimedFeedback(`${getLocalizedAgentName(agentKey, t)} OK: ${completion.text.slice(0, 80)}`);
    } catch (error) {
      setTimedFeedback(error.message || "Agent connection test failed.", true);
    } finally {
      setSettingsBusy("");
    }
  }

  async function handleMcpTest(index) {
    try {
      const server = data.mcps[index];
      parseHeadersJson(server.headers);
      setSettingsBusy(`mcp:${server.id}`);
      setTimedFeedback(t("testingMcp", { name: server.name || `MCP ${index + 1}` }));
      const runtime = createMcpRuntime(data.mcps);
      try {
        const tools = await runtime.listTools(server);
        setData((current) => ({
          ...current,
          mcps: current.mcps.map((item, itemIndex) => (
            itemIndex === index ? { ...item, toolCache: tools } : item
          )),
        }));
        setTimedFeedback(t("connectedDiscovered", { name: server.name || `MCP ${index + 1}`, count: tools.length }));
      } finally {
        await runtime.close();
      }
    } catch (error) {
      setTimedFeedback(error.message || "MCP test failed.", true);
    } finally {
      setSettingsBusy("");
    }
  }

  async function handleRunDebate(event) {
    event.preventDefault();
    if (running) return;
    if (!settingsReady) {
      setTab("settings");
      alert(t("missingSettingsAlert"));
      return;
    }

    const topic = debateForm.topic.trim();
    if (!topic) return;

    const rounds = clampInt(Number(debateForm.rounds || data.defaults.rounds), 1, 10);
    const outputLanguage = debateForm.language.trim() || data.defaults.outputLanguage;
    const maxTokensPerTurn = clampInt(Number(debateForm.maxTokens || data.defaults.maxTokensPerTurn), 128, 8000);
    const context = debateForm.context.trim();
    const controller = new AbortController();
    const session = {
      topic,
      context,
      rounds,
      outputLanguage,
      maxTokensPerTurn,
    };

    abortRef.current = controller;
    setRunning(true);
    setDebateSetupOpen(false);
    debateChat.setMessages([]);
    setReport(null);
    setCurrentSession(session);
    setEngineStatus({ text: t("preparing"), warn: false });

    try {
      await executeDebateRun({
        runner: runDebate,
        session,
        controller,
      });

      setEngineStatus({ text: t("completed"), warn: false });
      setTimedFeedback(t("reportReady"));
    } catch (error) {
      if (error?.name === "AbortError") {
        setEngineStatus({ text: t("stopped"), warn: true });
        setTimedFeedback(t("debateStopped"));
      } else {
        setEngineStatus({ text: t("runFailed"), warn: true });
        alert(error.message || "Debate run failed.");
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  async function handleRerunEntry(target) {
    if (running || !currentSession || target?.stepIndex == null) return;
    const stepIndex = target.stepIndex;
    const controller = new AbortController();
    const baseTranscript = transcript.filter((item) => {
      const itemStep = item.metadata?.stepIndex;
      return typeof itemStep === "number" && itemStep < stepIndex;
    });
    const seedReport = target.phase === "judge-article" ? report : null;

    abortRef.current = controller;
    setRunning(true);
    debateChat.setMessages(baseTranscript);
    setReport(seedReport);
    setEngineStatus({ text: t("preparing"), warn: false });

    try {
      await executeDebateRun({
        runner: (payload, handlers) => runDebateFromStep(payload, baseTranscript, stepIndex, handlers, seedReport),
        session: currentSession,
        controller,
      });
      setEngineStatus({ text: t("completed"), warn: false });
      setTimedFeedback(t("reportReady"));
    } catch (error) {
      if (error?.name === "AbortError") {
        setEngineStatus({ text: t("stopped"), warn: true });
        setTimedFeedback(t("debateStopped"));
      } else {
        setEngineStatus({ text: t("runFailed"), warn: true });
        alert(error.message || "Debate rerun failed.");
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  async function executeDebateRun({ runner, session, controller }) {
    await runner(
      {
        locale: data.defaults.locale,
        debate: session,
        defaults: {
          judgeRetries: data.defaults.judgeRetries,
          maxToolSteps: data.defaults.maxToolSteps,
          writingStyle: data.defaults.writingStyle,
          streamResponses: data.defaults.streamResponses,
        },
        agents: structuredClone(data.agents),
        mcps: structuredClone(data.mcps),
      },
      {
        signal: controller.signal,
        onStatus(text) {
          setEngineStatus({ text, warn: false });
        },
        onEntry(entry) {
          debateChat.setMessages((current) => [...current, entry]);
        },
        onEntryUpdate(update) {
          debateChat.setMessages((current) => applyTranscriptPatch(current, update.id, update.patch));
        },
        onReportUpdate(update) {
          debateChat.setMessages((current) => {
            const judgeIndex = findLastJudgeIndex(current);
            if (judgeIndex === -1) return current;
            const next = [...current];
            const judgeEntry = { ...next[judgeIndex] };
            if (typeof update.draftBody === "string") judgeEntry.body = update.draftBody;
            if (typeof update.draftReasoning === "string") judgeEntry.reasoning = update.draftReasoning;
            next[judgeIndex] = judgeEntry;
            return next;
          });
        },
        onReport(nextReport) {
          setReport(nextReport);
        },
        onComplete(result) {
          const finalTranscript = Array.isArray(result.transcript) ? result.transcript : [];
          const finalReport = result.report || null;
          debateChat.setMessages(finalTranscript);
          setReport(finalReport);

          if (!finalReport) return;

          const record = {
            id: crypto.randomUUID(),
            topic: session.topic,
            context: session.context,
            rounds: session.rounds,
            outputLanguage: session.outputLanguage,
            maxTokensPerTurn: session.maxTokensPerTurn,
            winner: finalReport.winner,
            createdAt: new Date().toISOString(),
            transcript: finalTranscript,
            report: finalReport,
            markdown: finalReport.markdown,
          };

          setData((current) => ({
            ...current,
            history: [record, ...current.history].slice(0, HISTORY_LIMIT),
            currentDebateId: record.id,
          }));
        },
      },
    );
  }

  function handleStopDebate() {
    abortRef.current?.abort(new DOMException("Debate stopped", "AbortError"));
  }

  function handleOpenHistory(id) {
    setData((current) => ({ ...current, currentDebateId: id }));
    setTab("report");
  }

  function handleDeleteHistory(id) {
    setData((current) => {
      const history = current.history.filter((item) => item.id !== id);
      const nextId = current.currentDebateId === id ? history[0]?.id || null : current.currentDebateId;
      return {
        ...current,
        history,
        currentDebateId: nextId,
      };
    });
  }

  async function handleExportTranscriptImage() {
    if (!transcript.length || !exportShellRef.current) return;
    setExportingImage(true);
    try {
      const dataUrl = await toPng(exportShellRef.current, {
        cacheBust: true,
        pixelRatio: Math.max(2, Math.min(3, globalThis.devicePixelRatio || 1)),
        backgroundColor: "#f6efe4",
      });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = createMarkdownFilename(debateForm.topic || liveRecord?.topic || "debate-transcript").replace(/\.md$/i, ".png");
      anchor.click();
    } catch (error) {
      alert(error?.message || t("exportImageFailed"));
    } finally {
      setExportingImage(false);
    }
  }

  function handleExportMarkdown() {
    if (!report?.markdown) return;
    const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = createMarkdownFilename(debateForm.topic || liveRecord?.topic || "debate-report");
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  async function handleCopyMarkdown() {
    if (!report?.markdown) return;
    try {
      await navigator.clipboard.writeText(report.markdown);
      setTimedFeedback(t("markdownCopied"));
    } catch {
      setTimedFeedback(t("copyFailed"), true);
    }
  }

  function handleClearStorage() {
    if (!confirm(t("clearStorageConfirm"))) return;
    localStorage.removeItem(STORAGE_KEY);
    globalThis.location.reload();
  }

  const settingsStatusClass = settingsReady ? "status-pill" : "status-pill warn";
  const engineStatusClass = `status-pill ${engineStatus.warn ? "warn" : "muted"}${running ? " loading" : ""}`;

  return (
    <>
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-brand">
            <p className="eyebrow">{t("appTagline")}</p>
            <h1>Agent Debate</h1>
          </div>
          <div className="topbar-actions">
            <nav className="nav-tabs nav-tabs-top" aria-label="Primary">
              {[
                ["debate", t("navDebate")],
                ["report", t("navReport")],
                ["history", t("navHistory")],
                ["settings", t("navSettings")],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={`nav-tab ${tab === value ? "active" : ""}`}
                  type="button"
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <label className="locale-switch">
              <span>{t("languageLabel")}</span>
              <select value={data.defaults.locale} onChange={(event) => updateLocale(event.target.value)}>
                <option value="zh-CN">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <span className={settingsStatusClass}>{settingsReady ? t("settingsReady") : t("settingsRequired")}</span>
            <button className="ghost-button" type="button" onClick={handleClearStorage}>
              {t("clearLocalData")}
            </button>
          </div>
        </header>

        <main className="content-shell">
          <section className={`panel ${tab === "debate" ? "active" : ""}`}>
            <div className="debate-stage">
              <div className="debate-primary">
                <div className="hero-card hero-card-compact">
                  <div>
                    <p className="eyebrow">{t("heroEyebrow")}</p>
                    <h2>{t("heroTitle")}</h2>
                  </div>
                  <p className="hero-copy">{t("heroCopy")}</p>
                </div>

                <details className="setup-panel" open={debateSetupOpen} onToggle={(event) => setDebateSetupOpen(event.currentTarget.open)}>
                  <summary className="setup-summary">
                    <div>
                      <p className="section-kicker">{t("debateSetup")}</p>
                      <h3>{t("debateSetupTitle")}</h3>
                    </div>
                    <span className="setup-chevron">+</span>
                  </summary>

                  <form className="card stack-lg debate-form-card" onSubmit={handleRunDebate}>
                    <div className="field">
                      <label htmlFor="topic">{t("debateTopic")}</label>
                      <input
                        id="topic"
                        value={debateForm.topic}
                        maxLength={300}
                        placeholder={t("debateTopicPlaceholder")}
                        onChange={(event) => setDebateForm((current) => ({ ...current, topic: event.target.value }))}
                        required
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="context">{t("context")}</label>
                      <textarea
                        id="context"
                        rows={6}
                        maxLength={4000}
                        placeholder={t("contextPlaceholder")}
                        value={debateForm.context}
                        onChange={(event) => setDebateForm((current) => ({ ...current, context: event.target.value }))}
                      />
                    </div>

                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="rounds">{t("rounds")}</label>
                        <input
                          id="rounds"
                          type="number"
                          min="1"
                          max="10"
                          value={debateForm.rounds}
                          onChange={(event) => setDebateForm((current) => ({ ...current, rounds: event.target.value }))}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="language">{t("outputLanguage")}</label>
                        <input
                          id="language"
                          value={debateForm.language}
                          onChange={(event) => setDebateForm((current) => ({ ...current, language: event.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="field">
                      <label htmlFor="maxTokens">{t("maxTokensPerTurn")}</label>
                      <input
                        id="maxTokens"
                        type="number"
                        min="128"
                        max="8000"
                        value={debateForm.maxTokens}
                        onChange={(event) => setDebateForm((current) => ({ ...current, maxTokens: event.target.value }))}
                      />
                    </div>

                    <div className="button-row">
                      <button className="primary-button" type="submit" disabled={running}>
                        {t("runDebate")}
                      </button>
                      <button className="ghost-button" type="button" onClick={handleStopDebate} disabled={!running}>
                        {t("stopDebate")}
                      </button>
                      <button className="ghost-button" type="button" onClick={() => setTab("settings")}>
                        {t("openSettings")}
                      </button>
                    </div>
                  </form>
                </details>
              </div>

              <section className="sidebar-card system-card">
                <p className="sidebar-label">{t("system")}</p>
                <div className="system-summary">
                  {buildSystemItems(data, t).map((item) => (
                    <div className="system-item" key={item.label}>
                      <p className="meta-label">{item.label}</p>
                      <p>{item.value}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="arena-panel">
              <div className="section-head arena-head">
                <div>
                  <p className="section-kicker">{t("liveTranscript")}</p>
                  <h3>{t("debateFlow")}</h3>
                </div>
                <div className="arena-status">
                  <div className="button-row">
                    <button className="ghost-button" type="button" onClick={handleExportTranscriptImage} disabled={!transcript.length || exportingImage}>
                      {exportingImage ? t("exporting") : t("exportLongImage")}
                    </button>
                  </div>
                  <div className="active-debate-meta">
                    {buildActiveChips(liveRecord || debateForm, t).map((chip) => (
                      <span className="active-chip" key={chip}>{chip}</span>
                    ))}
                  </div>
                  <span className={engineStatusClass}>{engineStatus.text || t("idle")}</span>
                </div>
              </div>

              <div className={`transcript ${transcript.length ? "transcript-chat" : "empty"}`}>
                {!transcript.length ? (
                  <Conversation className="ai-conversation ai-conversation-empty">
                    <ConversationEmptyState
                      title={t("noDebateYet")}
                      description={t("heroCopy")}
                    />
                  </Conversation>
                ) : (
                  <Conversation className="ai-conversation">
                    <ConversationContent
                      className="ai-conversation-content"
                      scrollClassName="ai-conversation-scroll"
                    >
                      <div className="transcript-export-shell" ref={exportShellRef}>
                        <div className="transcript-watermark">
                          <span>Agent Debate</span>
                          <span>{formatDate(new Date().toISOString())}</span>
                        </div>
                        <div className="chat-thread ai-chat-thread">
                          {transcript.map((entry, index) => (
                            <TranscriptEntry
                              key={entry.id}
                              entry={entry}
                              index={index}
                              locale={data.defaults.locale}
                              t={t}
                              running={running}
                              onRerun={handleRerunEntry}
                            />
                          ))}
                        </div>
                      </div>
                    </ConversationContent>
                    <ConversationScrollButton className="ai-scroll-button" />
                  </Conversation>
                )}
              </div>
            </section>
          </section>

          <section className={`panel ${tab === "report" ? "active" : ""}`}>
            <div className="section-head">
              <div>
                <p className="section-kicker">{t("judgeOutput")}</p>
                <h2>{t("structuredReport")}</h2>
              </div>
              <div className="button-row">
                <button className="ghost-button" type="button" onClick={handleCopyMarkdown}>{t("copyMarkdown")}</button>
                <button className="ghost-button" type="button" onClick={handleExportMarkdown}>{t("exportMarkdown")}</button>
              </div>
            </div>
            <ReportPanel report={report} transcript={transcript} t={t} />
          </section>

          <section className={`panel ${tab === "history" ? "active" : ""}`}>
            <div className="section-head">
              <div>
                <p className="section-kicker">{t("savedLocally")}</p>
                <h2>{t("history")}</h2>
              </div>
            </div>
            <HistoryPanel history={data.history} t={t} onOpen={handleOpenHistory} onDelete={handleDeleteHistory} />
          </section>

          <section className={`panel ${tab === "settings" ? "active" : ""}`}>
            <div className="section-head">
              <div>
                <p className="section-kicker">{t("bringYourOwnKey")}</p>
                <h2>{t("settings")}</h2>
              </div>
            </div>

            <div className="notice-card">
              <p>{t("localStorageNotice1")}</p>
              <p>{t("localStorageNotice2")}</p>
              <p>{t("localStorageNotice3")}</p>
            </div>

            <div className="settings-layout">
              {["pro", "con", "judge"].map((agentKey) => {
                const agent = data.agents[agentKey];
                return (
                  <section className="settings-section" key={agentKey}>
                    <div className="section-head">
                      <div>
                        <p className="section-kicker">{t("agentConfig")}</p>
                        <h3>{getLocalizedAgentName(agentKey, t)}</h3>
                      </div>
                      <button className="ghost-button" type="button" onClick={() => handleAgentTest(agentKey)} disabled={Boolean(settingsBusy)}>
                        {settingsBusy === `agent:${agentKey}` ? t("preparing") : t("testConnection")}
                      </button>
                    </div>
                    <div className="settings-grid">
                      <div className="field full">
                        <label>{t("baseUrl")}</label>
                        <input value={agent.baseUrl} onChange={(event) => updateAgent(agentKey, "baseUrl", event.target.value)} />
                      </div>
                      <div className="field">
                        <label>{t("model")}</label>
                        <input value={agent.model} onChange={(event) => updateAgent(agentKey, "model", event.target.value)} />
                      </div>
                      <div className="field">
                        <label>{t("apiKey")}</label>
                        <input type="password" value={agent.apiKey} onChange={(event) => updateAgent(agentKey, "apiKey", event.target.value)} />
                      </div>
                      <div className="field">
                        <label>{t("temperature")}</label>
                        <input
                          type="number"
                          min="0"
                          max="2"
                          step="0.1"
                          value={agent.temperature}
                          onChange={(event) => updateAgent(agentKey, "temperature", clamp(Number(event.target.value || 0.7), 0, 2))}
                        />
                      </div>
                      <div className="field full">
                        <label>{t("attachedMcpServers")}</label>
                        <div className="capability-list">
                          {data.mcps.filter((server) => server.enabled !== false).length ? data.mcps.filter((server) => server.enabled !== false).map((server) => (
                            <label className="check-card" key={`${agentKey}:${server.id}`}>
                              <input
                                type="checkbox"
                                checked={agent.mcpIds.includes(server.id)}
                                onChange={(event) => updateAgent(agentKey, "mcpIds", toggleId(agent.mcpIds, server.id, event.target.checked))}
                              />
                              <span>
                                <strong>{server.name}</strong>
                                <small>{server.description || shortUrl(server.url)}</small>
                              </span>
                            </label>
                          )) : <p className="inline-hint">{t("noEnabledMcpsConfigured")}</p>}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}

              <section className="settings-section">
                <div className="section-head">
                  <div>
                    <p className="section-kicker">{t("runDefaults")}</p>
                    <h3>{t("defaultParameters")}</h3>
                  </div>
                </div>
                <div className="settings-grid">
                  <div className="field">
                    <label>{t("defaultRounds")}</label>
                    <input type="number" min="1" max="10" value={data.defaults.rounds} onChange={(event) => updateDefaults("rounds", clampInt(Number(event.target.value || 5), 1, 10))} />
                  </div>
                  <div className="field">
                    <label>{t("defaultOutputLanguage")}</label>
                    <input value={data.defaults.outputLanguage} onChange={(event) => updateDefaults("outputLanguage", event.target.value)} />
                  </div>
                  <div className="field">
                    <label>{t("maxTokensPerTurn")}</label>
                    <input type="number" min="128" max="8000" value={data.defaults.maxTokensPerTurn} onChange={(event) => updateDefaults("maxTokensPerTurn", clampInt(Number(event.target.value || 4096), 128, 8000))} />
                  </div>
                  <div className="field">
                    <label>{t("writingStyle")}</label>
                    <select value={data.defaults.writingStyle} onChange={(event) => updateDefaults("writingStyle", event.target.value)}>
                      <option value="balanced">{t("styleBalanced")}</option>
                      <option value="conversational">{t("styleConversational")}</option>
                      <option value="sharp">{t("styleSharp")}</option>
                      <option value="formal">{t("styleFormal")}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>{t("maxToolSteps")}</label>
                    <input type="number" min="0" max="5" value={data.defaults.maxToolSteps} onChange={(event) => updateDefaults("maxToolSteps", clampInt(Number(event.target.value || 0), 0, 5))} />
                  </div>
                  <div className="field">
                    <label>{t("judgeRetries")}</label>
                    <input type="number" min="0" max="4" value={data.defaults.judgeRetries} onChange={(event) => updateDefaults("judgeRetries", clampInt(Number(event.target.value || 0), 0, 4))} />
                  </div>
                  <label className="check-card field full toggle-card">
                    <input type="checkbox" checked={data.defaults.streamResponses !== false} onChange={(event) => updateDefaults("streamResponses", event.target.checked)} />
                    <span>
                      <strong>{t("streamResponses")}</strong>
                      <small>{t("streamResponsesHint")}</small>
                    </span>
                  </label>
                </div>
              </section>

              <section className="settings-section">
                <div className="section-head">
                  <div>
                    <p className="section-kicker">{t("remoteTools")}</p>
                    <h3>{t("mcpServers")}</h3>
                  </div>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setData((current) => ({
                      ...current,
                      mcps: [
                        ...current.mcps,
                        {
                          id: crypto.randomUUID(),
                          name: t("addMcpDefault", { count: current.mcps.length + 1 }),
                          url: "",
                          description: "",
                          headers: "",
                          enabled: true,
                          toolCache: [],
                        },
                      ],
                    }))}
                  >
                    {t("addMcp")}
                  </button>
                </div>
                <div className="stack-lg">
                  {data.mcps.length ? data.mcps.map((server, index) => (
                    <article className="capability-editor" key={server.id}>
                      <div className="section-head">
                        <h4>{server.name || t("addMcpDefault", { count: index + 1 })}</h4>
                        <div className="button-row">
                          <button className="ghost-button" type="button" onClick={() => handleMcpTest(index)} disabled={Boolean(settingsBusy)}>
                            {settingsBusy === `mcp:${server.id}` ? t("preparing") : t("testAndDiscover")}
                          </button>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() => setData((current) => ({
                              ...current,
                              mcps: current.mcps.filter((item) => item.id !== server.id),
                              agents: Object.fromEntries(
                                Object.entries(current.agents).map(([key, agent]) => [
                                  key,
                                  { ...agent, mcpIds: agent.mcpIds.filter((id) => id !== server.id) },
                                ]),
                              ),
                            }))}
                          >
                            {t("remove")}
                          </button>
                        </div>
                      </div>
                      <div className="settings-grid">
                        <div className="field">
                          <label>{t("name")}</label>
                          <input value={server.name} onChange={(event) => updateMcp(index, "name", event.target.value)} />
                        </div>
                        <div className="field full">
                          <label>{t("httpEndpoint")}</label>
                          <input value={server.url} onChange={(event) => updateMcp(index, "url", event.target.value)} />
                        </div>
                        <div className="field full">
                          <label>{t("description")}</label>
                          <textarea rows={2} value={server.description || ""} onChange={(event) => updateMcp(index, "description", event.target.value)} />
                        </div>
                        <div className="field full">
                          <label>{t("headersJson")}</label>
                          <textarea rows={3} value={server.headers || ""} onChange={(event) => updateMcp(index, "headers", event.target.value)} />
                        </div>
                        <label className="check-card field full toggle-card">
                          <input type="checkbox" checked={server.enabled !== false} onChange={(event) => updateMcp(index, "enabled", event.target.checked)} />
                          <span>
                            <strong>{t("enabled")}</strong>
                            <small>{t("enabledHint")}</small>
                          </span>
                        </label>
                        <div className="field full">
                          <label>{t("discoveredTools")}</label>
                          <div className="tool-cache">
                            {(server.toolCache || []).length
                              ? server.toolCache.map((tool) => <span className="tool-chip" key={`${server.id}:${tool.name}`}>{tool.name}</span>)
                              : <p className="inline-hint">{t("noToolsDiscovered")}</p>}
                          </div>
                        </div>
                      </div>
                    </article>
                  )) : <p className="inline-hint">{t("noMcpConfigured")}</p>}
                </div>
              </section>
            </div>
          </section>
        </main>
      </div>

      <div className={`inline-feedback toast-feedback ${feedback.text ? "visible" : ""}${feedback.error ? " error" : ""}`}>
        {feedback.text}
      </div>
    </>
  );
}

function TranscriptEntry({ entry, index, locale, t, running, onRerun }) {
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

function ReportPanel({ report, transcript, t }) {
  const draftJudgeEntry = [...transcript].reverse().find((entry) => entry.agent === "judge");
  if (!report) {
    if (draftJudgeEntry) {
      const textPart = (draftJudgeEntry.parts || []).find((part) => part.type === "text");
      const reasoningPart = (draftJudgeEntry.parts || []).find((part) => part.type === "reasoning");
      return (
        <div className="report-layout">
          <section className="report-card">
            <p className="section-kicker">{t("reportPreview")}</p>
            <h3 className="report-winner">{draftJudgeEntry.metadata?.title || draftJudgeEntry.title}</h3>
            <MessageResponse className="ai-response report-response">
              {textPart?.text || t("preparing")}
            </MessageResponse>
            {reasoningPart?.text ? (
              <Reasoning className="ai-reasoning report-reasoning" defaultOpen={false}>
                <ReasoningTrigger className="ai-reasoning-trigger">
                  <div className="ai-activity-copy">
                    <span className="activity-label">{t("thinking")}</span>
                    <span className="activity-summary">{t("thinkingReady")}</span>
                  </div>
                </ReasoningTrigger>
                <ReasoningContent className="ai-response ai-reasoning-content">
                  {reasoningPart.text}
                </ReasoningContent>
              </Reasoning>
            ) : null}
          </section>
        </div>
      );
    }
    return <div className="report-layout empty-state"><p>{t("noReportAvailable")}</p></div>;
  }

  return (
    <div className="report-layout">
      <div className="report-grid">
        <section className="report-card">
          <p className="section-kicker">{t("reportArticle")}</p>
          <MessageResponse className="ai-response report-response">
            {report.reportArticle || report.judgeReasoning}
          </MessageResponse>
        </section>
      </div>

      <div className="report-grid">
        <section className="report-card">
          <p className="section-kicker">{t("outcome")}</p>
          <h3 className="report-winner">{formatWinner(report.winner, t)} {t("wins")}</h3>
          <MessageResponse className="ai-response report-response">
            {report.judgeReasoning}
          </MessageResponse>
        </section>
      </div>

      {report.keyArgumentsPro?.length || report.keyArgumentsCon?.length ? (
        <div className="report-grid">
          <section className="report-card">
            <p className="section-kicker">{t("keyArguments")}</p>
            {report.keyArgumentsPro?.length ? (
              <>
                <h4>{t("pro")}</h4>
                {renderSimpleList(report.keyArgumentsPro, t)}
              </>
            ) : null}
            {report.keyArgumentsCon?.length ? (
              <>
                <h4>{t("con")}</h4>
                {renderSimpleList(report.keyArgumentsCon, t)}
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      {report.keyDisagreements?.length || report.unresolvedQuestions?.length ? (
        <div className="report-grid">
          {report.keyDisagreements?.length ? (
            <section className="report-card">
              <p className="section-kicker">{t("coreDisagreements")}</p>
              {renderSimpleList(report.keyDisagreements, t)}
            </section>
          ) : null}
          {report.unresolvedQuestions?.length ? (
            <section className="report-card">
              <p className="section-kicker">{t("unresolvedQuestions")}</p>
              {renderSimpleList(report.unresolvedQuestions, t)}
            </section>
          ) : null}
        </div>
      ) : null}

      <section className="report-card">
        <p className="section-kicker">{t("markdown")}</p>
        <details className="reasoning-panel compact">
          <summary><span>{t("markdown")}</span></summary>
          <div className="markdown-box">{report.markdown}</div>
        </details>
      </section>
    </div>
  );
}

function HistoryPanel({ history, t, onOpen, onDelete }) {
  if (!history.length) {
    return <div className="history-list empty-state"><p>{t("noHistoryYet")}</p></div>;
  }

  return (
    <div className="history-list">
      {history.map((item) => (
        <article className="history-item" key={item.id}>
          <div className="history-item-head">
            <p className="history-topic">{item.topic}</p>
            <span className="history-meta">{formatDate(item.createdAt)}</span>
          </div>
          <p className="history-meta">{t("winnerLabel")}: {formatWinner(item.winner, t)} · {t("roundsSuffix", { count: Number(item.rounds || 0) })}</p>
          <div className="history-actions">
            <button className="ghost-button" type="button" onClick={() => onOpen(item.id)}>{t("open")}</button>
            <button className="ghost-button" type="button" onClick={() => onDelete(item.id)}>{t("delete")}</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return withLocaleDefaults(structuredClone(DEFAULTS));
  try {
    return withLocaleDefaults(mergeDefaults(JSON.parse(raw)));
  } catch {
    return withLocaleDefaults(structuredClone(DEFAULTS));
  }
}

function withLocaleDefaults(state) {
  const locale = state.defaults.locale || detectLocale(globalThis.navigator?.language);
  const outputLanguage = state.defaults.outputLanguage || (locale === "zh-CN" ? "简体中文" : "English");
  return {
    ...state,
    defaults: {
      ...state.defaults,
      locale,
      outputLanguage,
      reportLabels: createReportLabels(createTranslator(locale)),
    },
  };
}

function createDebateForm(data) {
  return {
    topic: "",
    context: "",
    rounds: String(data.defaults.rounds),
    language: data.defaults.outputLanguage,
    maxTokens: String(data.defaults.maxTokensPerTurn),
  };
}

function hasValidSettings(data) {
  return ["pro", "con", "judge"].every((key) => {
    const agent = data.agents[key];
    return Boolean(agent.baseUrl && agent.apiKey && agent.model);
  });
}

function createReportLabels(t) {
  return {
    reportTitle: t("reportTitle"),
    reportTopic: t("reportTopic"),
    winnerLabel: t("winnerLabel"),
    winnerPro: t("winnerPro"),
    winnerCon: t("winnerCon"),
    keyArgumentsPro: t("keyArgumentsPro"),
    keyArgumentsCon: t("keyArgumentsCon"),
    keyDisagreements: t("coreDisagreements"),
    unresolvedQuestions: t("unresolvedQuestions"),
    judgeReasoning: t("judgeOutput"),
    reportArticle: t("reportArticle"),
  };
}

function applyTranscriptPatch(transcript, id, patch) {
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

function findLastJudgeIndex(transcript) {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (transcript[index].agent === "judge") return index;
  }
  return -1;
}

function buildSystemItems(data, t) {
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

function buildActiveChips(active, t) {
  if (!active?.topic) return [];
  return [
    `${t("activeDebate")}: ${active.topic}`,
    `${t("rounds")}: ${active.rounds || "-"}`,
    `${t("outputLanguage")}: ${active.outputLanguage || active.language || "-"}`,
  ];
}

function agentSummary(agent, t) {
  if (!agent.baseUrl || !agent.model || !agent.apiKey) return t("notConfigured");
  return `${agent.model} · ${agent.mcpIds.length} ${t("mcp")}`;
}

function resolveEntrySide(agent) {
  if (agent === "pro") return "outgoing";
  if (agent === "con") return "incoming";
  return "center";
}

function getEntryBadge(agent) {
  return agent === "pro" ? "P" : agent === "con" ? "C" : agent === "judge" ? "J" : "A";
}

function getLocalizedAgentName(agentKey, t) {
  if (agentKey === "pro") return t("proAgent");
  if (agentKey === "con") return t("conAgent");
  return t("judgeAgent");
}

function formatWinner(winner, t) {
  if (winner === "Con") return t("winnerCon");
  if (winner === "Pro") return t("winnerPro");
  return t("winnerUnknown");
}

function renderSimpleList(items, t) {
  if (!items?.length) return <p className="report-body">{t("none")}.</p>;
  return <ul>{items.map((item, index) => <li key={`${index}:${item}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(item) }} />)}</ul>;
}

function summarizeToolParts(toolParts, t) {
  const runningCount = toolParts.filter((tool) => tool.state === "input-available").length;
  if (runningCount) return t("toolRunningCount", { count: runningCount });
  if (toolParts.length === 1) return toolParts[0].toolName;
  return t("toolCountMeta", { count: toolParts.length });
}

function humanizeErrorMessage(message, locale) {
  const text = String(message || "").trim();
  if (!text) return "";
  if (text === "Failed to fetch") {
    return locale === "zh-CN"
      ? "连接失败。目标 MCP 无法被浏览器直接访问，或远端返回被拦截。请确认你是通过本项目服务端入口访问，而不是直接打开静态文件。"
      : "Connection failed. The MCP endpoint could not be reached directly from the browser or the upstream response was blocked. Make sure you are using the app through its server entry instead of opening the HTML file directly.";
  }
  return text;
}

function toggleId(ids, id, checked) {
  return checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id);
}

function capitalize(value) {
  const text = String(value || "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

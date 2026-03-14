import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";

import {
  HISTORY_LIMIT,
  STORAGE_KEY,
  clampInt,
  createMarkdownFilename,
  formatDate,
  normalizeBaseUrl,
  parseHeadersJson,
} from "./core.js";
import { createTranslator, createReportLabels } from "./i18n.js";
import { runDebate, runDebateFromStep } from "./services/debate-orchestrator.js";
import { chatCompletion, clearProviderCache } from "./services/chat.js";
import { createMcpRuntime } from "./services/mcp.js";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { TranscriptEntry } from "./components/TranscriptEntry.jsx";
import { ReportPanel } from "./components/ReportPanel.jsx";
import { HistoryPanel } from "./components/HistoryPanel.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import {
  loadState,
  createDebateForm,
  hasValidSettings,
  applyTranscriptPatch,
  findLastJudgeIndex,
  buildSystemItems,
  buildActiveChips,
  getLocalizedAgentName,
  humanizeErrorMessage,
} from "./utils/app-helpers.jsx";

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
  const [transcript, setTranscript] = useState([]);

  const t = createTranslator(data.defaults.locale);
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
      setTranscript([]);
      return;
    }
    setReport(activeRecord.report || null);
    setTranscript(Array.isArray(activeRecord.transcript) ? activeRecord.transcript : []);
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
        reportLabels: createReportLabels(locale),
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
    setTranscript([]);
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
    setTranscript(baseTranscript);
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
          setTranscript((current) => [...current, entry]);
        },
        onEntryUpdate(update) {
          setTranscript((current) => applyTranscriptPatch(current, update.id, update.patch));
        },
        onReportUpdate(update) {
          setTranscript((current) => {
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
          setTranscript(finalTranscript);
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
        backgroundColor: "#f6f1e8",
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
    clearProviderCache();
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

            <SettingsPanel
              data={data}
              t={t}
              settingsBusy={settingsBusy}
              onUpdateAgent={updateAgent}
              onUpdateDefaults={updateDefaults}
              onUpdateMcp={updateMcp}
              onSetData={setData}
              onAgentTest={handleAgentTest}
              onMcpTest={handleMcpTest}
            />
          </section>
        </main>
      </div>

      <div className={`inline-feedback toast-feedback ${feedback.text ? "visible" : ""}${feedback.error ? " error" : ""}`}>
        {feedback.text}
      </div>
    </>
  );
}

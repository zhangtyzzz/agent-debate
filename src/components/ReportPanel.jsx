import {
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { formatWinner, renderSimpleList } from "../utils/app-helpers.jsx";

export function ReportPanel({ report, transcript, t }) {
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

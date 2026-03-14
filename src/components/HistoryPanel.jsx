import { formatDate } from "../core.js";
import { formatWinner } from "../utils/app-helpers.jsx";

export function HistoryPanel({ history, t, onOpen, onDelete }) {
  if (!history.length) {
    return <div className="history-list empty-state"><p>{t("noHistoryYet")}</p></div>;
  }

  return (
    <div className="history-list">
      {history.map((item) => (
        <article className={`history-item history-item-${item.winner?.toLowerCase() || 'unknown'}`} key={item.id}>
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

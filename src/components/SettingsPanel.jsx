import {
  clamp,
  clampInt,
  normalizeBaseUrl,
  shortUrl,
} from "../core.js";
import { getLocalizedAgentName, toggleId } from "../utils/app-helpers.jsx";

export function SettingsPanel({
  data,
  t,
  settingsBusy,
  onUpdateAgent,
  onUpdateDefaults,
  onUpdateMcp,
  onSetData,
  onAgentTest,
  onMcpTest,
}) {
  return (
    <div className="settings-layout">
      {["pro", "con", "judge"].map((agentKey) => {
        const agent = data.agents[agentKey];
        return (
          <section className={`settings-section settings-section-${agentKey}`} key={agentKey}>
            <div className="section-head">
              <div>
                <p className="section-kicker">{t("agentConfig")}</p>
                <h3>{getLocalizedAgentName(agentKey, t)}</h3>
              </div>
              <button className="ghost-button" type="button" onClick={() => onAgentTest(agentKey)} disabled={Boolean(settingsBusy)}>
                {settingsBusy === `agent:${agentKey}` ? t("preparing") : t("testConnection")}
              </button>
            </div>
            <div className="settings-grid">
              <div className="field full">
                <label>{t("baseUrl")}</label>
                <input value={agent.baseUrl} onChange={(event) => onUpdateAgent(agentKey, "baseUrl", event.target.value)} />
              </div>
              <div className="field">
                <label>{t("model")}</label>
                <input value={agent.model} onChange={(event) => onUpdateAgent(agentKey, "model", event.target.value)} />
              </div>
              <div className="field">
                <label>{t("apiKey")}</label>
                <input type="password" value={agent.apiKey} onChange={(event) => onUpdateAgent(agentKey, "apiKey", event.target.value)} />
              </div>
              <div className="field">
                <label>{t("temperature")}</label>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={agent.temperature}
                  onChange={(event) => onUpdateAgent(agentKey, "temperature", clamp(Number(event.target.value || 0.7), 0, 2))}
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
                        onChange={(event) => onUpdateAgent(agentKey, "mcpIds", toggleId(agent.mcpIds, server.id, event.target.checked))}
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
            <input type="number" min="1" max="10" value={data.defaults.rounds} onChange={(event) => onUpdateDefaults("rounds", clampInt(Number(event.target.value || 5), 1, 10))} />
          </div>
          <div className="field">
            <label>{t("defaultOutputLanguage")}</label>
            <input value={data.defaults.outputLanguage} onChange={(event) => onUpdateDefaults("outputLanguage", event.target.value)} />
          </div>
          <div className="field">
            <label>{t("maxTokensPerTurn")}</label>
            <input type="number" min="128" max="8000" value={data.defaults.maxTokensPerTurn} onChange={(event) => onUpdateDefaults("maxTokensPerTurn", clampInt(Number(event.target.value || 4096), 128, 8000))} />
          </div>
          <div className="field">
            <label>{t("writingStyle")}</label>
            <select value={data.defaults.writingStyle} onChange={(event) => onUpdateDefaults("writingStyle", event.target.value)}>
              <option value="balanced">{t("styleBalanced")}</option>
              <option value="conversational">{t("styleConversational")}</option>
              <option value="sharp">{t("styleSharp")}</option>
              <option value="formal">{t("styleFormal")}</option>
            </select>
          </div>
          <div className="field">
            <label>{t("maxToolSteps")}</label>
            <input type="number" min="0" max="5" value={data.defaults.maxToolSteps} onChange={(event) => onUpdateDefaults("maxToolSteps", clampInt(Number(event.target.value || 0), 0, 5))} />
          </div>
          <div className="field">
            <label>{t("judgeRetries")}</label>
            <input type="number" min="0" max="4" value={data.defaults.judgeRetries} onChange={(event) => onUpdateDefaults("judgeRetries", clampInt(Number(event.target.value || 0), 0, 4))} />
          </div>
          <label className="check-card field full toggle-card">
            <input type="checkbox" checked={data.defaults.streamResponses !== false} onChange={(event) => onUpdateDefaults("streamResponses", event.target.checked)} />
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
            onClick={() => onSetData((current) => ({
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
                  <button className="ghost-button" type="button" onClick={() => onMcpTest(index)} disabled={Boolean(settingsBusy)}>
                    {settingsBusy === `mcp:${server.id}` ? t("preparing") : t("testAndDiscover")}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => onSetData((current) => ({
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
                  <input value={server.name} onChange={(event) => onUpdateMcp(index, "name", event.target.value)} />
                </div>
                <div className="field full">
                  <label>{t("httpEndpoint")}</label>
                  <input value={server.url} onChange={(event) => onUpdateMcp(index, "url", event.target.value)} />
                </div>
                <div className="field full">
                  <label>{t("description")}</label>
                  <textarea rows={2} value={server.description || ""} onChange={(event) => onUpdateMcp(index, "description", event.target.value)} />
                </div>
                <div className="field full">
                  <label>{t("headersJson")}</label>
                  <textarea rows={3} value={server.headers || ""} onChange={(event) => onUpdateMcp(index, "headers", event.target.value)} />
                </div>
                <label className="check-card field full toggle-card">
                  <input type="checkbox" checked={server.enabled !== false} onChange={(event) => onUpdateMcp(index, "enabled", event.target.checked)} />
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
  );
}

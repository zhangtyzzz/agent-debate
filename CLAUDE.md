# Agent Debate

Local-first multi-agent debate UI. Pro, Con, and Judge agents debate structured topics via OpenAI-compatible endpoints, with MCP tool support and streaming transcript.

## Tech Stack

React 19, Vite 7, TailwindCSS v4, Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/mcp`, `@ai-sdk/react`), Radix UI, streamdown + shiki, marked + DOMPurify, html-to-image, Motion. i18n: zh-CN / en. Deploy: Vercel.

## Commands

- `npm run dev` — Dev server (port 4173)
- `npm run build` — Production build
- `npm test` — Run tests (`node --test`)
- `npm run check` — Tests + build (CI gate)

## Architecture

- All state in `App.jsx` via `useState`, no external state manager.
- Debate orchestrator (`services/debate-orchestrator.js`) emits events (`onEntry`, `onEntryUpdate`, `onReport`) consumed by App.
- Transcript entries use a `parts[]` array (reasoning, dynamic-tool, text) for structured rendering.
- Agent config and history persist in `localStorage` under key `agent-debate/v2`.
- MCP requests proxy through `/api/mcp?url=...` to bypass browser CORS.
- LLM prompt construction: stable system prefix + dynamic `<system-reminder>` tail blocks. See `AGENTS.md`.

## Style & Conventions

- CSS: single `styles.css` combining Tailwind v4 `@theme` variables + custom rules. Agent bubble theming uses scoped CSS variable overrides (e.g. `.ai-entry-shell-pro` redefines `--muted-color`, `--border` etc. to green tint).
- Localization: all user-facing strings go through `i18n.js` translator. Chinese UI uses 正方 Agent / 反方 Agent / 裁判 Agent.
- Layout: Pro = right-aligned, Con = left-aligned, Judge/System = centered. Flexbox transcript, width-capped bubbles.

## Testing

IMPORTANT: Every new feature or behavior change MUST have corresponding tests. If tests don't exist yet, write them. Run `npm run check` (tests + build) before considering any change complete. Tests are the guardrail for iteration stability — no untested code ships.

## Do Not

- NEVER commit `.env` or API keys.
- Do not introduce a free-form user-facing Skill/prompt editor — `writingStyle` + MCP tools is the intended surface.
- Do not auto-switch tabs after a debate run completes; user stays on transcript.

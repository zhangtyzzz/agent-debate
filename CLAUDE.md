# Agent Debate

Local-first multi-agent debate UI — Pro, Con, and Judge agents debate structured topics using OpenAI-compatible endpoints, with MCP tool support and streaming transcript.

## Tech Stack

- **Frontend**: React 19, Vite 7, TailwindCSS v4
- **AI**: Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible` + `@ai-sdk/mcp`)
- **UI Components**: Radix UI primitives, custom ai-elements components (shadcn-style)
- **Rendering**: `marked` + `DOMPurify` for markdown, `html-to-image` for PNG export
- **i18n**: Custom lightweight system (zh-CN, en)
- **Deploy**: Vercel (with MCP proxy at `/api/mcp`)

## Project Structure

```
src/
  App.jsx              # Main app component (all UI + state)
  core.js              # Constants, defaults, utility functions
  i18n.js              # Translation strings and translator factory
  render-markdown.js   # Markdown → sanitized HTML
  services/
    debate-orchestrator.js  # Debate flow: plan, turns, judge verdict/article
    chat.js                 # LLM chat completion (stream + generate)
    mcp.js                  # MCP client runtime (connect, list/get tools)
  server/
    mcp-proxy.js        # Dev server MCP proxy middleware
  components/
    ui/                 # Base UI primitives (button, select, badge, etc.)
    ai-elements/        # Chat UI: message, reasoning, tool, conversation
  lib/utils.ts          # cn() utility
api/mcp.js              # Vercel serverless MCP proxy
functions/api/mcp.js    # Cloudflare Pages MCP proxy
tests/                  # Node test runner (node --test)
```

## Commands

- `npm run dev` — Start dev server on port 4173
- `npm run build` — Production build
- `npm run preview` — Preview production build
- `npm test` — Run tests (`node --test`)
- `npm run check` — Tests + build

## Key Architecture Notes

- All state lives in `App.jsx` using `useState` — no external state manager.
- Debate orchestrator emits events (`onEntry`, `onEntryUpdate`, `onReport`) that App handles.
- Transcript entries have a `parts[]` array (reasoning, dynamic-tool, text) for structured rendering.
- Agent config and history persist in `localStorage` under `agent-debate/v2`.
- MCP requests proxy through `/api/mcp?url=...` to avoid browser CORS restrictions.
- Prompt construction uses a stable system prefix + dynamic `<system-reminder>` blocks (per AGENTS.md).

## Conventions

- See `AGENTS.md` for product intent, transcript behavior, prompting rules, and localization.
- In Chinese UI: 正方 Agent / 反方 Agent / 裁判 Agent.
- Pro messages = right-aligned, Con = left-aligned, Judge/System = centered.
- Flexbox for transcript layout; message bubbles width-capped.

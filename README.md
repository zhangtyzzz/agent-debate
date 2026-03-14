[中文文档](./README.zh-CN.md) | English

# Agent Debate

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/zhangtyzzz/agent-debate)

`Agent Debate` is a local-first React app for running structured debates between `Pro Agent`, `Con Agent`, and `Judge Agent`. It keeps the transcript in a chat-style layout, supports MCP tools, streams reasoning and tool activity inline, and produces both a verdict and a synthesis article.

## Highlights

- Chat-style transcript instead of split-screen debate UI
- Independent model config for `Pro`, `Con`, and `Judge`
- Structured multi-round debate orchestration
- Streaming text, reasoning, and tool activity in the transcript
- MCP tool discovery and per-agent tool attachment
- Judge verdict plus a final synthesis article
- Local browser history and transcript export
- Built-in Chinese and English UI
- Static frontend deployable to Vercel
- Optional MCP proxy included for Vercel and Cloudflare Pages

## Stack

- React 19
- Vite 7
- AI SDK + OpenAI-compatible providers
- MCP via `@ai-sdk/mcp`
- Node built-in test runner

## Project Layout

```text
.
├── api/
│   └── mcp.js                  # Vercel MCP proxy entry
├── functions/
│   └── api/mcp.js              # Cloudflare Pages Functions MCP proxy entry
├── src/
│   ├── App.jsx                 # Main app shell
│   ├── core.js                 # Shared defaults and helpers
│   ├── i18n.js                 # Localization
│   ├── services/
│   │   ├── chat.js             # Model calls
│   │   ├── debate-orchestrator.js
│   │   └── mcp.js
│   └── server/
│       └── mcp-proxy.js        # Shared MCP proxy logic
├── tests/
├── vercel.json
└── README.md / README.zh-CN.md
```

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:4173`.

## Validation

```bash
npm run check
```

`npm run check` runs both tests and a production build.

## Configuration Notes

- App state, debate history, and API keys are stored in browser local storage.
- Model requests are made directly from the browser to the configured OpenAI-compatible endpoint.
- Your model endpoint must allow browser-origin requests.
- MCP calls can be routed through the included `/api/mcp` endpoint when the MCP server cannot be called safely from the browser.

## What The MCP Proxy Does

The MCP proxy is optional. It exists for cases where a browser should not call the MCP server directly.

Use it when:

- the MCP server does not allow browser CORS
- the MCP server expects server-to-server forwarding
- you want the deployed app to talk to MCP through your own domain

You usually do not need it when:

- your MCP endpoint already supports browser access correctly
- you are comfortable exposing the endpoint directly to the client

How it works:

- the browser sends MCP traffic to your app at `/api/mcp`
- the proxy forwards that request to the real MCP endpoint
- response headers such as `mcp-session-id` are passed back to the browser

## Deploy to Vercel

### One-click deploy

Use the button at the top of this README after the repository is pushed to GitHub.

### Manual deploy

1. Fork or clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Verify locally:

```bash
npm run check
```

4. Import the repository into Vercel.
5. Use these settings:
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Output directory: `dist`
6. Deploy.

`vercel.json` is already configured for the default static build output.

### MCP proxy on Vercel

The repository includes [`api/mcp.js`](./api/mcp.js), which forwards MCP HTTP traffic through Vercel Functions.

Typical flow:

- your frontend calls `/api/mcp?url=https://your-mcp-server.example.com/...`
- Vercel Function forwards the request upstream
- the browser receives a CORS-safe response from your own deployment

## Deploy to Cloudflare Pages

Cloudflare Pages can reuse the same frontend build and the included Pages Functions entry at [`functions/api/mcp.js`](./functions/api/mcp.js).

Suggested settings:

- Build command: `npm run build`
- Build output directory: `dist`
- Node version: `20+`

## License

MIT. See [`LICENSE`](./LICENSE).

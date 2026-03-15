import { createCorsPreflightResponse, proxyMcpRequest } from "../src/server/mcp-proxy.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    const preflight = createCorsPreflightResponse();
    res.status(preflight.status);
    preflight.headers.forEach((value, key) => res.setHeader(key, value));
    return res.end();
  }

  const hasBody = req.method === "POST" || req.method === "DELETE";
  const request = new Request(`https://agent-debate.local${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
  });

  const response = await proxyMcpRequest(request);

  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream") && response.body) {
    const reader = response.body.getReader();
    const push = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
        if (typeof res.flush === "function") res.flush();
      }
      res.end();
    };
    push().catch(() => res.end());
  } else {
    const body = await response.text();
    res.send(body);
  }
}

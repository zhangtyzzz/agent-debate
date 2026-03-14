import { createCorsPreflightResponse, proxyMcpRequest } from "../src/server/mcp-proxy.js";

export default async function handler(req, res) {
  const request = new Request(`https://agent-debate.local${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === "POST" ? JSON.stringify(req.body ?? {}) : undefined,
  });

  const response = req.method === "OPTIONS" ? createCorsPreflightResponse() : await proxyMcpRequest(request);

  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const body = await response.text();
  res.send(body);
}

import { createCorsPreflightResponse, proxyMcpRequest } from "../../src/server/mcp-proxy.js";

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return createCorsPreflightResponse();
  }
  return proxyMcpRequest(context.request);
}

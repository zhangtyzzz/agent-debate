import { createMCPClient } from "@ai-sdk/mcp";

import { parseHeadersJson } from "../core.js";

export function createMcpRuntime(servers, options = {}) {
  const clients = new Map();
  const toolSets = new Map();

  return {
    async listTools(server) {
      const client = await getClient(server);
      const result = await client.listTools();
      return Array.isArray(result?.tools) ? result.tools : [];
    },
    async getTools(server) {
      const client = await getClient(server);
      if (!toolSets.has(server.id)) {
        toolSets.set(server.id, await client.tools());
      }
      return toolSets.get(server.id);
    },
    async close() {
      await Promise.allSettled(Array.from(clients.values()).map((client) => client.close()));
    },
  };

  async function getClient(server) {
    if (!server?.url) {
      throw new Error(`${server?.name || "MCP"} is missing an endpoint URL.`);
    }
    if (!clients.has(server.id)) {
      clients.set(
        server.id,
        await createMCPClient({
          name: "agent-debate",
          version: "1.0.0",
          transport: {
            type: "http",
            url: proxyUrl(server.url),
            headers: parseHeadersJson(server.headers),
          },
          onUncaughtError(error) {
            if (options.onError) options.onError(error);
          },
        }),
      );
    }
    return clients.get(server.id);
  }
}

function proxyUrl(target) {
  const url = new URL("/api/mcp", globalThis.location?.origin || "http://localhost:4173");
  url.searchParams.set("url", target);
  return url.toString();
}

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { proxyMcpRequest } from "./src/server/mcp-proxy.js";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "mcp-proxy-dev",
      configureServer(server) {
        server.middlewares.use("/api/mcp", async (req, res) => {
          const protocol = req.headers["x-forwarded-proto"] || "http";
          const origin = `${protocol}://${req.headers.host || "localhost:4173"}`;
          const request = new Request(`${origin}${req.url}`, {
            method: req.method,
            headers: req.headers,
            body: req.method === "POST" ? req : undefined,
            duplex: req.method === "POST" ? "half" : undefined,
          });
          const response = await proxyMcpRequest(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          const body = await response.arrayBuffer();
          res.end(Buffer.from(body));
        });
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 4173,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});

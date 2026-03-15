function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,Mcp-Session-Id,Authorization,X-MCP-Target",
  };
}

export function createCorsPreflightResponse() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function proxyMcpRequest(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("url") || request.headers.get("x-mcp-target");
  if (!target) {
    return jsonResponse({ error: "Missing MCP target URL." }, 400);
  }

  const upstreamHeaders = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (["host", "content-length", "x-mcp-target", "origin"].includes(lower)) return;
    upstreamHeaders.set(key, value);
  });

  const upstreamResponse = await fetch(target, {
    method: request.method,
    headers: upstreamHeaders,
    body: request.method === "POST" ? await request.text() : undefined,
    redirect: "follow",
  });

  const responseHeaders = new Headers(corsHeaders());
  const contentType = upstreamResponse.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  const sessionId = upstreamResponse.headers.get("mcp-session-id");
  if (sessionId) responseHeaders.set("mcp-session-id", sessionId);

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json",
    },
  });
}

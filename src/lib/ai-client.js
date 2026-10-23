const ENDPOINTS = new Set(["/api/models", "/api/chat"]);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function checkAbort(signal) {
  if (signal?.aborted)
    throw new DOMException("A solicitação foi cancelada.", "AbortError");
}

/**
 * Local deployments use the same-origin API. Static Pages deployments call only
 * fixed official providers through the shared processor, using the user's own
 * session credentials; no provider key is embedded, cached or persisted here.
 */
export async function aiFetch(endpoint, options = {}) {
  const transport = globalThis.document?.querySelector(
    'meta[name="weeding-ai-transport"]',
  )?.content;
  if (transport !== "browser") return fetch(endpoint, options);
  checkAbort(options.signal);
  if (!ENDPOINTS.has(endpoint))
    return jsonResponse({ error: "Rota de IA não encontrada." }, 404);
  if (String(options.method || "GET").toUpperCase() !== "POST")
    return jsonResponse({ error: "Use POST para consultar a IA." }, 405);
  if (
    typeof options.body !== "string" ||
    options.body.length > 1_000_000 ||
    new TextEncoder().encode(options.body).byteLength > 1_000_000
  )
    return jsonResponse(
      { error: "Envie uma solicitação JSON de até 1 MB." },
      400,
    );
  let body;
  try {
    body = JSON.parse(options.body);
  } catch {
    return jsonResponse(
      { error: "Não foi possível ler a solicitação JSON." },
      400,
    );
  }
  const { processAI } = await import("./ai-core.js");
  checkAbort(options.signal);
  const result = await processAI(endpoint, body, options.signal);
  checkAbort(options.signal);
  return jsonResponse(result.body, result.status);
}

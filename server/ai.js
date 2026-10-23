import { processAI } from "../src/lib/ai-core.js";
export { parseAssistantReply } from "../src/lib/ai-core.js";

function watchClientCancellation(request, response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => {
    if (!response.writableEnded) abort();
  };
  request.once("aborted", abort);
  response.once("close", close);
  if (request.aborted || response.destroyed) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      request.removeListener("aborted", abort);
      response.removeListener("close", close);
    },
  };
}

export function registerAiRoutes(app) {
  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  for (const endpoint of ["/api/models", "/api/chat"]) {
    app.post(endpoint, async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      const client = watchClientCancellation(request, response);
      try {
        const result = await processAI(endpoint, request.body, client.signal);
        if (!response.destroyed && !response.writableEnded)
          response.status(result.status).json(result.body);
      } catch {
        if (!response.destroyed && !response.writableEnded)
          response
            .status(500)
            .json({ error: "Erro interno ao consultar a IA." });
      } finally {
        client.dispose();
      }
    });
  }
}

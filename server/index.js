import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerAiRoutes } from "./ai.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use("/api", (request, response, next) => {
  // This application runs locally. Browser API calls must come from its own origin.
  const origin = request.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.get("host")) {
        response
          .status(403)
          .json({ error: "Origem da solicitação não permitida." });
        return;
      }
    } catch {
      response.status(403).json({ error: "Origem inválida." });
      return;
    }
  }
  response.setHeader("Cache-Control", "no-store");
  next();
});

registerAiRoutes(app);
app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Rota não encontrada." });
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.argv.includes("--production");

if (production) {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(root, "dist", "index.html"));
  });
} else {
  // Serve only frontend files. Repository files and node_modules are never public.
  app.get("/", (_request, response) => {
    response.sendFile(path.join(root, "index.html"));
  });
  app.use(
    "/src",
    express.static(path.join(root, "src"), { index: false, dotfiles: "deny" }),
  );
  app.get("/favicon.svg", (_request, response) => {
    response.sendFile(path.join(root, "public", "favicon.svg"));
  });
}

app.use((error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  response.status(error?.type === "entity.too.large" ? 413 : 400).json({
    error: "Não foi possível ler a solicitação. Confira os dados enviados.",
  });
});

const port = Number(process.env.PORT) || 5173;
const server = createServer(app);
server.listen(port, "127.0.0.1", () => {
  console.log(`\n  Weeding Calculator\n  Local: http://localhost:${port}\n`);
});

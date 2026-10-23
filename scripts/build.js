import { mkdir, cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const transport = process.argv.includes("--pages") ? "browser" : "server";
if (path.relative(root, output) !== "dist")
  throw new Error("Diretório de saída inválido.");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const sourceHtml = await readFile(path.join(root, "index.html"), "utf8");
const transportMeta =
  /(<meta\s+name="weeding-ai-transport"\s+content=")[^"]*(")/;
if (!transportMeta.test(sourceHtml))
  throw new Error("Configuração de transporte de IA ausente em index.html.");
const html = sourceHtml.replace(
  transportMeta,
  (_match, before, after) => `${before}${transport}${after}`,
);
await writeFile(path.join(output, "index.html"), html);
await cp(path.join(root, "src"), path.join(output, "src"), {
  recursive: true,
  filter: (source) => !/\.(tsx?|map)$/.test(source),
});
await cp(path.join(root, "public"), output, { recursive: true });
await writeFile(path.join(output, ".nojekyll"), "");
console.log("Pronto: HTML, CSS e JavaScript nativos copiados para dist/.");

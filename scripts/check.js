import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let count = 0;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(absolute);
    else if (entry.name.endsWith(".js")) {
      execFileSync(process.execPath, ["--check", absolute], {
        stdio: "inherit",
      });
      count++;
    }
  }
}
for (const dir of ["src", "server", "scripts", "tests"])
  await check(path.join(root, dir));
console.log(`${count} arquivos JavaScript verificados.`);

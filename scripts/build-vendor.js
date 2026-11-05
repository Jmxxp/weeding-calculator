import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Ship the official client with the site, without requiring a runtime CDN. */
export async function buildRealtimeVendor() {
  await build({
    stdin: {
      contents: 'export { RealtimeClient } from "@supabase/realtime-js";',
      resolveDir: root,
      sourcefile: "supabase-realtime-entry.js",
    },
    outfile: path.join(root, "src", "vendor", "realtime.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "external",
  });
  const packages = [
    ["@supabase/realtime-js", "LICENSE"],
    ["@supabase/phoenix", "LICENSE.md"],
    ["tslib", "LICENSE.txt"],
  ];
  const licenses = await Promise.all(packages.map(async ([name, filename]) =>
    `${name}\n\n${await readFile(path.join(root, "node_modules", name, filename), "utf8")}`,
  ));
  await writeFile(path.join(root, "src", "vendor", "LICENSES.txt"), licenses.join("\n\n"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildRealtimeVendor();

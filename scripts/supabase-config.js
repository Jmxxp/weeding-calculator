import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateSupabaseConfig } from "../src/lib/supabase.js";
import { supabaseConfig as defaults } from "../src/config.js";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** Only public settings may be serialized into browser code. */
export function publicSupabaseConfig(env = process.env) {
  const config = {
    url: env.SUPABASE_URL?.trim() || defaults.url,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY?.trim() || defaults.publishableKey,
    email: env.SUPABASE_FAMILY_EMAIL?.trim() || defaults.email,
    username: env.SUPABASE_FAMILY_USERNAME?.trim() || defaults.username,
  };
  if (!config.url && !config.publishableKey) return config;
  return validateSupabaseConfig(config);
}

export function supabaseConfigModule(env = process.env) {
  return `export const supabaseConfig = ${JSON.stringify(publicSupabaseConfig(env))};\n`;
}

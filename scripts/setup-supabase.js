import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

function configuration() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  const email =
    process.env.SUPABASE_FAMILY_EMAIL?.trim() ||
    "familia@weeding-calculator.local";
  if (!rawUrl || !secret)
    throw new Error(
      "Preencha SUPABASE_URL e SUPABASE_SECRET_KEY no .env antes de criar a conta técnica do planejamento público.",
    );
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("SUPABASE_URL deve conter a URL do projeto Supabase.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error("SUPABASE_URL deve ser a origem HTTPS do projeto.");
  let legacyServiceRole = false;
  if (!secret.startsWith("sb_secret_")) {
    try {
      const claims = JSON.parse(Buffer.from(secret.split(".")[1], "base64url"));
      legacyServiceRole = claims.role === "service_role";
    } catch {}
    if (!legacyServiceRole)
      throw new Error(
        "Use uma chave secret (sb_secret_) ou service_role somente neste script local.",
      );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("SUPABASE_FAMILY_EMAIL precisa ser um e-mail válido.");
  return { url: url.origin, secret, email, legacyServiceRole };
}

async function main() {
  const { url, secret, email, legacyServiceRole } = configuration();
  // Auth retains the existing row identity; visitors never use this password.
  // Include every character class for projects with stronger password rules.
  const password = `${randomBytes(32).toString("base64url")}aA7!`;
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: secret,
      "Content-Type": "application/json",
      ...(legacyServiceRole ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: { family_planner: true },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (["email_exists", "user_already_exists"].includes(result.error_code)) {
      console.log("A conta técnica já existe e foi preservada. Execute supabase/setup.sql para habilitar o acesso público.");
      return;
    }
    if (response.status === 401 || response.status === 403)
      throw new Error(
        "O Supabase recusou a chave administrativa. Confira SUPABASE_URL e SUPABASE_SECRET_KEY.",
      );
    if (result.error_code === "weak_password")
      throw new Error(
        "O Supabase recusou a senha técnica gerada. Confira as regras de senha em Authentication antes de tentar novamente.",
      );
    throw new Error(
      `Não foi possível criar a conta técnica (HTTP ${response.status}). Confira Authentication no painel Supabase.`,
    );
  }
  if (!result.id && !result.user?.id)
    throw new Error("O Supabase respondeu sem confirmar a criação da conta.");
  console.log(
    "Conta técnica criada no Supabase Auth. A senha aleatória não é publicada nem precisa ser informada por visitantes.",
  );
  console.log("Execute supabase/setup.sql no SQL Editor para habilitar o planejamento público, sem login ou senha.");
}

main().catch((error) => {
  // Do not print provider payloads, headers, passwords or administrative keys.
  console.error(error.name === "TimeoutError"
    ? "O Supabase demorou para responder. Confira no painel se a conta foi criada antes de tentar novamente."
    : error instanceof TypeError
      ? "Não foi possível conectar ao Supabase. Confira a URL e a conexão de rede."
      : error.message);
  process.exitCode = 1;
});

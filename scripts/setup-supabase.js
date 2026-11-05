import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

function configuration() {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  const password = process.env.FAMILY_ACCESS_PASSWORD;
  const email =
    process.env.SUPABASE_FAMILY_EMAIL?.trim() ||
    "familia@weeding-calculator.local";
  const username =
    process.env.SUPABASE_FAMILY_USERNAME?.trim().toLowerCase() || "jmxxp";
  if (!rawUrl || !secret || !password)
    throw new Error(
      "Preencha SUPABASE_URL, SUPABASE_SECRET_KEY e FAMILY_ACCESS_PASSWORD no .env antes de criar o acesso familiar.",
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
  if (password.length < 6)
    throw new Error("FAMILY_ACCESS_PASSWORD precisa ter pelo menos 6 caracteres.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("SUPABASE_FAMILY_EMAIL precisa ser um e-mail válido.");
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username))
    throw new Error(
      "SUPABASE_FAMILY_USERNAME deve ter de 3 a 50 caracteres: letras minúsculas, números, ponto, sublinhado ou hífen, começando por letra ou número.",
    );
  return { url: url.origin, secret, password, email, username, legacyServiceRole };
}

async function main() {
  const { url, secret, password, email, username, legacyServiceRole } = configuration();
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
      app_metadata: { family_planner: true, family_username: username },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (["email_exists", "user_already_exists"].includes(result.error_code))
      throw new Error(
        "A conta familiar já existe. Nenhuma senha foi alterada. Confira no painel Authentication se essa conta possui app_metadata.family_planner = true e use a senha já cadastrada.",
      );
    if (response.status === 401 || response.status === 403)
      throw new Error(
        "O Supabase recusou a chave administrativa. Confira SUPABASE_URL e SUPABASE_SECRET_KEY.",
      );
    if (result.error_code === "weak_password")
      throw new Error(
        "A senha não atende às regras deste projeto Supabase. Confira as regras em Authentication antes de tentar novamente.",
      );
    throw new Error(
      `Não foi possível criar a conta familiar (HTTP ${response.status}). Confira Authentication no painel Supabase.`,
    );
  }
  if (!result.id && !result.user?.id)
    throw new Error("O Supabase respondeu sem confirmar a criação da conta.");
  console.log(
    "Acesso familiar criado no Supabase Auth, com e-mail confirmado e permissão de planejamento.",
  );
  console.log("Execute supabase/setup.sql no SQL Editor, caso ainda não tenha executado.");
  console.log(`Entre no aplicativo com o usuário ${username} e a senha configurada em FAMILY_ACCESS_PASSWORD.`);
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

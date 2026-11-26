import { subscribeFamilyPlanChanges } from "./family-realtime.js";

const DEFAULT_EMAIL = "familia@weeding-calculator.local";
const DEFAULT_USERNAME = "jmxxp";
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isUuid = (value) => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const failure = (message, status = 0) => Object.assign(new Error(message), { status });

/** Only public client keys belong in the browser configuration. */
export function validateSupabaseConfig(config) {
  if (!isRecord(config)) throw failure("Configure a conexão com o Supabase.");
  let parsed;
  try {
    parsed = new URL(typeof config.url === "string" ? config.url.trim() : "");
  } catch {
    throw failure("Informe a URL do projeto Supabase.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) ||
    parsed.username || parsed.password || parsed.search || parsed.hash ||
    !/^\/*$/.test(parsed.pathname)
  ) throw failure("Use a URL HTTPS do projeto Supabase, sem caminhos adicionais.");
  const publishableKey = typeof config.publishableKey === "string"
    ? config.publishableKey.trim() : "";
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey);
  if (!publicKey && publishableKey.split(".").length === 3) {
    try {
      const part = publishableKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
      publicKey = claims.role === "anon";
    } catch { /* An invalid or privileged JWT is never a public configuration key. */ }
  }
  if (!publicKey)
    throw failure("Informe somente a chave pública publishable/anon. Chaves secret e service_role não são permitidas.");
  const email = typeof config.email === "string" && config.email.trim()
    ? config.email.trim() : DEFAULT_EMAIL;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw failure("O e-mail configurado para o acesso familiar é inválido.");
  const username = config.username === undefined
    ? DEFAULT_USERNAME
    : typeof config.username === "string" ? config.username.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username))
    throw failure("O usuário configurado para o acesso familiar é inválido.");
  return { url: parsed.origin, publishableKey, email, username };
}

/** Public REST client. RLS exposes only the shared family plan, without a login. */
export function createSupabaseClient(config, options = {}) {
  const { url, publishableKey } = validateSupabaseConfig(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw failure("Este navegador não permite conectar ao Supabase.");
  let userId = null;

  function httpFailure(status) {
    if (status === 429) return failure("Muitas tentativas. Aguarde um pouco e tente novamente.", status);
    if (status === 401 || status === 403)
      return failure("O acesso público ao planejamento ainda não está configurado no Supabase.", status);
    if (status === 404)
      return failure("Banco não configurado. Execute a configuração do Supabase.", status);
    if (status === 409)
      return failure("O planejamento já foi criado em outro dispositivo. Recarregue os dados.", status);
    return failure("Não foi possível concluir a operação no Supabase. Tente novamente.", status);
  }
  async function request(path, { method = "GET", body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${url}${path}`, {
        method,
        headers: {
          apikey: publishableKey,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(method !== "GET" ? { Prefer: "return=representation" } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (error?.name === "TimeoutError")
        throw failure("O Supabase demorou para responder. Tente novamente.");
      throw failure("Não foi possível conectar ao Supabase. Confira sua conexão.");
    }
    if (!response.ok) throw httpFailure(response.status);
    if (!response.headers.get("content-type")?.includes("json"))
      throw failure("O Supabase retornou uma resposta inválida.", 502);
    try { return await response.json(); } catch {
      throw failure("O Supabase retornou uma resposta inválida.", 502);
    }
  }
  function rowResponse(rows, allowEmpty = true, expectedUserId) {
    if (Array.isArray(rows) && rows.length === 0 && allowEmpty) return null;
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!isRecord(row) || !isUuid(row.user_id) ||
      (expectedUserId && row.user_id !== expectedUserId) ||
      !isRecord(row.data) || !Number.isSafeInteger(row.revision) || row.revision < 1)
      throw failure("O Supabase retornou um planejamento inválido.", 502);
    userId = row.user_id;
    return { data: row.data, revision: row.revision };
  }
  function planPath(revision) {
    const params = new URLSearchParams({ select: "user_id,data,revision" });
    if (revision !== undefined) {
      params.set("user_id", `eq.${userId}`);
      params.set("revision", `eq.${revision}`);
    }
    return `/rest/v1/family_plans?${params}`;
  }

  return {
    get userId() { return userId; },
    subscribePlanChanges({ onChange, onStatus } = {}) {
      if (!userId) throw failure("Abra o planejamento antes de conectar em tempo real.", 400);
      return subscribeFamilyPlanChanges({
        url, publishableKey, userId, publicAccess: true, onChange, onStatus,
      }, { loadRealtime: options.loadRealtime });
    },
    async readPlan() {
      return rowResponse(await request(planPath()));
    },
    async createPlan(data) {
      const rows = await request(planPath(), {
        method: "POST", body: { data, revision: 1 },
      });
      return rowResponse(rows, false);
    },
    async updatePlan(data, revision) {
      if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER)
        throw failure("A versão do planejamento é inválida. Recarregue os dados.", 400);
      if (!userId) throw failure("Abra o planejamento antes de salvar alterações.", 400);
      const expectedUserId = userId;
      const rows = await request(planPath(revision), {
        method: "PATCH", body: { data, revision: revision + 1 },
      });
      return rowResponse(rows, true, expectedUserId);
    },
  };
}

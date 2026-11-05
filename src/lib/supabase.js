import { subscribeFamilyPlanChanges } from "./family-realtime.js";

const DEFAULT_EMAIL = "familia@weeding-calculator.local";
const DEFAULT_USERNAME = "jmxxp";
const SESSION_PREFIX = "weeding-supabase-session-v1:";
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const seconds = () => Math.floor(Date.now() / 1000);
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

/** Native REST client, compatible with the static GitHub Pages build. */
export function createSupabaseClient(config, options = {}) {
  const { url, publishableKey, email, username: configuredUsername } = validateSupabaseConfig(config);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw failure("Este navegador não permite conectar ao Supabase.");
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = globalThis.sessionStorage; } catch { storage = null; }
  }
  const storageKey = `${SESSION_PREFIX}${url}:${email}`;
  let session = null;
  let refreshPromise = null;
  let generation = 0;
  const sessionEndListeners = new Set();

  function clearSession() {
    generation++;
    session = null;
    refreshPromise = null;
    try { storage?.removeItem(storageKey); } catch { /* In-memory sessions still work. */ }
    for (const listener of [...sessionEndListeners]) {
      try { listener(); } catch { /* A subscriber must never block logout. */ }
    }
  }
  function persistSession() {
    try { storage?.setItem(storageKey, JSON.stringify(session)); } catch { /* Storage can be disabled. */ }
  }
  function familyUser(user) {
    if (!isRecord(user) || typeof user.id !== "string" || !user.id || user.id.length > 200)
      throw failure("O Supabase retornou uma sessão inválida.", 502);
    if (user.app_metadata?.family_planner !== true)
      throw failure("Este acesso não foi autorizado para o planejamento familiar.", 403);
    return { id: user.id, app_metadata: { family_planner: true } };
  }
  function tokenSession(body) {
    const expiresAt = typeof body?.expires_at === "number"
      ? body.expires_at : seconds() + body?.expires_in;
    if (
      !isRecord(body) || typeof body.access_token !== "string" || !body.access_token ||
      typeof body.refresh_token !== "string" || !body.refresh_token ||
      !Number.isFinite(expiresAt) || expiresAt <= 0
    ) throw failure("O Supabase retornou uma sessão inválida.", 502);
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: expiresAt,
      user: familyUser(body.user),
    };
  }
  function httpFailure(status, kind) {
    if (status === 429) return failure("Muitas tentativas. Aguarde um pouco e tente novamente.", status);
    if (kind === "login" && [400, 401, 422].includes(status))
      return failure("Usuário ou senha incorretos.", status);
    if (status === 401 || (kind === "refresh" && [400, 422].includes(status)))
      return failure("Sua sessão expirou. Entre novamente.", status);
    if (status === 403) return failure("Este acesso não tem permissão para o planejamento familiar.", status);
    if (status === 404 && kind === "plan")
      return failure("Banco não configurado. Execute a configuração do Supabase.", status);
    if (status === 409)
      return failure("O planejamento já foi criado em outro dispositivo. Recarregue os dados.", status);
    return failure("Não foi possível concluir a operação no Supabase. Tente novamente.", status);
  }
  async function request(path, { method = "GET", body, token, kind } = {}) {
    let response;
    try {
      response = await fetchImpl(`${url}${path}`, {
        method,
        headers: {
          apikey: publishableKey,
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(kind === "plan" && method !== "GET" ? { Prefer: "return=representation" } : {}),
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
    if (!response.ok) throw httpFailure(response.status, kind);
    if (response.status === 204) return null;
    if (!response.headers.get("content-type")?.includes("json"))
      throw failure("O Supabase retornou uma resposta inválida.", 502);
    try { return await response.json(); } catch {
      throw failure("O Supabase retornou uma resposta inválida.", 502);
    }
  }
  async function refresh() {
    if (refreshPromise) return refreshPromise;
    if (!session) throw failure("Entre com a senha da família para continuar.", 401);
    const currentGeneration = generation;
    const refreshToken = session.refresh_token;
    const pending = (async () => {
      try {
        const body = await request("/auth/v1/token?grant_type=refresh_token", {
          method: "POST", body: { refresh_token: refreshToken }, kind: "refresh",
        });
        const next = tokenSession(body);
        if (currentGeneration !== generation)
          throw failure("Sua sessão foi encerrada. Entre novamente.", 401);
        session = next;
        persistSession();
        return session;
      } catch (error) {
        if (currentGeneration === generation && [400, 401, 403, 422].includes(error.status))
          clearSession();
        throw error;
      }
    })();
    refreshPromise = pending;
    try { return await pending; } finally {
      if (refreshPromise === pending) refreshPromise = null;
    }
  }
  async function ensureSession() {
    if (!session) throw failure("Entre com a senha da família para continuar.", 401);
    if (session.expires_at <= seconds() + 30) await refresh();
    if (!session) throw failure("Sua sessão foi encerrada. Entre novamente.", 401);
    return session;
  }
  async function getAccessToken() {
    const currentGeneration = generation;
    const active = await ensureSession();
    if (currentGeneration !== generation || !session)
      throw failure("Sua sessão foi encerrada. Entre novamente.", 401);
    return active.access_token;
  }
  function onSessionEnd(listener) {
    if (typeof listener !== "function")
      throw failure("O observador da sessão é inválido.", 400);
    sessionEndListeners.add(listener);
    return () => sessionEndListeners.delete(listener);
  }
  async function authorizedRequest(path, options = {}) {
    const { access_token: token } = await ensureSession();
    try { return await request(path, { ...options, token }); } catch (error) {
      if (error.status !== 401) throw error;
      if (session?.access_token === token) await refresh();
      const current = await ensureSession();
      try { return await request(path, { ...options, token: current.access_token }); } catch (retryError) {
        if (retryError.status === 401) clearSession();
        throw retryError;
      }
    }
  }
  function rowResponse(rows, allowEmpty = true) {
    if (Array.isArray(rows) && rows.length === 0 && allowEmpty) return null;
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!isRecord(row) || !isRecord(row.data) || !Number.isSafeInteger(row.revision) || row.revision < 1)
      throw failure("O Supabase retornou um planejamento inválido.", 502);
    return { data: row.data, revision: row.revision };
  }
  function planPath(revision) {
    const params = new URLSearchParams({ user_id: `eq.${session.user.id}`, select: "data,revision" });
    if (revision !== undefined) params.set("revision", `eq.${revision}`);
    return `/rest/v1/family_plans?${params}`;
  }

  return {
    get userId() { return session?.user.id ?? null; },
    getAccessToken,
    onSessionEnd,
    subscribePlanChanges({ onChange, onStatus } = {}) {
      if (!session) throw failure("Entre com a senha da família para continuar.", 401);
      return subscribeFamilyPlanChanges({
        url, publishableKey, userId: session.user.id, getAccessToken, onSessionEnd,
        onChange, onStatus,
      }, { loadRealtime: options.loadRealtime });
    },
    async signIn(password, username = configuredUsername) {
      clearSession();
      if (typeof username !== "string" || username.trim().toLowerCase() !== configuredUsername)
        throw failure("Usuário ou senha incorretos.", 400);
      if (typeof password !== "string" || !password)
        throw failure("Digite a senha de acesso da família.", 400);
      const currentGeneration = generation;
      const body = await request("/auth/v1/token?grant_type=password", {
        method: "POST", body: { email, password }, kind: "login",
      });
      const next = tokenSession(body);
      if (currentGeneration !== generation)
        throw failure("Sua sessão foi encerrada. Entre novamente.", 401);
      session = next;
      persistSession();
      return session.user;
    },
    async restoreSession() {
      if (!session) {
        let saved;
        try { saved = JSON.parse(storage?.getItem(storageKey) || "null"); } catch { clearSession(); return null; }
        if (!saved) return null;
        try { session = tokenSession(saved); } catch { clearSession(); return null; }
      }
      try {
        const currentGeneration = generation;
        const user = familyUser(await authorizedRequest("/auth/v1/user"));
        if (currentGeneration !== generation || !session)
          throw failure("Sua sessão foi encerrada. Entre novamente.", 401);
        session.user = user;
        persistSession();
        return user;
      } catch (error) {
        if ([400, 401, 403, 422].includes(error.status)) { clearSession(); return null; }
        session = null;
        throw error;
      }
    },
    async signOut() {
      const token = session?.access_token;
      clearSession();
      if (!token) return;
      try {
        // Local scope leaves the other relatives' sessions signed in.
        await request("/auth/v1/logout?scope=local", { method: "POST", token });
      } catch (error) {
        if (![401, 403].includes(error.status)) throw error;
      }
    },
    async readPlan() {
      await ensureSession();
      return rowResponse(await authorizedRequest(planPath(), { kind: "plan" }));
    },
    async createPlan(data) {
      await ensureSession();
      const rows = await authorizedRequest("/rest/v1/family_plans?select=data,revision", {
        method: "POST", kind: "plan", body: { user_id: session.user.id, data, revision: 1 },
      });
      return rowResponse(rows, false);
    },
    async updatePlan(data, revision) {
      if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER)
        throw failure("A versão do planejamento é inválida. Recarregue os dados.", 400);
      await ensureSession();
      const rows = await authorizedRequest(planPath(revision), {
        method: "PATCH", kind: "plan", body: { data, revision: revision + 1 },
      });
      return rowResponse(rows);
    },
  };
}

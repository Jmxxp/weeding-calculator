import { mountApp } from "./app.js";
import { createSupabaseClient } from "./lib/supabase.js";
import { createFamilySync } from "./lib/family-sync.js";
import { loadData, normalizeStorage, STORAGE_KEY } from "./lib/storage.js";
import { createEmptyData } from "./lib/demo.js";
import { escapeHtml as e, icon } from "./ui.js";

/** The planner is mounted only after authentication and a successful database read. */
export function mountFamilyAccess(root, config, dependencies = {}) {
  const clientFactory = dependencies.clientFactory ?? createSupabaseClient;
  const appFactory = dependencies.appFactory ?? mountApp;
  const syncFactory = dependencies.syncFactory ?? createFamilySync;
  let client, app, sync, destroyed = false, busy = false;
  let lastUsername = "";
  let journalKey;
  let journalStorage;
  try { journalStorage = globalThis.localStorage; } catch {}

  function card(content) {
    if (destroyed) return;
    root.innerHTML = `<main class="family-access"><section class="family-access-card" aria-labelledby="family-title"><div class="family-access-symbol">${icon("Heart", 30)}</div><p class="family-eyebrow">NOSSO GRANDE DIA</p><h1 id="family-title">Acesso da família</h1>${content}</section></main>`;
  }

  function login(message = "") {
    card(`<p>Um espaço só nosso para planejar e compartilhar cada detalhe do casamento.</p><form data-family-login><label for="family-username">Usuário</label><input id="family-username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" value="${e(lastUsername)}" required maxlength="50" aria-describedby="family-error" /><label for="family-password">Senha de acesso</label><input id="family-password" name="password" type="password" autocomplete="current-password" inputmode="numeric" required maxlength="128" aria-describedby="family-error" /><p id="family-error" class="family-error" role="alert">${e(message)}</p><button class="button button-primary" type="submit">Entrar</button></form><small>Use o usuário e a senha compartilhados com a família.</small>`);
    root.querySelector(lastUsername ? "#family-password" : "#family-username")?.focus();
  }

  function unavailable(message) {
    card(`<p class="family-error" role="alert">${e(message)}</p><button class="button button-primary" data-family-retry type="button">Tentar novamente</button><button class="family-text-button" data-family-exit type="button">Voltar para a entrada</button>`);
  }

  function clearPrivateCache() {
    try {
      for (const key of [STORAGE_KEY, "weeding-calculator-draft-v1", "weeding-calculator-ai-history-v1"])
        localStorage.removeItem(key);
      if (journalKey) localStorage.removeItem(journalKey);
    } catch {}
    try {
      for (const key of ["sim-ai-session", "sim-ai-profiles"])
        sessionStorage.removeItem(key);
    } catch {}
  }

  async function signOut() {
    if (busy || destroyed) return;
    busy = true;
    try {
      // Finish queued writes before clearing the browser's private cache.
      if (sync?.pending && !(await sync.flush())) {
        app?.setSyncStatus({ state: "error", message: "Há alterações pendentes. Tente salvar novamente antes de sair." });
        return;
      }
      sync?.destroy();
      sync = null;
      app?.destroy();
      app = null;
      clearPrivateCache();
      // The adapter clears local tokens immediately. Remote revocation must not
      // hold the entrance screen hostage to a slow or unavailable connection.
      void client.signOut().catch(() => {});
      if (!destroyed) login();
    } finally {
      busy = false;
    }
  }

  async function openPlanning() {
    if (destroyed) return;
    card('<p role="status">Abrindo o planejamento compartilhado…</p>');
    let row = await client.readPlan();
    if (!row) {
      // Import the existing browser plan only when the family database is empty.
      const local = loadData();
      try {
        row = await client.createPlan(local.isDemo ? createEmptyData() : local);
      } catch (error) {
        if (error.status !== 409) throw error;
        row = await client.readPlan();
      }
    }
    if (destroyed) return;
    const data = normalizeStorage(row?.data);
    if (!data || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1)
      throw new Error("O planejamento salvo não pôde ser lido. Tente novamente.");
    journalKey = `weeding-family-pending-v1:${config.url}:${client.userId || config.email || "family"}`;
    sync = syncFactory({
      client,
      initialData: data,
      initialRevision: Number(row.revision),
      storage: journalStorage,
      storageKey: journalKey,
      onData: (next) => app?.replaceData(next),
      onStatus: (status) => app?.setSyncStatus(status),
    });
    app = appFactory(root, {
      initialData: sync.data ?? data,
      onSave: (next) => sync.save(next),
      onSignOut: () => { void signOut(); },
      onRetrySync: () => { void sync.retry(); },
    });
    app.setSyncStatus(sync.pending
      ? { state: "saving", message: "Enviando alterações deste aparelho…" }
      : { state: "saved", message: "Tudo salvo para a família" });
  }

  async function begin() {
    card('<p role="status">Verificando acesso…</p>');
    try {
      const session = await client.restoreSession();
      if (destroyed) return;
      if (session) await openPlanning();
      else login();
    } catch (error) {
      if (!destroyed) unavailable(error.message || "Não foi possível conectar. Confira sua internet e tente novamente.");
    }
  }

  async function submit(event) {
    if (!event.target.matches("[data-family-login]")) return;
    event.preventDefault();
    if (busy || destroyed) return;
    busy = true;
    const input = event.target.querySelector('[name="password"]');
    lastUsername = event.target.querySelector('[name="username"]').value.trim();
    const button = event.target.querySelector("button");
    button.disabled = true;
    button.textContent = "Entrando…";
    try {
      await client.signIn(input.value, lastUsername);
      input.value = "";
    } catch (error) {
      if (!destroyed) login(error.message || "Não foi possível entrar. Tente novamente.");
      busy = false;
      return;
    }
    try {
      await openPlanning();
    } catch (error) {
      if (!destroyed) unavailable(error.message || "Não foi possível abrir o planejamento. Tente novamente.");
    } finally {
      busy = false;
    }
  }

  function click(event) {
    if (event.target.closest("[data-family-retry]") && !busy) {
      busy = true;
      void begin().finally(() => { busy = false; });
    }
    if (event.target.closest("[data-family-exit]")) void signOut();
  }
  function beforeUnload(event) {
    if (!sync?.pending) return;
    event.preventDefault();
    event.returnValue = "";
  }

  root.addEventListener("submit", submit);
  root.addEventListener("click", click);
  window.addEventListener("beforeunload", beforeUnload);
  let ready;
  try {
    client = clientFactory(config);
    ready = begin();
  } catch {
    card('<p role="status">O acesso ainda não está disponível. Aguarde a configuração do responsável.</p>');
    ready = Promise.resolve();
  }
  return {
    ready,
    destroy() {
      destroyed = true;
      sync?.destroy();
      app?.destroy();
      root.removeEventListener("submit", submit);
      root.removeEventListener("click", click);
      window.removeEventListener("beforeunload", beforeUnload);
      root.innerHTML = "";
    },
  };
}

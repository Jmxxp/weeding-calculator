import { mountApp } from "./app.js";
import { createSupabaseClient } from "./lib/supabase.js";
import { createFamilySync } from "./lib/family-sync.js";
import { loadData, normalizeStorage } from "./lib/storage.js";
import { createEmptyData } from "./lib/demo.js";
import { escapeHtml as e, icon } from "./ui.js";

/** Open the public shared planner after a successful database read. */
export function mountFamilyAccess(root, config, dependencies = {}) {
  const clientFactory = dependencies.clientFactory ?? createSupabaseClient;
  const appFactory = dependencies.appFactory ?? mountApp;
  const syncFactory = dependencies.syncFactory ?? createFamilySync;
  let client, app, sync, destroyed = false, busy = false;
  let journalKey;
  let journalStorage;
  try { journalStorage = globalThis.localStorage; } catch {}

  function card(content) {
    if (destroyed) return;
    root.innerHTML = `<main class="family-access"><section class="family-access-card" aria-labelledby="family-title"><div class="family-access-symbol">${icon("Heart", 30)}</div><p class="family-eyebrow">NOSSO GRANDE DIA</p><h1 id="family-title">Nosso planejamento</h1>${content}</section></main>`;
  }

  function unavailable(message) {
    card(`<p class="family-error" role="alert">${e(message)}</p><button class="button button-primary" data-family-retry type="button">Tentar novamente</button>`);
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
      onRetrySync: () => { void sync.retry(); },
    });
    app.setSyncStatus(sync.pending
      ? { state: "saving", message: "Enviando alterações deste aparelho…" }
      : { state: "saved", message: "Tudo salvo para a família" });
  }

  async function begin() {
    try {
      await openPlanning();
    } catch (error) {
      if (!destroyed) unavailable(error.message || "Não foi possível conectar. Confira sua internet e tente novamente.");
    }
  }

  function click(event) {
    if (event.target.closest("[data-family-retry]") && !busy) {
      busy = true;
      void begin().finally(() => { busy = false; });
    }
  }
  function beforeUnload(event) {
    if (!sync?.pending) return;
    event.preventDefault();
    event.returnValue = "";
  }

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
      root.removeEventListener("click", click);
      window.removeEventListener("beforeunload", beforeUnload);
      root.innerHTML = "";
    },
  };
}

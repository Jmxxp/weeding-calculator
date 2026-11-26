import { mountApp } from "./app.js";
import { createSupabaseClient } from "./lib/supabase.js";
import { createFamilySync } from "./lib/family-sync.js";
import { loadData, normalizeStorage } from "./lib/storage.js";
import { createEmptyData } from "./lib/demo.js";

/** Keep the planner usable locally while the shared connection is unavailable. */
export function mountFamilyAccess(root, config, dependencies = {}) {
  const clientFactory = dependencies.clientFactory ?? createSupabaseClient;
  const appFactory = dependencies.appFactory ?? mountApp;
  const syncFactory = dependencies.syncFactory ?? createFamilySync;
  const offlineKey = `weeding-family-offline-v1:${config.url || "unconfigured"}`;
  let storage;
  try { storage = globalThis.localStorage; } catch {}
  let baseline = loadData();
  let localData = structuredClone(baseline);
  try {
    const saved = JSON.parse(storage?.getItem(offlineKey) || "null");
    const before = normalizeStorage(saved?.baseline);
    const desired = normalizeStorage(saved?.desired);
    if (saved?.version === 1 && before && desired) {
      baseline = before;
      localData = desired;
    }
  } catch { /* A broken draft must never replace usable browser data. */ }

  let client, app, sync, destroyed = false, busy = false;
  let draftPersisted = true;
  const hasLocalChanges = () => JSON.stringify(baseline) !== JSON.stringify(localData);
  function persistOffline() {
    try {
      if (!storage) return false;
      if (hasLocalChanges())
        storage.setItem(offlineKey, JSON.stringify({ version: 1, baseline, desired: localData }));
      else storage.removeItem(offlineKey);
      return true;
    } catch { return false; }
  }
  function clearOffline() {
    try { storage?.removeItem(offlineKey); } catch {}
  }
  function retainRecovery() {
    if (!sync) return;
    if (!sync.pending) { clearOffline(); return; }
    const recovery = sync.recoveryState;
    if (!recovery) return;
    baseline = recovery.baseline;
    localData = recovery.desired;
    draftPersisted = persistOffline();
    // Never leave an older fallback behind when the main sync journal is newer.
    if (!draftPersisted && recovery.persisted) clearOffline();
  }
  function localStatus() {
    app.setSyncStatus({
      state: busy ? "saving" : "error",
      message: !draftPersisted
        ? "Alterações apenas na memória deste aparelho. Mantenha a página aberta até salvar."
        : busy
          ? "Conectando ao compartilhamento. Você já pode usar o planejamento neste aparelho."
          : "Sem conexão com o compartilhamento. Os dados ficam salvos somente neste navegador.",
    });
  }

  app = appFactory(root, {
    initialData: localData,
    onSave(next) {
      localData = structuredClone(next);
      if (sync) {
        sync.save(next);
        retainRecovery();
      }
      else {
        draftPersisted = persistOffline();
        localStatus();
      }
    },
    onRetrySync: () => { void connect(); },
  });

  async function connect() {
    if (destroyed || busy) return;
    if (sync) return sync.retry();
    busy = true;
    localStatus();
    try {
      client ??= clientFactory(config);
      let row = await client.readPlan();
      if (destroyed) return;
      if (!row) {
        // Import only after a successful read proves that the shared plan is empty.
        try {
          row = await client.createPlan(localData.isDemo ? createEmptyData() : localData);
        } catch (error) {
          if (error.status !== 409) throw error;
          row = await client.readPlan();
        }
      }
      if (destroyed) return;
      const data = normalizeStorage(row?.data);
      if (!data || !Number.isSafeInteger(Number(row?.revision)) || Number(row.revision) < 1)
        throw new Error("O planejamento compartilhado está inválido.");
      sync = syncFactory({
        client,
        initialData: data,
        initialRevision: Number(row.revision),
        initialChanges: { baseline, desired: structuredClone(localData) },
        storage,
        storageKey: `weeding-family-pending-v1:${config.url}:${client.userId || config.email || "family"}`,
        onData: (next) => {
          localData = structuredClone(next);
          app.replaceData(next);
          retainRecovery();
        },
        onStatus: (status) => {
          retainRecovery();
          app.setSyncStatus(status);
        },
      });
      localData = structuredClone(sync.data ?? data);
      app.replaceData(localData);
      retainRecovery();
      app.setSyncStatus(sync.pending
        ? { state: "saving", message: "Enviando alterações deste aparelho…" }
        : { state: "saved", message: "Tudo salvo para a família" });
    } catch {
      // Failed reads never create or overwrite a shared plan, nor block local use.
    } finally {
      busy = false;
      if (!destroyed && !sync) localStatus();
    }
  }
  function beforeUnload(event) {
    if (!(sync ? sync.pending : hasLocalChanges())) return;
    event.preventDefault();
    event.returnValue = "";
  }
  function online() { void connect(); }
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("online", online);
  const ready = connect();
  return {
    ready,
    destroy() {
      destroyed = true;
      sync?.destroy();
      app.destroy();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("online", online);
      root.innerHTML = "";
    },
  };
}

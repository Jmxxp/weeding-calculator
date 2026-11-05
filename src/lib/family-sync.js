import { normalizeStorage } from "./storage.js";

const missing = Symbol("missing");
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const copy = (value) =>
  value === missing ? missing : structuredClone(value);
const records = (value) =>
  Array.isArray(value) &&
  value.every((item) => isRecord(item) && typeof item.id === "string");

/** Apply only this device's edits to the latest family copy. */
function mergeChanges(base, local, remote) {
  if (same(base, local)) return copy(remote);
  if (local === missing) return missing;
  if (records(base) && records(local) && records(remote)) {
    const before = new Map(base.map((item) => [item.id, item]));
    const after = new Map(local.map((item) => [item.id, item]));
    const latest = new Map(remote.map((item) => [item.id, item]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const merged = mergeChanges(
        before.get(id) ?? missing,
        after.get(id) ?? missing,
        latest.get(id) ?? missing,
      );
      if (merged === missing) latest.delete(id);
      else latest.set(id, merged);
    }
    return [...latest.values()];
  }
  if (isRecord(local) && isRecord(remote) && isRecord(base)) {
    const result = Object.fromEntries(Object.entries(remote));
    for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
      const merged = mergeChanges(
        Object.hasOwn(base, key) ? base[key] : missing,
        Object.hasOwn(local, key) ? local[key] : missing,
        Object.hasOwn(remote, key) ? remote[key] : missing,
      );
      if (merged === missing) delete result[key];
      else
        Object.defineProperty(result, key, {
          value: merged,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    return result;
  }
  return copy(local);
}

function validData(value) {
  const data = normalizeStorage(value);
  if (!data) throw new Error("O planejamento compartilhado está inválido.");
  return data;
}

/** Serial, revision-checked synchronization for a shared family planning row. */
export function createFamilySync({
  client,
  initialData,
  initialRevision,
  onData = () => {},
  onStatus = () => {},
  delay = 400,
  pollInterval = 10000,
  storage = null,
  storageKey = null,
}) {
  let baseline = validData(initialData);
  let desired = copy(baseline);
  let revision = initialRevision;
  let destroyed = false;
  let debounceTimer;
  let operation = null;
  let requested = false;
  let generation = 0;
  let journalFailed = false;
  const journalEnabled = storage && typeof storageKey === "string" && storageKey;

  const pending = () => !same(baseline, desired);
  const status = (state, message) => {
    if (!destroyed) onStatus({ state, message });
  };

  function persistJournal() {
    if (!journalEnabled) return true;
    try {
      if (pending())
        storage.setItem(
          storageKey,
          JSON.stringify({ version: 1, baseline, desired, revision }),
        );
      else storage.removeItem(storageKey);
      journalFailed = false;
      return true;
    } catch {
      journalFailed = true;
      return false;
    }
  }

  if (journalEnabled) {
    try {
      const saved = JSON.parse(storage.getItem(storageKey) || "null");
      if (
        saved?.version === 1 &&
        Number.isSafeInteger(saved.revision) &&
        saved.revision > 0
      ) {
        desired = validData(
          mergeChanges(validData(saved.baseline), validData(saved.desired), baseline),
        );
      }
    } catch {
      // A broken or inaccessible journal must not replace valid server data.
    }
    persistJournal();
  }

  function accept(remote, snapshot) {
    const previous = desired;
    // Edits made while a network request was in flight belong to the next save.
    desired = validData(mergeChanges(snapshot, desired, remote.data));
    baseline = validData(remote.data);
    revision = remote.revision;
    persistJournal();
    if (!same(previous, desired)) onData(copy(desired));
  }

  async function synchronize() {
    let success = true;
    do {
      requested = false;
      const before = copy(baseline);
      const snapshot = copy(desired);
      const snapshotGeneration = generation;
      const hasEdits = !same(before, snapshot);
      try {
        if (hasEdits) status("saving", "Salvando para a família…");
        let accepted = false;
        for (let attempt = 0; attempt < 4; attempt++) {
          const remote = await client.readPlan();
          if (destroyed) return false;
          if (!remote)
            throw new Error("O planejamento compartilhado não foi encontrado.");
          remote.data = validData(remote.data);
          const merged = validData(mergeChanges(before, snapshot, remote.data));
          if (!hasEdits || same(merged, remote.data)) {
            accept(remote, snapshot);
            accepted = true;
            break;
          }
          const saved = await client.updatePlan(merged, remote.revision);
          if (destroyed) return false;
          if (saved) {
            accept(saved, snapshot);
            accepted = true;
            break;
          }
          // Another device won this revision. Read again and reapply our edits.
        }
        if (!accepted)
          throw new Error("A família está editando agora. Tentaremos salvar novamente.");
        if (!pending()) status("saved", "Salvo para a família");
        // Drain newer edits even when they arrived during a read-only poll.
        if (generation !== snapshotGeneration && pending()) requested = true;
      } catch (error) {
        if (destroyed) return false;
        success = false;
        status(
          "error",
          pending()
            ? journalFailed
              ? "As alterações estão apenas na memória deste aparelho. Mantenha esta página aberta e tente sincronizar novamente."
              : "Ainda há alterações neste aparelho para enviar. Tente sincronizar novamente."
            : "Não foi possível atualizar os dados da família. Tente novamente.",
        );
        // Keep both the acknowledged baseline and the pending edits intact.
        // A later poll, retry, or explicit flush will attempt them again.
        requested = false;
      }
    } while (requested && !destroyed);
    return success && !destroyed && !pending();
  }

  function flush() {
    if (destroyed) return Promise.resolve(false);
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    requested = true;
    if (!operation) {
      operation = synchronize().finally(() => {
        operation = null;
      });
    }
    return operation;
  }

  const pollTimer =
    pollInterval > 0
      ? setInterval(() => {
          if (!destroyed) void flush();
        }, pollInterval)
      : undefined;

  if (pending())
    debounceTimer = setTimeout(() => void flush(), Math.max(0, delay));

  return {
    save(data) {
      if (destroyed) return;
      desired = validData(data);
      generation++;
      clearTimeout(debounceTimer);
      const persisted = persistJournal();
      if (pending()) {
        if (persisted) status("saving", "Salvando para a família…");
        else
          status(
            "error",
            "Não foi possível guardar as alterações neste aparelho. Mantenha esta página aberta até sincronizar.",
          );
        debounceTimer = setTimeout(() => void flush(), Math.max(0, delay));
      }
    },
    retry: flush,
    flush,
    destroy() {
      destroyed = true;
      clearTimeout(debounceTimer);
      clearInterval(pollTimer);
    },
    get pending() {
      return pending();
    },
    get revision() {
      return revision;
    },
    get data() {
      return copy(desired);
    },
  };
}

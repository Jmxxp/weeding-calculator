import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { mountFamilyAccess } from "../src/family-access.js";
import { mountApp } from "../src/app.js";
import { createEmptyData } from "../src/lib/demo.js";
import { createFamilySync } from "../src/lib/family-sync.js";
import { STORAGE_KEY } from "../src/lib/storage.js";

let dom, root, access, application, descriptors;
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  descriptors = new Map();
  for (const name of ["window", "document", "localStorage", "sessionStorage", "FormData", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Element", "Node", "navigator"]) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: name === "window" ? dom.window : dom.window[name], configurable: true, writable: true });
  }
  root = document.getElementById("root");
});
afterEach(() => {
  access?.destroy();
  application?.destroy();
  access = application = null;
  dom.window.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
const row = (data = createEmptyData()) => ({ data, revision: 1 });
function fixture(overrides = {}, dependencies = {}) {
  const state = { mounted: 0, replaced: [], created: [], authCalls: 0, destroyed: 0, status: null, options: null, syncOptions: null, flushResult: true, pending: false };
  const client = {
    userId: "family",
    async restoreSession() { state.authCalls++; throw new Error("Auth must not be called"); },
    async signIn() { state.authCalls++; throw new Error("Auth must not be called"); },
    async readPlan() { return row(); },
    async createPlan(data) { state.created.push(data); return row(data); },
    ...overrides,
  };
  access = mountFamilyAccess(root, {}, {
    clientFactory: () => client,
    appFactory(_root, options) {
      state.mounted++;
      state.options = options;
      _root.innerHTML = '<div data-planner>Planejamento compartilhado</div>';
      return {
        setSyncStatus(status) { state.status = status; },
        replaceData(next) { state.replaced.push(next); },
        destroy() { state.destroyed++; _root.innerHTML = ""; },
      };
    },
    syncFactory(options) {
      state.syncOptions = options;
      return {
        save() {}, retry() {}, destroy() {},
        get pending() { return state.pending; },
        async flush() { return state.flushResult; },
      };
    },
    ...dependencies,
  });
  return state;
}
test("missing project configuration opens a usable local planner with an honest status", async () => {
  access = mountFamilyAccess(root, { url: "", publishableKey: "" });
  assert.ok(root.querySelector(".family-toolbar"));
  await access.ready;
  assert.match(root.querySelector("[data-sync-message]").textContent, /somente neste navegador/);
  assert.equal(root.querySelector('[data-action="retry-sync"]').hidden, false);
  assert.equal(root.querySelector('[name="password"]'), null);
});

test("opens the shared planner automatically without credentials or Auth calls", async () => {
  const state = fixture();
  await access.ready;
  assert.equal(root.querySelector("form"), null);
  assert.equal(root.querySelector("input"), null);
  assert.equal(state.authCalls, 0);
  assert.equal(state.mounted, 1);
  assert.equal(state.created.length, 0);
  assert.deepEqual(state.options.initialData, createEmptyData());
  assert.equal(state.options.onSignOut, undefined);
  assert.equal(localStorage.length + sessionStorage.length, 0);
});

test("failed remote reads never create or overwrite a plan; retry loads the original", async () => {
  let reads = 0;
  const state = fixture({
    async readPlan() {
      if (++reads === 1) throw new Error("Conexão indisponível");
      return row();
    },
  });
  await access.ready;
  assert.equal(state.mounted, 1);
  assert.equal(state.created.length, 0);
  assert.match(state.status.message, /somente neste navegador/);
  state.options.onRetrySync();
  await tick();
  assert.equal(state.mounted, 1);
  assert.equal(state.created.length, 0);
});

test("first public visit imports existing local planning without the old clean-start deletion", async () => {
  const local = createEmptyData();
  local.wedding.couple = "Planejamento já cadastrado";
  localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
  const state = fixture({ async readPlan() { return null; } });
  await access.ready;
  assert.equal(state.mounted, 1);
  assert.deepEqual(state.created, [local]);
  assert.equal(JSON.parse(localStorage.getItem(STORAGE_KEY)).wedding.couple, local.wedding.couple);
});

test("another device creating the row first is loaded without overwriting it", async () => {
  const remote = createEmptyData();
  remote.wedding.couple = "Dados do outro aparelho";
  let reads = 0;
  const state = fixture({
    async readPlan() { return ++reads === 1 ? null : row(remote); },
    async createPlan() { throw Object.assign(new Error("conflict"), { status: 409 }); },
  });
  await access.ready;
  assert.equal(state.replaced.at(-1).wedding.couple, remote.wedding.couple);
});

test("pending changes still prevent accidental navigation without requiring a session", async () => {
  const state = fixture();
  await access.ready;
  state.pending = true;
  const pending = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(pending);
  assert.equal(pending.defaultPrevented, true);
  state.pending = false;
  const saved = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(saved);
  assert.equal(saved.defaultPrevented, false);
});

test("opening and destroying the public planner preserves browser data and uses the existing sync journal", async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(createEmptyData()));
  localStorage.setItem("weeding-family-pending-v1:undefined:family", "pending-edits");
  sessionStorage.setItem("sim-ai-session", "private-api-key");
  const state = fixture();
  await access.ready;
  assert.equal(state.syncOptions.storageKey, "weeding-family-pending-v1:undefined:family");
  access.destroy();
  access = null;
  assert.equal(state.destroyed, 1);
  assert.ok(localStorage.getItem(STORAGE_KEY));
  assert.equal(localStorage.getItem("weeding-family-pending-v1:undefined:family"), "pending-edits");
  assert.equal(sessionStorage.getItem("sim-ai-session"), "private-api-key");
});

test("local planning is usable before a slow initial connection settles", async () => {
  let completeRead;
  const state = fixture({ readPlan() { return new Promise(resolve => { completeRead = resolve; }); } });
  assert.equal(state.mounted, 1);
  const edited = createEmptyData();
  edited.wedding.budget = 17000;
  state.options.onSave(edited);
  assert.equal(JSON.parse(localStorage.getItem("weeding-family-offline-v1:unconfigured")).desired.wedding.budget, 17000);
  completeRead(row());
  await access.ready;
  assert.equal(state.syncOptions.initialChanges.desired.wedding.budget, 17000);
});

test("offline edits survive reload and merge into shared data without losing remote changes", async () => {
  let connected = false;
  const remote = createEmptyData();
  remote.wedding.couple = "Mudança de outro aparelho";
  let remoteRow = row(remote);
  const updates = [];
  const client = {
    async readPlan() { if (!connected) throw new Error("offline"); return structuredClone(remoteRow); },
    async updatePlan(data, revision) {
      updates.push(data);
      assert.equal(revision, remoteRow.revision);
      remoteRow = {data: structuredClone(data), revision: revision + 1};
      return structuredClone(remoteRow);
    },
  };
  let synchronizer;
  const dependencies = { syncFactory(options) {
    synchronizer = createFamilySync({...options, delay: 60000, pollInterval: 0});
    return synchronizer;
  }};
  const first = fixture(client, dependencies);
  await access.ready;
  const local = createEmptyData();
  local.wedding.budget = 12000;
  first.options.onSave(local);
  assert.equal(updates.length, 0);
  access.destroy();
  connected = true;
  const restored = fixture(client, dependencies);
  assert.equal(restored.options.initialData.wedding.budget, 12000);
  await access.ready;
  assert.equal(restored.replaced.at(-1).wedding.couple, "Mudança de outro aparelho");
  assert.equal(restored.replaced.at(-1).wedding.budget, 12000);
  await synchronizer.flush();
  assert.equal(updates.length, 1);
  assert.equal(remoteRow.data.wedding.couple, "Mudança de outro aparelho");
  assert.equal(remoteRow.data.wedding.budget, 12000);
  assert.equal(localStorage.getItem("weeding-family-offline-v1:unconfigured"), null);
});

test("a malformed saved offline draft cannot overwrite usable local or shared data", async () => {
  const local = createEmptyData();
  local.wedding.couple = "Dados locais preservados";
  localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
  localStorage.setItem("weeding-family-offline-v1:unconfigured", JSON.stringify({version: 1, baseline: {}, desired: {}}));
  const state = fixture({ async readPlan() { throw new Error("offline"); } });
  await access.ready;
  assert.equal(state.options.initialData.wedding.couple, local.wedding.couple);
  assert.equal(state.created.length, 0);
});

test("edits made after reconnect remain current when reloading before acknowledgement", async () => {
  let connected = false;
  const client = {
    async readPlan() { if (!connected) throw new Error("offline"); return row(); },
  };
  const dependencies = { syncFactory: options => createFamilySync({ ...options, delay: 60000, pollInterval: 0 }) };
  const first = fixture(client, dependencies);
  await access.ready;
  const initial = createEmptyData();
  initial.wedding.budget = 100;
  first.options.onSave(initial);
  connected = true;
  first.options.onRetrySync();
  await tick();
  const newer = structuredClone(first.replaced.at(-1));
  newer.wedding.budget = 200;
  first.options.onSave(newer);
  access.destroy();
  connected = false;
  const restored = fixture(client, dependencies);
  await access.ready;
  assert.equal(restored.options.initialData.wedding.budget, 200);
  assert.equal(restored.created.length, 0);
});

test("returning online retries the shared connection without mounting the app again", async () => {
  let reads = 0;
  const state = fixture({ async readPlan() { if (++reads === 1) throw new Error("offline"); return row(); } });
  await access.ready;
  window.dispatchEvent(new window.Event("online"));
  await tick();
  assert.equal(reads, 2);
  assert.equal(state.mounted, 1);
  assert.equal(state.status.state, "saved");
});

test("destroying during the initial read cannot create a remote plan or replace the screen", async () => {
  let completeRead;
  const state = fixture({ readPlan() { return new Promise(resolve => { completeRead = resolve; }); } });
  const ready = access.ready;
  access.destroy();
  access = null;
  completeRead(null);
  await ready;
  assert.equal(state.created.length, 0);
  assert.equal(state.replaced.length, 0);
  assert.equal(root.textContent, "");
});

test("real planner loads remote data and applies remote refresh without feedback writes", () => {
  const data = createEmptyData();
  data.wedding.couple = "Família";
  let saves = 0;
  application = mountApp(root, { initialData: data, onSave() { saves++; } });
  assert.equal(saves, 0);
  assert.ok(root.querySelector(".family-toolbar"));
  assert.equal(root.querySelector('[data-action="sign-out"]'), null);
  const next = structuredClone(data);
  next.categories[0].name = "Categoria compartilhada";
  application.replaceData(next);
  assert.equal(saves, 0);
  assert.match(root.textContent, /Categoria compartilhada/i);
  application.setSyncStatus({ state: "error", message: "Aguardando conexão" });
  assert.equal(root.querySelector("[data-sync-message]").textContent, "Aguardando conexão");
  assert.equal(root.querySelector('[data-action="retry-sync"]').hidden, false);
});

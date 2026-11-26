import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { fireEvent } from "@testing-library/dom";
import { mountFamilyAccess } from "../src/family-access.js";
import { mountApp } from "../src/app.js";
import { createEmptyData } from "../src/lib/demo.js";
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
function fixture(overrides = {}) {
  const state = { mounted: 0, created: [], authCalls: 0, destroyed: 0, status: null, options: null, syncOptions: null, flushResult: true, pending: false };
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
        replaceData() {},
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
  });
  return state;
}
test("missing project configuration keeps the planner closed", async () => {
  let mounts = 0;
  access = mountFamilyAccess(root, { url: "", publishableKey: "" }, {
    appFactory() { mounts++; },
  });
  await access.ready;
  assert.match(root.textContent, /ainda não está disponível/);
  assert.equal(root.querySelector("form"), null);
  assert.equal(mounts, 0);
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
  assert.equal(state.mounted, 0);
  assert.equal(state.created.length, 0);
  assert.match(root.textContent, /Conexão indisponível/);
  fireEvent.click(root.querySelector("[data-family-retry]"));
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
  assert.equal(state.options.initialData.wedding.couple, remote.wedding.couple);
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

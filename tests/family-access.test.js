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
  const state = { mounted: 0, created: [], passwords: [], usernames: [], signedOut: 0, destroyed: 0, status: null, options: null, syncOptions: null, flushResult: true, pending: false };
  const client = {
    async restoreSession() { return null; },
    async signIn(password, username) { state.passwords.push(password); state.usernames.push(username); return { id: "family" }; },
    async readPlan() { return row(); },
    async createPlan(data) { state.created.push(data); return row(data); },
    async signOut() { state.signedOut++; },
    ...overrides,
  };
  access = mountFamilyAccess(root, {}, {
    clientFactory: () => client,
    appFactory(_root, options) {
      state.mounted++;
      state.options = options;
      _root.innerHTML = '<div data-planner>Planejamento privado</div>';
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
async function enter(password = "family-password", username = "jmxxp") {
  root.querySelector('[name="username"]').value = username;
  root.querySelector('[name="password"]').value = password;
  fireEvent.submit(root.querySelector("form"));
  await tick();
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

test("username and password open only after Auth and the database read succeed, without an email field", async () => {
  const state = fixture();
  await access.ready;
  assert.equal(root.querySelectorAll("input").length, 2);
  assert.equal(root.querySelector('[name="username"]').autocomplete, "username");
  assert.equal(root.querySelector('[name="password"]').type, "password");
  assert.equal(root.querySelector('input[type="email"]'), null);
  assert.doesNotMatch(root.textContent, /e-mail|familia@/i);
  assert.equal(state.mounted, 0);
  await enter();
  assert.deepEqual(state.passwords, ["family-password"]);
  assert.deepEqual(state.usernames, ["jmxxp"]);
  assert.equal(state.mounted, 1);
  assert.equal(state.created.length, 0);
  assert.deepEqual(state.options.initialData, createEmptyData());
  assert.equal(localStorage.length + sessionStorage.length, 0);
});

test("incorrect password leaves private data unmounted and clears the form", async () => {
  let reads = 0;
  const state = fixture({
    async signIn() { throw new Error("Senha incorreta"); },
    async readPlan() { reads++; return row(); },
  });
  await access.ready;
  await enter("incorrect");
  assert.equal(state.mounted, 0);
  assert.equal(reads, 0);
  assert.equal(root.querySelector('[name="password"]').value, "");
  assert.equal(root.querySelector('[name="username"]').value, "jmxxp");
  assert.match(root.querySelector('[role="alert"]').textContent, /Senha incorreta/);
});

test("failed remote reads never create or overwrite a plan; retry loads the original", async () => {
  let reads = 0;
  const state = fixture({
    async restoreSession() { return { id: "family" }; },
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

test("first family login imports existing local planning without the old clean-start deletion", async () => {
  const local = createEmptyData();
  local.wedding.couple = "Planejamento já cadastrado";
  localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
  const state = fixture({ async readPlan() { return null; } });
  await access.ready;
  await enter();
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
  await enter();
  assert.equal(state.options.initialData.wedding.couple, remote.wedding.couple);
});

test("sign out preserves unsent edits, then clears only this app's private browser data", async () => {
  const state = fixture();
  await access.ready;
  await enter();
  localStorage.setItem(STORAGE_KEY, "private-plan");
  localStorage.setItem("weeding-calculator-draft-v1", "private-draft");
  localStorage.setItem("weeding-calculator-ai-history-v1", "private-history");
  localStorage.setItem("other-app", "keep");
  sessionStorage.setItem("sim-ai-session", "private-api-key");
  sessionStorage.setItem("sim-ai-profiles", "private-api-profiles");
  state.pending = true;
  state.flushResult = false;
  state.options.onSignOut();
  await tick();
  assert.equal(state.signedOut, 0);
  assert.equal(state.destroyed, 0);
  assert.equal(state.status.state, "error");
  assert.equal(localStorage.getItem(STORAGE_KEY), "private-plan");
  state.flushResult = true;
  state.options.onSignOut();
  await tick();
  assert.equal(state.signedOut, 1);
  assert.equal(state.destroyed, 1);
  assert.equal(localStorage.getItem(STORAGE_KEY), null);
  assert.equal(localStorage.getItem("other-app"), "keep");
  assert.equal(sessionStorage.length, 0);
  assert.ok(root.querySelector("[data-family-login]"));
});

test("real planner loads remote data and applies remote refresh without feedback writes", () => {
  const data = createEmptyData();
  data.wedding.couple = "Família";
  let saves = 0;
  application = mountApp(root, { initialData: data, onSave() { saves++; } });
  assert.equal(saves, 0);
  assert.ok(root.querySelector(".family-toolbar"));
  const next = structuredClone(data);
  next.categories[0].name = "Categoria compartilhada";
  application.replaceData(next);
  assert.equal(saves, 0);
  assert.match(root.textContent, /Categoria compartilhada/i);
  application.setSyncStatus({ state: "error", message: "Aguardando conexão" });
  assert.equal(root.querySelector("[data-sync-message]").textContent, "Aguardando conexão");
  assert.equal(root.querySelector('[data-action="retry-sync"]').hidden, false);
});

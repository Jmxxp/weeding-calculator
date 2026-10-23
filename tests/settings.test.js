import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { fireEvent, waitFor } from "@testing-library/dom";
import { mountApp } from "../src/app.js";
import { createEmptyData } from "../src/lib/demo.js";
import { STORAGE_KEY } from "../src/lib/storage.js";
import { HISTORY_KEY } from "../src/components/assistant.js";

let dom, root, app, descriptors, browserErrors;
const realFetch = globalThis.fetch;

beforeEach(() => {
  dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://localhost/" },
  );
  dom.window.scrollTo = () => {};
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  browserErrors = [];
  dom.window.addEventListener("error", (event) => {
    browserErrors.push(event.error);
    event.preventDefault();
  });
  descriptors = new Map();
  for (const name of [
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "FormData",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "Element",
    "Node",
    "Event",
    "MouseEvent",
    "KeyboardEvent",
    "navigator",
  ]) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      value: name === "window" ? dom.window : dom.window[name],
      configurable: true,
      writable: true,
    });
  }
  root = document.getElementById("root");
});

afterEach(() => {
  app?.destroy();
  app = null;
  globalThis.fetch = realFetch;
  dom.window.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  assert.deepEqual(browserErrors, [], "Browser event handlers must not throw.");
});

function query(selector, scope = document) {
  const element = scope.querySelector(selector);
  assert.ok(element, `Expected to find ${selector}`);
  return element;
}
function click(selector, scope = document) {
  fireEvent.click(query(selector, scope));
}
function input(selector, value) {
  fireEvent.input(query(selector), { target: { value } });
}
function choose(selector, value) {
  fireEvent.change(query(selector), { target: { value } });
}
function navigate(view) {
  click(`nav [data-action="view"][data-view="${view}"]`);
}
function openConfig() {
  click('[data-assistant-action="settings"]');
}
function saveConfig() {
  click('form[data-form="ai"] button[type="submit"]');
}
function mount(data = createEmptyData()) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  app = mountApp(root);
}
function remount() {
  app.destroy();
  app = mountApp(root);
  navigate("assistant");
}
const json = (value) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const briefing = {
  description: "Casamento ao ar livre com almoço vegetariano.",
  location: "Santana, São Paulo",
  radiusKm: 30,
  priorities: "Boa comida e fotografia.",
};
function profileFixture() {
  return { ...createEmptyData(), planningProfile: { ...briefing } };
}
function completeProfile() {
  for (const [name, value] of Object.entries(briefing))
    input(`[data-assistant-profile="${name}"]`, String(value));
  fireEvent.submit(query('[data-assistant-form="profile"]'));
}

test(
  "root requires the wedding briefing and persists it across navigation and remount",
  { timeout: 5000 },
  () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("No network before briefing");
    };
    sessionStorage.setItem(
      "sim-ai-session",
      JSON.stringify({
        provider: "gemini",
        apiKey: "briefing-session-secret",
        model: "gemini-current",
      }),
    );
    mount(createEmptyData());
    navigate("assistant");
    assert.ok(document.querySelector('[data-assistant-form="profile"]'));
    assert.equal(
      document.querySelector('[data-assistant-field="draft"]'),
      null,
    );
    assert.equal(document.querySelector('[data-assistant-form="chat"]'), null);
    fireEvent.submit(query('[data-assistant-form="profile"]'));
    assert.match(
      query(".assistant-profile-error").textContent,
      /cidade|região/,
    );
    assert.equal(calls, 0);
    completeProfile();
    assert.deepEqual(
      JSON.parse(localStorage.getItem(STORAGE_KEY)).planningProfile,
      briefing,
    );
    assert.equal(
      document.querySelector('[data-assistant-form="profile"]'),
      null,
    );
    navigate("overview");
    navigate("assistant");
    assert.equal(
      document.querySelector('[data-assistant-form="profile"]'),
      null,
    );
    remount();
    assert.equal(
      document.querySelector('[data-assistant-form="profile"]'),
      null,
    );
    assert.match(document.body.textContent, /Santana/);
    assert.equal(
      localStorage.getItem(STORAGE_KEY).includes("briefing-session-secret"),
      false,
    );
    assert.equal(calls, 0);
  },
);

test(
  "root AI flow connects, edits an AI budget, persists researched options and an editable budget without leaking credentials",
  { timeout: 5000 },
  async () => {
    const data = createEmptyData();
    data.categories = data.categories.slice(0, 2);
    data.planningProfile = { ...briefing };
    data.wedding.couple = "PRIVATE-COUPLE";
    data.guestsList = [
      {
        id: "guest-one",
        name: "PRIVATE-GUEST",
        phone: "PRIVATE-GUEST-PHONE",
        partySize: 2,
        status: "confirmed",
        notes: "PRIVATE-GUEST-NOTES",
      },
    ];
    data.suppliers = [
      {
        id: "venue-a",
        categoryId: "local",
        name: "Jardim",
        price: 1000,
        phone: "PRIVATE-VENDOR-PHONE",
        favorite: true,
        rating: 5,
        notes: "",
      },
      {
        id: "venue-b",
        categoryId: "local",
        name: "Salão",
        price: 2500,
        phone: "",
        favorite: false,
        rating: 4,
        notes: "",
      },
      {
        id: "food-a",
        categoryId: "buffet",
        name: "Mesa",
        price: 2000,
        phone: "",
        favorite: false,
        rating: 4,
        notes: "",
      },
    ];
    const requests = [];
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      if (url === "/api/models")
        return json({
          models: [
            { id: "gemini-economy", name: "Gemini Economy" },
            { id: "gemini-planner", name: "Gemini Planner" },
          ],
        });
      if (url === "/api/chat")
        return json({
          message: "Encontrei um buffet; confirme a cotação.",
          sources: [
            {
              title: "Mesa Clara Buffet",
              url: "https://buffet.example/vegetariano",
            },
          ],
          recommendations: [
            {
              name: "Mesa Clara",
              categoryId: "buffet",
              category: "Buffet",
              location: briefing.location,
              description: "Atendimento vegetariano.",
              url: "https://buffet.example/vegetariano",
            },
          ],
          proposal: {
            name: "Nosso jardim",
            description: "Uma festa com a família.",
            selections: { local: "venue-b", buffet: "food-a" },
          },
        });
      throw new Error(`Unexpected URL ${url}`);
    };
    mount(data);
    navigate("assistant");
    openConfig();
    input('[name="apiKey"]', "gemini-secret-in-session");
    click('[data-action="ai-fetch-models"]');
    await waitFor(() =>
      assert.ok(document.querySelector('[name="modelSelect"]')),
    );
    choose('[name="modelSelect"]', "gemini-planner");
    assert.equal(query('[name="model"]').value, "gemini-planner");
    saveConfig();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    input('[data-assistant-field="draft"]', "Monte nosso casamento.");
    click(".assistant-send-button");
    await waitFor(() =>
      assert.ok(document.querySelector(".assistant-proposal")),
    );
    const chat = requests.find((entry) => entry.url === "/api/chat").body;
    assert.equal(chat.searchEnabled, true);
    assert.deepEqual(chat.context.profile, briefing);
    assert.equal(chat.searchApiKey, undefined);
    assert.equal(chat.context.guestsList, undefined);
    for (const value of [
      "PRIVATE-GUEST",
      "PRIVATE-COUPLE",
      "PRIVATE-VENDOR-PHONE",
    ])
      assert.equal(JSON.stringify(chat.context).includes(value), false);
    assert.match(
      query(".assistant-recommendation").textContent,
      /Cotação a consultar/,
    );
    assert.equal(
      query(".assistant-recommendation a").href,
      "https://buffet.example/vegetariano",
    );
    click('[data-assistant-action="add-recommendation"]');
    assert.equal(
      query('form[data-form="supplier"] [name="name"]').value,
      "Mesa Clara",
    );
    assert.equal(query('form[data-form="supplier"] [name="price"]').value, "");
    assert.equal(
      query('form[data-form="supplier"] [name="price"]').required,
      true,
    );
    assert.match(
      query('form[data-form="supplier"] [name="notes"]').value,
      /https:\/\/buffet\.example\/vegetariano/,
    );
    click('[data-action="supplier-rating"][data-value="5"]');
    assert.equal(query('form[data-form="supplier"] [name="price"]').value, "");
    click('[data-action="supplier-favorite"]');
    assert.equal(query('form[data-form="supplier"] [name="price"]').value, "");
    click('form[data-form="supplier"] button[type="submit"]');
    assert.equal(
      JSON.parse(localStorage.getItem(STORAGE_KEY)).suppliers.length,
      3,
    );
    input('form[data-form="supplier"] [name="price"]', "3600.50");
    choose('form[data-form="supplier"] [name="categoryId"]', "buffet");
    click('form[data-form="supplier"] button[type="submit"]');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    const recommendation = JSON.parse(
      localStorage.getItem(STORAGE_KEY),
    ).suppliers.find((supplier) => supplier.name === "Mesa Clara");
    assert.equal(recommendation.price, 3600.5);
    assert.equal(recommendation.categoryId, "buffet");
    assert.match(query(".assistant-proposal-total").textContent, /4\.500,00/);
    choose('[data-assistant-category="local"]', "venue-a");
    input('[data-assistant-field="proposal-name"]', "Nosso jardim editado");
    assert.match(query(".assistant-proposal-total").textContent, /3\.000,00/);
    click('[data-assistant-action="save"]');
    navigate("scenarios");
    assert.match(
      query(".saved-budgets-grid").textContent,
      /Nosso jardim editado/,
    );
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    assert.deepEqual(stored.scenarios[0].selections, {
      local: "venue-a",
      buffet: "food-a",
    });
    assert.equal(stored.scenarios[0].source, "ai");
    assert.equal(
      JSON.stringify(stored).includes("gemini-secret-in-session"),
      false,
    );
    assert.equal(requests[1].body.model, "gemini-planner");
    assert.equal(
      JSON.stringify(requests[1].body.context).includes(
        "gemini-secret-in-session",
      ),
      false,
    );

    remount();
    assert.equal(
      document.querySelector('[data-assistant-form="profile"]'),
      null,
    );
    navigate("scenarios");
    assert.match(
      query(".saved-budgets-grid").textContent,
      /Nosso jardim editado/,
    );
  },
);

test(
  "both provider key/model profiles survive modal switching and a session remount",
  { timeout: 5000 },
  () => {
    mount(profileFixture());
    navigate("assistant");
    openConfig();
    input('[name="apiKey"]', "gemini-profile-secret");
    input('[name="model"]', "gemini-personal-model");
    click('[data-action="ai-provider"][data-provider="deepseek"]');
    assert.equal(query('[name="apiKey"]').value, "");
    input('[name="apiKey"]', "deepseek-profile-secret");
    input('[name="searchApiKey"]', "tavily-profile-secret");
    input('[name="model"]', "deepseek-personal-model");
    click('[data-action="ai-provider"][data-provider="gemini"]');
    assert.equal(query('[name="apiKey"]').value, "gemini-profile-secret");
    assert.equal(query('[name="model"]').value, "gemini-personal-model");
    saveConfig();
    remount();
    openConfig();
    click('[data-action="ai-provider"][data-provider="deepseek"]');
    assert.equal(query('[name="apiKey"]').value, "deepseek-profile-secret");
    assert.equal(query('[name="searchApiKey"]').value, "tavily-profile-secret");
    assert.equal(query('[name="model"]').value, "deepseek-personal-model");
    saveConfig();
    assert.equal(
      JSON.parse(sessionStorage.getItem("sim-ai-session")).provider,
      "deepseek",
    );
    assert.equal(
      JSON.parse(sessionStorage.getItem("sim-ai-session")).searchApiKey,
      "tavily-profile-secret",
    );
    remount();
    openConfig();
    click('[data-action="ai-provider"][data-provider="gemini"]');
    assert.equal(query('[name="apiKey"]').value, "gemini-profile-secret");
    assert.equal(query('[name="model"]').value, "gemini-personal-model");
    assert.equal(document.querySelector('[name="searchApiKey"]'), null);
    assert.equal(
      localStorage.getItem(STORAGE_KEY).includes("profile-secret"),
      false,
    );
    assert.deepEqual(
      JSON.parse(localStorage.getItem(STORAGE_KEY)).planningProfile,
      briefing,
    );
  },
);

test(
  "editing a loading key permits reconnection and disconnect aborts the mounted assistant request",
  { timeout: 5000 },
  async () => {
    let firstSignal, finishFirst, chatSignal, finishChat;
    let modelCalls = 0;
    globalThis.fetch = async (url, options) => {
      if (url === "/api/models") {
        modelCalls += 1;
        if (modelCalls === 1) {
          firstSignal = options.signal;
          return new Promise((resolve) => {
            finishFirst = () =>
              resolve(
                json({ models: [{ id: "stale-model", name: "Old response" }] }),
              );
          });
        }
        assert.equal(JSON.parse(options.body).apiKey, "replacement-secret");
        return json({
          models: [{ id: "fresh-model", name: "Fresh response" }],
        });
      }
      if (url === "/api/chat") {
        assert.equal(JSON.parse(options.body).searchEnabled, true);
        chatSignal = options.signal;
        return new Promise((resolve) => {
          finishChat = () =>
            resolve(
              json({ message: "STALE PROVIDER RESPONSE", proposal: null }),
            );
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    };
    mount(profileFixture());
    navigate("assistant");
    openConfig();
    input('[name="apiKey"]', "original-secret");
    click('[data-action="ai-fetch-models"]');
    assert.equal(query('[data-action="ai-fetch-models"]').disabled, true);
    input('[name="apiKey"]', "replacement-secret");
    assert.equal(firstSignal.aborted, true);
    assert.equal(query('[data-action="ai-fetch-models"]').disabled, false);
    finishFirst();
    await tick();
    assert.equal(document.querySelector('[name="modelSelect"]'), null);
    click('[data-action="ai-fetch-models"]');
    await waitFor(() =>
      assert.equal(query('[name="model"]').value, "fresh-model"),
    );
    saveConfig();
    input('[data-assistant-field="draft"]', "Vamos planejar?");
    click(".assistant-send-button");
    assert.equal(chatSignal.aborted, false);
    openConfig();
    click('[data-action="ai-disconnect"]');
    assert.equal(chatSignal.aborted, true);
    assert.equal(sessionStorage.getItem("sim-ai-session"), null);
    assert.equal(
      sessionStorage.getItem("sim-ai-profiles").includes("replacement-secret"),
      false,
    );
    finishChat();
    await tick();
    assert.ok(document.querySelector(".assistant-key-callout"));
    assert.equal(document.querySelector(".assistant-thinking"), null);
    assert.equal(
      document.body.textContent.includes("STALE PROVIDER RESPONSE"),
      false,
    );
    assert.equal(document.querySelector(".assistant-proposal"), null);
  },
);

test(
  "inline budget replies survive view changes, remounts and conversation switching without persisting credentials",
  { timeout: 6000 },
  async () => {
    const data = profileFixture();
    data.categories = data.categories.slice(0, 2);
    data.guestsList = [
      {
        id: "guest-history",
        name: "Pessoa convidada",
        phone: "PRIVATE-HISTORY-PHONE",
        partySize: 1,
        status: "pending",
        notes: "",
      },
    ];
    data.suppliers = [
      {
        id: "venue-low",
        categoryId: "local",
        name: "Jardim",
        price: 1000,
        phone: "",
        favorite: false,
        rating: 4,
        notes: "",
      },
      {
        id: "venue-high",
        categoryId: "local",
        name: "Salão",
        price: 2500,
        phone: "",
        favorite: true,
        rating: 5,
        notes: "",
      },
      {
        id: "food-main",
        categoryId: "buffet",
        name: "Mesa",
        price: 2000,
        phone: "",
        favorite: true,
        rating: 5,
        notes: "",
      },
    ];
    sessionStorage.setItem(
      "sim-ai-session",
      JSON.stringify({
        provider: "deepseek",
        apiKey: "history-deepseek-secret",
        model: "deepseek-current",
        searchApiKey: "history-tavily-secret",
      }),
    );
    let calls = 0;
    globalThis.fetch = async (url) => {
      assert.equal(url, "/api/chat");
      calls += 1;
      if (calls === 3)
        return json({ message: "Esta é a resposta da segunda conversa." });
      return json({
        message:
          calls === 1
            ? "Resposta de orçamento persistente. history-deepseek-secret history-tavily-secret PRIVATE-HISTORY-PHONE"
            : "Outra combinação para comparar.",
        proposal: {
          name: calls === 1 ? "Plano inicial" : "Plano favorito",
          description: "Uma combinação de fornecedores cadastrados.",
          selections: { local: "venue-high", buffet: "food-main" },
        },
      });
    };
    mount(data);
    navigate("assistant");
    input('[data-assistant-field="draft"]', "Monte um orçamento equilibrado.");
    click(".assistant-send-button");
    await waitFor(() =>
      assert.ok(document.querySelector(".assistant-inline-proposal")),
    );
    const firstId = query(".assistant-inline-proposal").dataset
      .assistantProposal;
    const originalThread = query('[data-assistant-field="history"]').value;
    assert.ok(
      query(".assistant-inline-proposal").closest(".assistant-message"),
    );
    choose(
      `[data-assistant-category="local"][data-assistant-message="${firstId}"]`,
      "venue-low",
    );
    input(
      `[data-assistant-field="proposal-name"][data-assistant-message="${firstId}"]`,
      "Plano persistido e editado",
    );
    click(
      `[data-assistant-action="save"][data-assistant-message="${firstId}"]`,
    );
    const savedBudget = JSON.parse(localStorage.getItem(STORAGE_KEY))
      .scenarios[0];
    assert.equal(savedBudget.name, "Plano persistido e editado");
    assert.deepEqual(savedBudget.selections, {
      local: "venue-low",
      buffet: "food-main",
    });
    navigate("overview");
    navigate("assistant");
    assert.equal(
      query(
        `[data-assistant-field="proposal-name"][data-assistant-message="${firstId}"]`,
      ).value,
      "Plano persistido e editado",
    );
    assert.match(
      query(`[data-assistant-proposal="${firstId}"] .assistant-proposal-total`)
        .textContent,
      /3\.000,00/,
    );
    assert.equal(
      query(
        `[data-assistant-action="save"][data-assistant-message="${firstId}"]`,
      ).disabled,
      true,
    );
    assert.match(
      query(".assistant-conversation").textContent,
      /Resposta de orçamento persistente/,
    );
    let history = localStorage.getItem(HISTORY_KEY);
    for (const privateValue of [
      "history-deepseek-secret",
      "history-tavily-secret",
      "PRIVATE-HISTORY-PHONE",
      "apiKey",
      "searchApiKey",
      "guestsList",
    ])
      assert.equal(history.includes(privateValue), false);
    assert.match(history, /dado privado omitido/);

    input('[data-assistant-field="draft"]', "Monte outra variação favorita.");
    click(".assistant-send-button");
    await waitFor(() =>
      assert.equal(
        document.querySelectorAll(".assistant-inline-proposal").length,
        2,
      ),
    );
    assert.equal(
      query(
        `[data-assistant-field="proposal-name"][data-assistant-message="${firstId}"]`,
      ).value,
      "Plano persistido e editado",
    );
    click('[data-assistant-action="new-conversation"]');
    const secondThread = query('[data-assistant-field="history"]').value;
    assert.notEqual(secondThread, originalThread);
    assert.equal(
      document.querySelectorAll(".assistant-inline-proposal").length,
      0,
    );
    input('[data-assistant-field="draft"]', "Vamos pensar nas prioridades.");
    click(".assistant-send-button");
    await waitFor(() =>
      assert.match(
        query(".assistant-conversation").textContent,
        /segunda conversa/,
      ),
    );
    choose('[data-assistant-field="history"]', originalThread);
    assert.equal(
      document.querySelectorAll(".assistant-inline-proposal").length,
      2,
    );
    assert.equal(
      query(
        `[data-assistant-field="proposal-name"][data-assistant-message="${firstId}"]`,
      ).value,
      "Plano persistido e editado",
    );
    assert.match(
      query(".assistant-conversation").textContent,
      /Outra combinação para comparar/,
    );
    remount();
    assert.equal(
      query('[data-assistant-field="history"]').value,
      originalThread,
    );
    assert.equal(
      document.querySelectorAll(".assistant-inline-proposal").length,
      2,
    );
    assert.equal(
      query(
        `[data-assistant-field="proposal-name"][data-assistant-message="${firstId}"]`,
      ).value,
      "Plano persistido e editado",
    );
    history = JSON.parse(localStorage.getItem(HISTORY_KEY));
    assert.equal(history.threads.length, 2);
    assert.deepEqual(
      JSON.parse(localStorage.getItem(STORAGE_KEY)).scenarios[0],
      savedBudget,
    );
    navigate("scenarios");
    assert.match(
      query(".saved-budgets-grid").textContent,
      /Plano persistido e editado/,
    );
    assert.equal(calls, 3);
  },
);

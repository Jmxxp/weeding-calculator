import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { mountAssistant, HISTORY_KEY } from "../src/components/assistant.js";

let dom;
let container;
let view;
let data;
let config;
let saved;
let openedSettings;
let profiles;
let addedSuppliers;
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

function fixture() {
  const supplier = (id, categoryId, name, price) => ({
    id,
    categoryId,
    name,
    price,
    phone: "",
    favorite: false,
    rating: 4,
    notes: "",
  });
  return {
    version: 1,
    wedding: { couple: "Ana & Pedro", guests: 80, budget: 20000, date: "" },
    categories: [
      { id: "local", name: "Local", icon: "MapPin" },
      { id: "buffet", name: "Buffet", icon: "UtensilsCrossed" },
    ],
    suppliers: [
      supplier("local-simple", "local", "Jardim simples", 5000),
      supplier("local-favorite", "local", "Jardim favorito", 9000),
      supplier("buffet-free", "buffet", "Presente da família", 0),
      supplier("buffet-complete", "buffet", "Mesa completa", 14000),
    ],
    scenarios: [],
    isDemo: false,
    planningProfile: {
      description: "Casamento intimista ao ar livre para 80 convidados.",
      location: "Campinas, SP",
      radiusKm: 50,
      priorities: "Boa comida e fotografia; economizar em lembrancinhas.",
    },
  };
}

beforeEach(() => {
  dom = new JSDOM(
    '<!doctype html><html><body><div id="workspace"></div></body></html>',
    { url: "http://localhost:3000/" },
  );
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  container = document.getElementById("workspace");
  data = fixture();
  config = {
    provider: "gemini",
    apiKey: "fake-test-key",
    model: "gemini-test",
  };
  saved = [];
  openedSettings = 0;
  profiles = [];
  addedSuppliers = [];
  globalThis.fetch = async () => {
    throw new Error("Unexpected fetch in test");
  };
});

afterEach(() => {
  view?.destroy();
  view = undefined;
  dom.window.close();
  globalThis.fetch = originalFetch;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

function mount() {
  view = mountAssistant(container, {
    getData: () => data,
    getConfig: () => config,
    onOpenSettings: () => {
      openedSettings++;
    },
    onSaveScenario: (scenario) => {
      saved.push(scenario);
      data = { ...data, scenarios: [...data.scenarios, scenario] };
      view.refresh();
    },
    onSaveProfile: (profile) => {
      profiles.push(profile);
      data = { ...data, planningProfile: profile };
      view.refresh();
    },
    onAddSupplier: (recommendation) => {
      addedSuppliers.push(recommendation);
    },
  });
  return view;
}

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const settle = () => new Promise((resolve) => setImmediate(resolve));
const query = (selector) => {
  const element = container.querySelector(selector);
  assert.ok(element, `Missing ${selector}`);
  return element;
};
function input(selector, value) {
  const element = query(selector);
  element.value = value;
  element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  return element;
}
function select(category, value) {
  const element = query(`[data-assistant-category="${category}"]`);
  element.value = value;
  element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
function send(text) {
  input('[data-assistant-field="draft"]', text);
  query('[data-assistant-form="chat"]').dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
}

test("no-key callout opens configuration and refresh preserves the draft and cursor", () => {
  config = { ...config, apiKey: "" };
  mount();
  assert.match(container.textContent, /Conecte sua inteligência artificial/);
  assert.equal(query(".assistant-send-button").disabled, true);
  query('[data-assistant-action="prompt"][data-assistant-prompt="0"]').click();
  assert.equal(openedSettings, 1);
  assert.equal(
    query('[data-assistant-field="draft"]').value,
    "Encontre onde economizar",
  );
  const composer = input(
    '[data-assistant-field="draft"]',
    "Quero economizar no buffet",
  );
  composer.focus();
  composer.setSelectionRange(6, 15);
  config = {
    provider: "deepseek",
    apiKey: "another-fake-key",
    model: "deepseek-chat",
    searchApiKey: "fake-tavily-key",
  };
  view.refresh();
  assert.equal(container.querySelector(".assistant-key-callout"), null);
  assert.equal(query(".assistant-send-button").disabled, false);
  assert.equal(document.activeElement, query('[data-assistant-field="draft"]'));
  assert.equal(document.activeElement.selectionStart, 6);
  assert.equal(document.activeElement.selectionEnd, 15);
  assert.match(query(".assistant-model").textContent, /deepseek-chat/);
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.sessionStorage.length, 0);
});

test("a safe editable proposal recalculates zero prices and saves each distinct variation once", async () => {
  let resolveFetch;
  let body;
  globalThis.fetch = (_url, options) => {
    body = JSON.parse(options.body);
    return new Promise((resolve) => {
      resolveFetch = resolve;
    });
  };
  const originalSuppliers = structuredClone(data.suppliers);
  mount();
  query('[data-assistant-action="prompt"][data-assistant-prompt="1"]').click();
  assert.equal(query(".assistant-send-button").disabled, true);
  assert.match(
    container.textContent,
    /Pesquisando fornecedores e conferindo as fontes/,
  );
  assert.equal(body.provider, "gemini");
  assert.equal(body.messages.at(-1).content, "Monte um orçamento equilibrado");
  resolveFetch(
    response({
      message: "<img src=x onerror=alert(1)> Uma ideia para vocês.",
      proposal: {
        name: "<script>Plano</script>",
        description: "Um orçamento <b>especial</b>.",
        selections: {
          local: "local-favorite",
          buffet: "local-simple",
          invalid: "missing",
        },
      },
    }),
  );
  await settle();
  assert.equal(container.querySelector("img, script, b"), null);
  assert.match(
    query(".assistant-message:not(.is-user) .assistant-message-content")
      .textContent,
    /<img src=x/,
  );
  assert.equal(
    query('[data-assistant-field="proposal-name"]').value,
    "<script>Plano</script>",
  );
  assert.match(query(".assistant-proposal-total").textContent, /9\.000,00/);
  assert.match(container.textContent, /1 categoria ainda sem escolha/);
  select("buffet", "buffet-free");
  select("local", "local-simple");
  assert.match(query(".assistant-proposal-total").textContent, /5\.000,00/);
  assert.equal(
    container.querySelector(
      ".assistant-proposal-warning:not(.is-within-budget)",
    ),
    null,
  );
  input('[data-assistant-field="proposal-name"]', "Nosso plano em família");
  input(
    '[data-assistant-field="proposal-description"]',
    "Um presente que faz diferença.",
  );
  query('[data-assistant-action="save"]').click();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].source, "ai");
  assert.equal(saved[0].name, "Nosso plano em família");
  assert.deepEqual(saved[0].selections, {
    local: "local-simple",
    buffet: "buffet-free",
  });
  assert.ok(Number.isFinite(Date.parse(saved[0].createdAt)));
  assert.equal(query('[data-assistant-action="save"]').disabled, true);
  query('[data-assistant-action="save"]').click();
  assert.equal(saved.length, 1);
  input('[data-assistant-field="proposal-name"]', "Mais uma possibilidade");
  query('[data-assistant-action="save"]').click();
  assert.equal(saved.length, 2);
  assert.notEqual(saved[0].id, saved[1].id);
  assert.deepEqual(data.suppliers, originalSuppliers);
});

test("retry reuses the failed user turn and a new question omits unanswered turns from API history", async () => {
  const bodies = [];
  let attempts = 0;
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    attempts++;
    return attempts === 1 || attempts === 3
      ? response({ error: "Limite temporário. Tente novamente." }, 429)
      : response({ message: "Podemos comparar essas opções." });
  };
  mount();
  send("Compare meus favoritos");
  await settle();
  assert.match(query('[role="alert"]').textContent, /Limite temporário/);
  query('[data-assistant-action="retry"]').click();
  await settle();
  assert.deepEqual(bodies[0].messages, bodies[1].messages);
  assert.equal(
    container.querySelectorAll(".assistant-message.is-user").length,
    1,
  );
  assert.equal(container.querySelector('[role="alert"]'), null);
  send("Pergunta sem resposta");
  await settle();
  send("Prefiro falar sobre o local");
  await settle();
  assert.equal(
    bodies[3].messages.some(
      (message) => message.content === "Pergunta sem resposta",
    ),
    false,
  );
  assert.equal(
    bodies[3].messages.at(-1).content,
    "Prefiro falar sobre o local",
  );
  assert.equal(
    bodies[3].messages.filter((message) => message.role === "user").length,
    2,
  );
});

test("changing provider aborts an active request and late responses cannot overwrite the new conversation", async () => {
  const requests = [];
  let resolveOld;
  globalThis.fetch = (_url, options) => {
    requests.push(options);
    return requests.length === 1
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(response({ message: "Resposta do novo provedor." }));
  };
  mount();
  send("Monte meu orçamento");
  config = {
    provider: "deepseek",
    apiKey: "fake-new-key",
    model: "deepseek-reasoner",
    searchApiKey: "fake-tavily-key",
  };
  view.refresh();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(container.querySelector(".assistant-thinking"), null);
  assert.match(query('[role="alert"]').textContent, /configuração da IA mudou/);
  query('[data-assistant-action="retry"]').click();
  await settle();
  assert.equal(JSON.parse(requests[1].body).provider, "deepseek");
  resolveOld(response({ message: "Resposta antiga que deve ser ignorada." }));
  await settle();
  assert.match(container.textContent, /Resposta do novo provedor/);
  assert.doesNotMatch(
    container.textContent,
    /Resposta antiga que deve ser ignorada/,
  );
  assert.equal(
    container.querySelectorAll(".assistant-message.is-user").length,
    1,
  );
});

test("refresh removes obsolete supplier selections and updates totals without losing text edits", async () => {
  globalThis.fetch = async () =>
    response({
      message: "Aqui está uma combinação.",
      proposal: {
        name: "Primeira ideia",
        description: "",
        selections: { local: "local-simple", buffet: "buffet-complete" },
      },
    });
  mount();
  send("Monte uma combinação");
  await settle();
  assert.match(query(".assistant-proposal-total").textContent, /19\.000,00/);
  const name = input(
    '[data-assistant-field="proposal-name"]',
    "O plano que estamos imaginando",
  );
  name.focus();
  name.setSelectionRange(3, 8);
  data = {
    ...data,
    suppliers: data.suppliers.filter(
      (supplier) => supplier.id !== "local-simple",
    ),
  };
  view.refresh();
  assert.match(query(".assistant-proposal-total").textContent, /14\.000,00/);
  assert.match(container.textContent, /1 categoria ainda sem escolha/);
  assert.equal(
    query('[data-assistant-field="proposal-name"]').value,
    "O plano que estamos imaginando",
  );
  assert.equal(document.activeElement.selectionStart, 3);
  select("local", "local-favorite");
  assert.match(query(".assistant-proposal-total").textContent, /23\.000,00/);
  assert.match(container.textContent, /3\.000,00 acima do orçamento/);
  query('[data-assistant-action="save"]').click();
  assert.deepEqual(saved[0].selections, {
    local: "local-favorite",
    buffet: "buffet-complete",
  });
});

test("history is bounded in requests and destroy aborts work and removes delegated listeners", async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response({ message: "Resposta curta." });
  };
  mount();
  for (let index = 0; index < 12; index++) {
    send(`Pergunta ${index + 1}`);
    await settle();
  }
  assert.equal(container.querySelectorAll(".assistant-message").length, 24);
  assert.equal(requests.at(-1).messages.length, 20);
  assert.equal(requests.at(-1).messages.at(-1).content, "Pergunta 12");
  let pendingSignal;
  let resolveLate;
  globalThis.fetch = (_url, options) => {
    pendingSignal = options.signal;
    return new Promise((resolve) => {
      resolveLate = resolve;
    });
  };
  send("Uma última pergunta");
  view.destroy();
  assert.equal(pendingSignal.aborted, true);
  assert.equal(container.childElementCount, 0);
  container.innerHTML =
    '<button data-assistant-action="settings">Outra tela</button>';
  container.querySelector("button").click();
  assert.equal(openedSettings, 0);
  resolveLate(response({ message: "Resposta atrasada." }));
  await settle();
  assert.equal(container.textContent, "Outra tela");
  const history = dom.window.localStorage.getItem(HISTORY_KEY);
  assert.ok(
    history,
    "Messages are now intentionally saved for the next visit.",
  );
  assert.doesNotMatch(history, /fake-test-key|apiKey|searchApiKey|guestsList/);
  assert.equal(dom.window.sessionStorage.length, 0);
});

test("briefing is required before chat or API setup, validates fields and persists before continuing", () => {
  delete data.planningProfile;
  config.apiKey = "";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response({ message: "Unexpected" });
  };
  mount();
  assert.match(container.textContent, /O que vocês estão imaginando/);
  assert.equal(container.querySelector('[data-assistant-form="chat"]'), null);
  assert.equal(container.querySelector(".assistant-key-callout"), null);
  const submitProfile = () =>
    query('[data-assistant-form="profile"]').dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  submitProfile();
  assert.match(query('[role="alert"]').textContent, /cidade ou região/);
  input(
    '[data-assistant-profile="description"]',
    "  Uma festa no campo com almoço e banda.  ",
  );
  input('[data-assistant-profile="location"]', "  Campinas e Valinhos, SP  ");
  input('[data-assistant-profile="radiusKm"]', "501");
  submitProfile();
  assert.match(query('[role="alert"]').textContent, /entre 1 e 500/);
  input('[data-assistant-profile="radiusKm"]', "40");
  input(
    '[data-assistant-profile="priorities"]',
    "Fotografia e comida são nossos sonhos; decoração pode ser simples.",
  );
  submitProfile();
  assert.equal(profiles.length, 1);
  assert.equal(
    profiles[0].description,
    "Uma festa no campo com almoço e banda.",
  );
  assert.equal(profiles[0].location, "Campinas e Valinhos, SP");
  assert.equal(profiles[0].radiusKm, 40);
  assert.equal(data.planningProfile.priorities, profiles[0].priorities);
  assert.ok(container.querySelector('[data-assistant-form="chat"]'));
  assert.match(container.textContent, /Conecte sua inteligência artificial/);
  assert.equal(calls, 0);
  query('[data-assistant-action="edit-profile"]').click();
  assert.equal(
    query('[data-assistant-profile="location"]').value,
    "Campinas e Valinhos, SP",
  );
  input('[data-assistant-profile="location"]', "Outra cidade");
  query('[data-assistant-action="cancel-profile"]').click();
  assert.equal(data.planningProfile.location, "Campinas e Valinhos, SP");
});

test("web recommendations show real safe sources, keep unquoted prices absent and add a reviewable supplier", async () => {
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return response({
      message: "Encontrei opções para a região. <script>não executar</script>",
      sources: [
        { title: "<b>Fonte do jardim</b>", url: "https://example.com/jardim" },
        { title: "Duplicada", url: "https://example.com/jardim" },
        { title: "Inválida", url: "javascript:alert(1)" },
      ],
      recommendations: [
        {
          name: "Jardim <img src=x>",
          categoryId: "local",
          category: "Local",
          location: "Valinhos, SP",
          description: "Cerimônia ao ar livre.",
          url: "https://example.com/jardim",
          phone: "(19) 99999-0000",
        },
        {
          name: "Mesa da Serra",
          categoryId: "buffet",
          category: "Buffet",
          location: "Campinas, SP",
          description: "Preço publicado para o pacote descrito na fonte.",
          url: "https://example.com/buffet",
          price: 12000,
        },
        {
          name: "Link inseguro",
          category: "Flores",
          url: "data:text/html,hello",
          price: 500,
        },
      ],
      searchSuggestionsHtml:
        "<div>Google sugestões</div><script>parent.alert(1)</script>",
    });
  };
  mount();
  query('[data-assistant-action="prompt"][data-assistant-prompt="3"]').click();
  await settle();
  assert.equal(requestBody.searchEnabled, true);
  assert.equal(requestBody.context.profile.location, "Campinas, SP");
  assert.equal("couple" in requestBody.context.wedding, false);
  assert.equal("phone" in requestBody.context.suppliers[0], false);
  assert.equal("searchApiKey" in requestBody, false);
  assert.equal(
    container.querySelectorAll(".assistant-recommendation").length,
    2,
  );
  assert.match(
    query(".assistant-recommendation-price").textContent,
    /Cotação a consultar/,
  );
  assert.match(container.textContent, /Preço público; confirme condições/);
  assert.equal(container.querySelectorAll(".assistant-sources li").length, 1);
  const source = query(".assistant-sources a");
  assert.equal(source.href, "https://example.com/jardim");
  assert.equal(source.target, "_blank");
  assert.match(source.rel, /noreferrer/);
  assert.equal(source.textContent.includes("<b>Fonte do jardim</b>"), true);
  assert.equal(container.querySelector("script,img,b"), null);
  const suggestions = query("iframe.assistant-google-suggestions");
  assert.equal(suggestions.getAttribute("sandbox"), "");
  assert.equal(suggestions.title, "Sugestões de pesquisa Google");
  assert.equal(suggestions.hasAttribute("allow"), false);
  query('[data-assistant-action="add-recommendation"]').click();
  assert.equal(addedSuppliers.length, 1);
  assert.equal(addedSuppliers[0].name, "Jardim <img src=x>");
  assert.equal("price" in addedSuppliers[0], false);
  assert.equal(addedSuppliers[0].categoryId, "local");
  assert.equal(data.suppliers.length, 4);
});

test("DeepSeek requires a search key only for research and a disabled search never shows web claims", async () => {
  const requests = [];
  config = {
    provider: "deepseek",
    apiKey: "fake-deepseek-key",
    model: "deepseek-chat",
  };
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response({
      message: "Vamos comparar seus fornecedores.",
      links: [
        {
          title: "Pesquisar no Google — atalho de busca",
          url: "https://www.google.com/search?q=Campinas",
        },
      ],
      sources: [
        {
          title: "Ignored without research",
          url: "https://example.com/source",
        },
      ],
      recommendations: [
        {
          name: "Ignored without research",
          url: "https://example.com/supplier",
        },
      ],
    });
  };
  mount();
  input('[data-assistant-field="draft"]', "Compare minhas opções");
  assert.ok(container.querySelector(".assistant-search-key-callout"));
  assert.equal(query(".assistant-send-button").disabled, true);
  assert.equal(requests.length, 0);
  const checkbox = query('[data-assistant-field="search"]');
  checkbox.checked = false;
  checkbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(query(".assistant-send-button").disabled, false);
  send("Compare minhas opções");
  await settle();
  assert.equal(requests[0].searchEnabled, false);
  assert.equal("searchApiKey" in requests[0], false);
  assert.equal(container.querySelector(".assistant-recommendation"), null);
  assert.equal(
    container.querySelector(".assistant-sources:not(.assistant-useful-links)"),
    null,
  );
  assert.equal(
    query(".assistant-useful-links a").href,
    "https://www.google.com/search?q=Campinas",
  );
  config = { ...config, searchApiKey: "fake-tavily-key" };
  view.refresh();
  const search = query('[data-assistant-field="search"]');
  search.checked = true;
  search.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  send("Busque locais perto de Campinas");
  await settle();
  assert.equal(requests[1].searchEnabled, true);
  assert.equal(requests[1].searchApiKey, "fake-tavily-key");
  const history = dom.window.localStorage.getItem(HISTORY_KEY);
  assert.ok(history);
  assert.doesNotMatch(
    history,
    /fake-deepseek-key|fake-tavily-key|apiKey|searchApiKey/,
  );
  assert.equal(dom.window.sessionStorage.length, 0);
});

test("each inline Kanban budget can be edited and saved independently and survives remount with safe supplier IDs", async () => {
  let replies = 0;
  globalThis.fetch = async () =>
    response({
      message: `Possibilidade ${++replies}`,
      proposal: {
        name: `Plano ${replies}`,
        description: "Um orçamento ajustável.",
        selections: {
          local: replies === 1 ? "local-simple" : "local-favorite",
          buffet: "buffet-free",
        },
      },
    });
  mount();
  send("Primeiro orçamento");
  await settle();
  send("Outra possibilidade");
  await settle();
  let proposals = [...container.querySelectorAll(".assistant-inline-proposal")];
  assert.equal(proposals.length, 2);
  assert.ok(
    proposals.every((proposal) => proposal.closest(".assistant-message-body")),
  );
  assert.equal(
    container.querySelector(".assistant-sidebar .assistant-proposal"),
    null,
  );
  assert.match(
    proposals[0].querySelector(".assistant-proposal-total").textContent,
    /5\.000,00/,
  );
  assert.match(
    proposals[1].querySelector(".assistant-proposal-total").textContent,
    /9\.000,00/,
  );
  const firstId = proposals[0].dataset.assistantProposal;
  const secondId = proposals[1].dataset.assistantProposal;
  const firstSelect = proposals[0].querySelector(
    '[data-assistant-category="buffet"]',
  );
  firstSelect.value = "buffet-complete";
  firstSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  proposals = [...container.querySelectorAll(".assistant-inline-proposal")];
  assert.match(
    proposals[0].querySelector(".assistant-proposal-total").textContent,
    /19\.000,00/,
  );
  assert.match(
    proposals[1].querySelector(".assistant-proposal-total").textContent,
    /9\.000,00/,
  );
  input(
    `[data-assistant-field="proposal-name"][data-assistant-message="${firstId}"]`,
    "Meu plano editado",
  );
  query(
    `[data-assistant-action="save"][data-assistant-message="${firstId}"]`,
  ).click();
  query(
    `[data-assistant-action="save"][data-assistant-message="${secondId}"]`,
  ).click();
  assert.equal(saved.length, 2);
  assert.equal(saved[0].name, "Meu plano editado");
  assert.equal(saved[0].selections.buffet, "buffet-complete");
  assert.equal(saved[1].name, "Plano 2");
  assert.equal(saved[1].selections.buffet, "buffet-free");
  view.destroy();
  mount();
  assert.equal(container.querySelectorAll(".assistant-message").length, 4);
  assert.equal(
    query(
      `[data-assistant-field="proposal-name"][data-assistant-message="${firstId}"]`,
    ).value,
    "Meu plano editado",
  );
  assert.equal(
    query(`[data-assistant-action="save"][data-assistant-message="${firstId}"]`)
      .disabled,
    true,
  );
  data = {
    ...data,
    suppliers: data.suppliers.filter(
      (supplier) => supplier.id !== "local-simple",
    ),
  };
  view.refresh();
  const restored = query(`[data-assistant-proposal="${firstId}"]`);
  assert.equal(
    restored.querySelector('[data-assistant-category="local"]').value,
    "",
  );
  assert.match(
    restored.querySelector(".assistant-proposal-total").textContent,
    /14\.000,00/,
  );
  assert.match(restored.textContent, /1 categoria ainda sem escolha/);
});

test("persistent conversations can be switched and redact keys and known private guest contacts", async () => {
  data.guestsList = [
    {
      id: "guest-1",
      name: "Convidado particular",
      phone: "(11) 98888-7777",
      status: "pending",
      partySize: 1,
      notes: "Privado",
    },
  ];
  config.searchApiKey = "private-tavily-key";
  globalThis.fetch = async () =>
    response({
      message:
        "Vamos continuar. fake-test-key (11) 98888-7777 private-tavily-key",
    });
  mount();
  send("Primeiro plano: fake-test-key, (11) 98888-7777");
  await settle();
  const firstThread = query('[data-assistant-field="history"]').value;
  query('[data-assistant-action="new-conversation"]').click();
  assert.equal(container.querySelectorAll(".assistant-message").length, 0);
  send("Segundo plano");
  await settle();
  const secondThread = query('[data-assistant-field="history"]').value;
  assert.notEqual(firstThread, secondThread);
  const chooser = query('[data-assistant-field="history"]');
  chooser.value = firstThread;
  chooser.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.match(container.textContent, /Primeiro plano/);
  assert.doesNotMatch(
    container.querySelector(".assistant-conversation").textContent,
    /Segundo plano/,
  );
  config = { ...config, apiKey: "new-private-gemini-key", searchApiKey: "" };
  view.refresh();
  view.destroy();
  const stored = dom.window.localStorage.getItem(HISTORY_KEY);
  assert.doesNotMatch(
    stored,
    /fake-test-key|private-tavily-key|new-private-gemini-key|98888-7777|guestsList|Convidado particular|"apiKey"|"searchApiKey"|"context"/,
  );
  assert.match(stored, /dado privado omitido/);
  mount();
  assert.equal(query('[data-assistant-field="history"]').value, firstThread);
  assert.match(container.textContent, /Primeiro plano/);
  assert.equal(query('[data-assistant-field="history"]').options.length, 2);
});

test("message links, backend shortcuts and sourced phones are clickable without allowing HTML injection", async () => {
  globalThis.fetch = async () =>
    response({
      message:
        "Veja https://instagram.com/jardim e https://example.com/local?q=campinas. <img src=x onerror=alert(1)> javascript:alert(1)",
      links: [
        {
          title: "Pesquisar no Google — atalho de busca",
          url: "https://www.google.com/search?q=casamento+Campinas",
        },
        { title: "Inseguro", url: "javascript:alert(1)" },
      ],
      recommendations: [
        {
          name: "Jardim & Festa",
          category: "Local",
          location: "Campinas, SP",
          url: "https://example.com/local",
          phone: "+55 (19) 99999-1234",
        },
      ],
    });
  mount();
  send("Quero site, Instagram e telefone");
  await settle();
  const links = [
    ...query(
      ".assistant-message:not(.is-user) .assistant-message-content",
    ).querySelectorAll("a"),
  ];
  assert.equal(links.length, 2);
  assert.equal(links[0].href, "https://instagram.com/jardim");
  assert.equal(links[1].href, "https://example.com/local?q=campinas");
  assert.ok(
    links.every(
      (link) => link.rel.includes("noreferrer") && link.target === "_blank",
    ),
  );
  assert.equal(container.querySelector("img,script"), null);
  assert.equal(
    query(".assistant-recommendation-phone").getAttribute("href"),
    "tel:+5519999991234",
  );
  const shortcuts = [
    ...container.querySelectorAll(".assistant-search-shortcuts a"),
  ];
  assert.equal(shortcuts.length, 2);
  assert.match(
    new URL(shortcuts[0].href).searchParams.get("q"),
    /Jardim & Festa Campinas/,
  );
  assert.match(
    new URL(shortcuts[1].href).searchParams.get("q"),
    /site:instagram\.com/,
  );
  assert.match(shortcuts[1].textContent, /pelo Google/);
  assert.equal(
    container.querySelectorAll(".assistant-useful-links a").length,
    1,
  );
});

test("malformed or excessive stored history is normalized and capped before rendering", () => {
  dom.window.localStorage.setItem(HISTORY_KEY, "{invalid json");
  mount();
  assert.equal(container.querySelectorAll(".assistant-message").length, 0);
  view.destroy();
  const threads = Array.from({ length: 12 }, (_, thread) => ({
    id: `thread-${thread}`,
    title: `Conversa ${thread}`,
    apiKey: "must-not-load",
    messages: Array.from({ length: 70 }, (_, message) => ({
      id: `message-${message}`,
      role: message % 2 ? "assistant" : "user",
      content: `Mensagem ${message}`,
      context: { guestsList: ["must-not-load"] },
      proposal:
        message % 2
          ? {
              name: "Antiga",
              description: "",
              selections: {
                local: "deleted-supplier",
                buffet: "buffet-free",
                missing: "fake",
              },
            }
          : undefined,
    })),
  }));
  dom.window.localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify({ version: 1, activeId: "thread-11", threads }),
  );
  mount();
  assert.equal(query('[data-assistant-field="history"]').options.length, 8);
  assert.equal(container.querySelectorAll(".assistant-message").length, 60);
  assert.equal(query('[data-assistant-category="local"]').value, "");
  view.destroy();
  const normalized = dom.window.localStorage.getItem(HISTORY_KEY);
  assert.doesNotMatch(
    normalized,
    /must-not-load|deleted-supplier|"context"|"apiKey"/,
  );
});

test("starting empty conversations at the history limit does not discard previous conversations", () => {
  const threads = Array.from({ length: 8 }, (_, index) => ({
    id: `kept-${index}`,
    title: `Planejamento ${index}`,
    messages: [
      { id: `user-${index}`, role: "user", content: `Pedido ${index}` },
      { id: `reply-${index}`, role: "assistant", content: `Resposta ${index}` },
    ],
  }));
  dom.window.localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify({ version: 1, activeId: "kept-7", threads }),
  );
  mount();
  query('[data-assistant-action="new-conversation"]').click();
  query('[data-assistant-action="new-conversation"]').click();
  assert.equal(container.querySelectorAll(".assistant-message").length, 0);
  view.destroy();
  const stored = JSON.parse(dom.window.localStorage.getItem(HISTORY_KEY));
  assert.equal(stored.threads.length, 8);
  assert.ok(stored.threads.some((thread) => thread.id === "kept-0"));
});

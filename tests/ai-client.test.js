import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { aiFetch } from "../src/lib/ai-client.js";
import { geminiResearch } from "../src/lib/ai-search.js";

const realFetch = globalThis.fetch;
const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
let dom;
afterEach(() => {
  globalThis.fetch = realFetch;
  dom?.window.close();
  dom = undefined;
  if (originalDocument)
    Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
});

function transport(mode = "browser") {
  dom = new JSDOM(`<meta name="weeding-ai-transport" content="${mode}">`, {
    url: "https://jmxxp.github.io/weeding-calculator/",
  });
  globalThis.document = dom.window.document;
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function post(body, signal) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  };
}
function googleCandidate(text, groundingMetadata) {
  return {
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text }] },
        ...(groundingMetadata ? { groundingMetadata } : {}),
      },
    ],
  };
}
function deepseekReply(message) {
  return { choices: [{ finish_reason: "stop", message }] };
}
const context = {
  wedding: { couple: "PRIVATE-COUPLE", guests: 90, budget: 20000 },
  categories: [{ id: "venue", name: "Local" }],
  suppliers: [
    {
      id: "saved-venue",
      categoryId: "venue",
      name: "Local salvo",
      price: 5000,
      phone: "PRIVATE-PHONE",
    },
  ],
  scenarios: [],
  guestsList: [
    { name: "PRIVATE-GUEST", phone: "PRIVATE-CONTACT", notes: "PRIVATE-NOTE" },
  ],
  profile: {
    description: "Uma festa simples no jardim",
    location: "Campinas",
    radiusKm: 30,
    priorities: "Local",
  },
};
const proposal = {
  name: "Equilibrado",
  description: "Usa o local cadastrado.",
  selections: { venue: "saved-venue" },
};
const request = {
  provider: "gemini",
  apiKey: "private-gemini-key",
  model: "gemini-current",
  searchEnabled: true,
  messages: [
    { role: "user", content: "Pesquise locais e compare com meu orçamento." },
  ],
  context,
};
const source = {
  title: "Jardim Real",
  url: "https://vendor.example/local",
  content:
    "Jardim Real em Campinas. Pacote de casamento R$ 15.000,00. Telefone (19) 98888-7777.",
};
const recommendation = {
  name: "Jardim Real",
  categoryId: "venue",
  category: "Local",
  location: "Campinas",
  description: "Local para casamento.",
  url: source.url,
  price: 15000,
  phone: "(19) 98888-7777",
};

test("absent and server transport metadata preserve ordinary same-origin fetch and its Response", async () => {
  const options = post({ provider: "gemini", apiKey: "local-test-key" });
  const expected = json({ models: [] });
  let calls = 0;
  globalThis.fetch = async (endpoint, init) => {
    calls++;
    assert.equal(endpoint, "/api/models");
    assert.equal(init, options);
    return expected;
  };
  assert.equal(await aiFetch("/api/models", options), expected);
  transport("server");
  assert.equal(await aiFetch("/api/models", options), expected);
  assert.equal(calls, 2);
});

test("browser model transport uses only official providers with keys in headers and no stored credentials", async () => {
  transport();
  const calls = [];
  globalThis.fetch = async (endpoint, init) => {
    calls.push({ endpoint, init });
    if (
      String(endpoint).startsWith("https://generativelanguage.googleapis.com/")
    ) {
      assert.equal(init.headers["x-goog-api-key"], "private-gemini-key");
      assert.equal(String(endpoint).includes("private-gemini-key"), false);
      return json({
        models: [
          {
            name: "models/gemini-current",
            displayName: "Gemini atual",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      });
    }
    assert.equal(endpoint, "https://api.deepseek.com/models");
    assert.equal(init.headers.Authorization, "Bearer private-deepseek-key");
    return json({ data: [{ id: "deepseek-current", name: "DeepSeek atual" }] });
  };
  const gemini = await aiFetch(
    "/api/models",
    post({ provider: "gemini", apiKey: "private-gemini-key" }),
  );
  assert.equal(gemini.status, 200);
  assert.equal(gemini.headers.get("cache-control"), "no-store");
  assert.deepEqual(await gemini.json(), {
    models: [{ id: "gemini-current", name: "Gemini atual" }],
  });
  const deepseek = await aiFetch(
    "/api/models",
    post({ provider: "deepseek", apiKey: "private-deepseek-key" }),
  );
  assert.deepEqual(await deepseek.json(), {
    models: [{ id: "deepseek-current", name: "DeepSeek atual" }],
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ init }) => init.redirect === "error"));
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.sessionStorage.length, 0);
});

test("browser Gemini research retains sourced contacts and editable budgets while excluding private context", async () => {
  transport();
  const bodies = [];
  globalThis.fetch = async (endpoint, init) => {
    assert.equal(
      endpoint,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-current:generateContent",
    );
    assert.equal(init.headers["x-goog-api-key"], request.apiKey);
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1)
      return json(
        googleCandidate(source.content, {
          groundingChunks: [{ web: { uri: source.url, title: source.title } }],
          groundingSupports: [
            { groundingChunkIndices: [0], segment: { text: source.content } },
          ],
          searchEntryPoint: { renderedContent: "<div>Pesquisa Google</div>" },
        }),
      );
    return json(
      googleCandidate(
        JSON.stringify({
          message: "Compare a opção pesquisada com seu local salvo.",
          proposal,
          recommendations: [recommendation],
        }),
      ),
    );
  };
  const response = await aiFetch("/api/chat", post(request));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.proposal, proposal);
  assert.deepEqual(result.sources, [{ title: source.title, url: source.url }]);
  assert.equal(result.recommendations[0].price, 15000);
  assert.equal(result.recommendations[0].phone, recommendation.phone);
  assert.equal(result.searchSuggestionsHtml, "<div>Pesquisa Google</div>");
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].tools, [{ google_search: {} }]);
  assert.equal(bodies[1].generationConfig.responseMimeType, "application/json");
  assert.doesNotMatch(JSON.stringify(bodies), /PRIVATE-|private-gemini-key/);
  assert.equal(dom.window.localStorage.length, 0);
});

test("browser DeepSeek search keeps provider and Tavily keys on their own fixed endpoints in a bounded tool flow", async () => {
  transport();
  const calls = [];
  globalThis.fetch = async (endpoint, init) => {
    calls.push({ endpoint, init });
    const body = JSON.parse(init.body);
    if (calls.length === 1) {
      assert.equal(endpoint, "https://api.deepseek.com/chat/completions");
      assert.equal(init.headers.Authorization, "Bearer private-deepseek-key");
      assert.equal(JSON.stringify(body).includes("private-tavily-key"), false);
      return json(
        deepseekReply({
          content: null,
          tool_calls: [
            {
              id: "search_1",
              type: "function",
              function: {
                name: "search_wedding_suppliers",
                arguments: JSON.stringify({
                  query: "locais de casamento econômicos",
                }),
              },
            },
          ],
        }),
      );
    }
    if (calls.length === 2) {
      assert.equal(endpoint, "https://api.tavily.com/search");
      assert.equal(init.headers.Authorization, "Bearer private-tavily-key");
      assert.match(body.query, /Campinas/);
      assert.doesNotMatch(
        JSON.stringify(body),
        /private-deepseek-key|PRIVATE-/,
      );
      return json({ results: [source] });
    }
    assert.equal(endpoint, "https://api.deepseek.com/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer private-deepseek-key");
    assert.equal(body.messages.at(-1).role, "tool");
    assert.match(body.messages.at(-1).content, /Jardim Real/);
    assert.doesNotMatch(JSON.stringify(body), /private-tavily-key|PRIVATE-/);
    return json(
      deepseekReply({
        content: JSON.stringify({
          message: "Local pesquisado.",
          recommendations: [recommendation],
          proposal,
        }),
      }),
    );
  };
  const response = await aiFetch(
    "/api/chat",
    post({
      ...request,
      provider: "deepseek",
      apiKey: "private-deepseek-key",
      model: "deepseek-current",
      searchApiKey: "private-tavily-key",
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.proposal, proposal);
  assert.equal(result.recommendations[0].phone, recommendation.phone);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ init }) => init.redirect === "error"));
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.sessionStorage.length, 0);
});

test("browser transport validates route, method, UTF-8 body size and shared request fields without network", async () => {
  transport();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unexpected request");
  };
  const cases = [
    ["https://attacker.example/api/models", post({}), 404],
    ["/api/health", post({}), 404],
    ["/api/models", { method: "GET" }, 405],
    ["/api/models", { method: "POST", body: "{broken" }, 400],
    ["/api/models", post({ extra: "é".repeat(510000) }), 400],
    [
      "/api/models",
      post({ provider: "attacker", apiKey: "private-gemini-key" }),
      400,
    ],
    ["/api/chat", post({ ...request, model: "../../private" }), 400],
  ];
  for (const [endpoint, options, status] of cases) {
    const response = await aiFetch(endpoint, options);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
  }
  const needsBriefing = await aiFetch(
    "/api/chat",
    post({ ...request, context: { ...context, profile: null } }),
  );
  assert.equal(needsBriefing.status, 200);
  assert.match((await needsBriefing.json()).message, /descreva/);
  assert.equal(calls, 0);
});

test("browser transport returns sanitized provider and network failures as fetch-compatible responses", async () => {
  transport();
  globalThis.fetch = async () =>
    json(
      {
        error: {
          message: "private-gemini-key secret-provider-body",
          details: [{ reason: "API_KEY_INVALID" }],
        },
      },
      400,
    );
  const invalidKey = await aiFetch(
    "/api/models",
    post({ provider: "gemini", apiKey: "private-gemini-key" }),
  );
  assert.equal(invalidKey.status, 401);
  assert.doesNotMatch(
    await invalidKey.text(),
    /private-gemini-key|secret-provider-body/,
  );
  globalThis.fetch = async () => {
    throw new Error("CORS private-gemini-key secret-provider-body");
  };
  const unavailable = await aiFetch(
    "/api/models",
    post({ provider: "gemini", apiKey: "private-gemini-key" }),
  );
  assert.equal(unavailable.status, 502);
  assert.doesNotMatch(
    await unavailable.text(),
    /CORS|private-gemini-key|secret-provider-body/,
  );
});

test(
  "browser cancellation before and during provider fetch rejects AbortError and aborts the upstream request",
  { timeout: 3000 },
  async () => {
    transport();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("Should not run");
    };
    const canceled = new AbortController();
    canceled.abort();
    await assert.rejects(
      aiFetch(
        "/api/models",
        post(
          { provider: "gemini", apiKey: "private-gemini-key" },
          canceled.signal,
        ),
      ),
      { name: "AbortError" },
    );
    assert.equal(calls, 0);
    let started;
    const didStart = new Promise((resolve) => {
      started = resolve;
    });
    let upstreamAborted = false;
    globalThis.fetch = async (_endpoint, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => {
            upstreamAborted = true;
            reject(new DOMException("Canceled provider request", "AbortError"));
          },
          { once: true },
        );
        started();
      });
    const controller = new AbortController();
    const rejected = assert.rejects(
      aiFetch(
        "/api/models",
        post(
          { provider: "gemini", apiKey: "private-gemini-key" },
          controller.signal,
        ),
      ),
      { name: "AbortError" },
    );
    await didStart;
    controller.abort();
    await rejected;
    assert.equal(upstreamAborted, true);
  },
);

test("Google byte-indexed UTF-8 citation fallback is portable without Node Buffer", () => {
  const prefix = "Celebração: ";
  const evidence = "Jardim São José em São Paulo.";
  const buffer = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    const result = geminiResearch({
      content: { parts: [{ text: prefix + evidence + " Fim." }] },
      groundingMetadata: {
        groundingChunks: [{ web: { uri: source.url, title: source.title } }],
        groundingSupports: [
          {
            groundingChunkIndices: [0],
            segment: {
              startIndex: new TextEncoder().encode(prefix).byteLength,
              endIndex: new TextEncoder().encode(prefix + evidence).byteLength,
            },
          },
        ],
      },
    });
    assert.equal(result.sources[0].content, evidence);
  } finally {
    globalThis.Buffer = buffer;
  }
});

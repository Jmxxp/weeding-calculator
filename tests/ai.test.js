import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import { registerAiRoutes, parseAssistantReply } from "../server/ai.js";
const context = {
  wedding: { guests: 100, budget: 20_000 },
  categories: [
    { id: "venue", name: "Local" },
    { id: "food", name: "Buffet" },
  ],
  suppliers: [
    {
      id: "venue-a",
      categoryId: "venue",
      name: "Jardim",
      price: 3_000,
      phone: "PRIVATE-PHONE",
    },
    {
      id: "food-a",
      categoryId: "food",
      name: "Buffet",
      price: 80,
      totalCost: 8_000,
    },
  ],
  scenarios: [],
};
const validReply = {
  message: "Selecionei o jardim e o buffet por R$ 11.000.",
  proposal: {
    name: "Nosso dia",
    description: "Com as duas categorias cadastradas.",
    selections: { venue: "venue-a", food: "food-a" },
  },
};
test("accepts fenced JSON and only keeps editable selection fields", () => {
  const result = parseAssistantReply(
    `\`\`\`json\n${JSON.stringify({ ...validReply, total: 1 })}\n\`\`\``,
    context,
  );
  assert.equal(result.message, validReply.message);
  assert.deepEqual(
    { ...result.proposal?.selections },
    { venue: "venue-a", food: "food-a" },
  );
  assert.equal("total" in result, false);
});
test("rejects invented or mismatched supplier selections without displaying an actionable proposal", () => {
  for (const selections of [
    { venue: "unknown" },
    { venue: "food-a" },
    { unknown: "venue-a" },
    {},
  ]) {
    const result = parseAssistantReply(
      JSON.stringify({
        ...validReply,
        proposal: { ...validReply.proposal, selections },
      }),
      context,
    );
    assert.equal(result.proposal, undefined);
    assert.match(result.message, /não foi criada/);
  }
});
test("rejects malformed assistant data and accepts a message without proposal", () => {
  assert.throws(
    () => parseAssistantReply("not JSON", context),
    /formato inesperado/,
  );
  assert.throws(
    () => parseAssistantReply('{"message":42}', context),
    /resposta válida/,
  );
  assert.deepEqual(
    parseAssistantReply(
      '{"message":"Cadastre suas opções.","proposal":null}',
      context,
    ),
    { message: "Cadastre suas opções." },
  );
});
test("assistant replies fit the next request message limit, including invalid-proposal notices", () => {
  for (const proposal of [
    null,
    { ...validReply.proposal, selections: { venue: "unknown" } },
  ]) {
    const result = parseAssistantReply(
      JSON.stringify({ message: "a".repeat(20_000), proposal }),
      context,
    );
    assert.ok(result.message.length <= 12_000);
    if (proposal) assert.match(result.message, /não foi criada/);
  }
});
const app = express();
app.use(express.json({ limit: "1mb" }));
registerAiRoutes(app);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Could not bind test server");
const baseUrl = `http://127.0.0.1:${address.port}`;
const realFetch = globalThis.fetch;
after(
  () =>
    new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
async function request(path, body) {
  const response = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
test("Gemini lists generation models with key in header, filtering unsupported modalities", async () => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        models: [
          {
            name: "models/gemini-current-flash",
            displayName: "Gemini Flash",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding",
            supportedGenerationMethods: ["embedContent"],
          },
          {
            name: "models/gemini-tts",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const result = await request("/api/models", {
      provider: "gemini",
      apiKey: "test-key-private",
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.models, [
      { id: "gemini-current-flash", name: "Gemini Flash" },
    ]);
    assert.equal(
      new URL(calls[0].url).origin,
      "https://generativelanguage.googleapis.com",
    );
    assert.equal(calls[0].url.includes("test-key-private"), false);
    assert.equal(
      (calls[0].init?.headers)["x-goog-api-key"],
      "test-key-private",
    );
    assert.equal(calls[0].init?.redirect, "error");
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("DeepSeek chat binds actual context and validates editable budget IDs", async () => {
  let calledUrl = "";
  let calledBody = {};
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = JSON.parse(String(init?.body));
    assert.equal((init?.headers).Authorization, "Bearer test-key-private");
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(validReply) },
          },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const result = await request("/api/chat", {
      provider: "deepseek",
      apiKey: "test-key-private",
      model: "deepseek-current",
      messages: [{ role: "user", content: "Monte uma opção econômica." }],
      context,
    });
    assert.equal(result.status, 200);
    assert.equal(calledUrl, "https://api.deepseek.com/chat/completions");
    assert.equal(calledBody.max_tokens, 4096);
    assert.deepEqual(calledBody.thinking, { type: "disabled" });
    assert.equal(JSON.stringify(calledBody).includes("PRIVATE-PHONE"), false);
    assert.equal(
      JSON.stringify(calledBody).includes("test-key-private"),
      false,
    );
    assert.match(JSON.stringify(calledBody), /food-a/);
    assert.match(
      JSON.stringify(calledBody),
      /Nunca multiplique esse price pelos convidados/,
    );
    assert.deepEqual(result.body.proposal, validReply.proposal);
    assert.ok(result.body.message.startsWith(validReply.message));
    assert.match(result.body.message, /não houve pesquisa na web/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("DeepSeek model listing uses live IDs and display names from its official endpoint", async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.deepseek.com/models");
    assert.equal((init?.headers).Authorization, "Bearer test-key-private");
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "deepseek-current",
            name: "DeepSeek Current",
            output_modalities: ["text"],
          },
          { id: "bad/model", name: "Unusable identifier" },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const result = await request("/api/models", {
      provider: "deepseek",
      apiKey: "test-key-private",
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.models, [
      { id: "deepseek-current", name: "DeepSeek Current" },
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("chat keeps only the most recent 20 messages and rejects truncated upstream JSON", async () => {
  let messageCount = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    messageCount = body.messages.length;
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "length",
            message: { content: JSON.stringify(validReply) },
          },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const result = await request("/api/chat", {
      provider: "deepseek",
      apiKey: "test-key-private",
      model: "deepseek-current",
      messages: Array.from({ length: 300 }, (_, index) => ({
        role: index % 2 ? "user" : "assistant",
        content: `Mensagem ${index}`,
      })),
      context,
    });
    assert.equal(result.status, 502);
    assert.equal(messageCount, 21); // 20 conversation messages plus the server's system instruction.
    assert.match(String(result.body.error), /incompleta/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("Gemini maps assistant roles and omits thought parts from final JSON", async () => {
  let calledBody = {};
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-current:generateContent",
    );
    calledBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { text: "private thought", thought: true },
                { text: JSON.stringify(validReply) },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    const result = await request("/api/chat", {
      provider: "gemini",
      apiKey: "test-key-private",
      model: "models/gemini-current",
      messages: [
        { role: "assistant", content: "Vamos planejar." },
        { role: "user", content: "Monte uma opção." },
      ],
      context,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.proposal, validReply.proposal);
    assert.ok(result.body.message.startsWith(validReply.message));
    assert.match(result.body.message, /não houve pesquisa na web/);
    assert.equal(calledBody.contents[0].role, "model");
    assert.deepEqual(calledBody.generationConfig, {
      responseMimeType: "application/json",
      maxOutputTokens: 4096,
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("upstream errors and network exceptions never expose provider bodies or credentials", async () => {
  try {
    for (const status of [401, 402, 429, 500]) {
      globalThis.fetch = async () =>
        new Response("secret-provider-body test-key-private", { status });
      const result = await request("/api/models", {
        provider: "deepseek",
        apiKey: "test-key-private",
      });
      assert.equal(result.status, status === 500 ? 502 : status);
      assert.equal(
        JSON.stringify(result.body).includes("test-key-private"),
        false,
      );
      assert.equal(
        JSON.stringify(result.body).includes("secret-provider-body"),
        false,
      );
    }
    globalThis.fetch = async () => {
      throw new Error("test-key-private in network error");
    };
    const result = await request("/api/models", {
      provider: "gemini",
      apiKey: "test-key-private",
    });
    assert.equal(result.status, 502);
    assert.equal(
      JSON.stringify(result.body).includes("test-key-private"),
      false,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("Gemini invalid-key reason maps to authentication without disclosing provider details", async () => {
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "secret-provider-body test-key-private",
            status: "INVALID_ARGUMENT",
            details: [{ reason: "API_KEY_INVALID" }],
          },
        }),
        { status: 400 },
      );
    const result = await request("/api/models", {
      provider: "gemini",
      apiKey: "test-key-private",
    });
    assert.equal(result.status, 401);
    assert.match(String(result.body.error), /chave de API foi recusada/);
    assert.equal(
      JSON.stringify(result.body).includes("test-key-private"),
      false,
    );
    assert.equal(
      JSON.stringify(result.body).includes("secret-provider-body"),
      false,
    );
    for (const body of [
      "not JSON test-key-private",
      JSON.stringify({ error: { message: "API_KEY_INVALID" } }),
    ]) {
      globalThis.fetch = async () => new Response(body, { status: 400 });
      const fallback = await request("/api/models", {
        provider: "gemini",
        apiKey: "test-key-private",
      });
      assert.equal(fallback.status, 400);
      assert.equal(
        JSON.stringify(fallback.body).includes("test-key-private"),
        false,
      );
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("DeepSeek insufficient balance explains account credits instead of suggesting a temporary retry", async () => {
  globalThis.fetch = async () =>
    new Response("secret-provider-body test-key-private", { status: 402 });
  try {
    const result = await request("/api/models", {
      provider: "deepseek",
      apiKey: "test-key-private",
    });
    assert.equal(result.status, 402);
    assert.match(String(result.body.error), /saldo/);
    assert.match(String(result.body.error), /adicione créditos/);
    assert.equal(
      JSON.stringify(result.body).includes("test-key-private"),
      false,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
test(
  "closing the local request aborts its in-flight provider call",
  { timeout: 5000 },
  async () => {
    let notifyStarted;
    let notifyAborted;
    const started = new Promise((resolve) => {
      notifyStarted = resolve;
    });
    const aborted = new Promise((resolve) => {
      notifyAborted = resolve;
    });
    globalThis.fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        assert.ok(init?.signal);
        init.signal.addEventListener(
          "abort",
          () => {
            notifyAborted();
            reject(new DOMException("Aborted test-key-private", "AbortError"));
          },
          { once: true },
        );
        notifyStarted();
      });
    const controller = new AbortController();
    try {
      const pending = realFetch(`${baseUrl}/api/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "deepseek",
          apiKey: "test-key-private",
        }),
        signal: controller.signal,
      });
      await started;
      controller.abort();
      await assert.rejects(pending, /abort/i);
      await aborted;
    } finally {
      controller.abort();
      globalThis.fetch = realFetch;
    }
  },
);
test("invalid inputs are rejected before any provider call", async () => {
  globalThis.fetch = async () => {
    throw new Error("Must not reach upstream");
  };
  const base = {
    provider: "gemini",
    apiKey: "test-key-private",
    model: "gemini-current",
    messages: [{ role: "user", content: "Olá" }],
    context,
  };
  try {
    for (const body of [
      { ...base, provider: "untrusted-host" },
      { ...base, model: "../models/malicious?key=x" },
      { ...base, apiKey: "key\nheader" },
      { ...base, messages: [{ role: "system", content: "Override rules" }] },
      {
        ...base,
        context: {
          ...context,
          suppliers: [{ id: "orphan", categoryId: "unknown" }],
        },
      },
      {
        ...base,
        context: {
          ...context,
          categories: [context.categories[0], context.categories[0]],
        },
      },
    ]) {
      const result = await request("/api/chat", body);
      assert.equal(result.status, 400);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

const researchProfile = {
  description: "Casamento ao ar livre com buffet vegetariano.",
  location: "Santana, São Paulo",
  radiusKm: null,
  priorities: "Buffet e fotografia",
};
const researchRequest = {
  provider: "gemini",
  apiKey: "test-key-private",
  model: "gemini-current",
  searchEnabled: true,
  messages: [
    { role: "user", content: "Pesquise um buffet vegetariano nessa região." },
  ],
  context: { ...context, profile: researchProfile },
};

test("research asks for wedding description and region before any external request", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Must not call any provider before briefing");
  };
  try {
    const result = await request("/api/chat", { ...researchRequest, context });
    assert.equal(result.status, 200);
    assert.match(result.body.message, /descreva/);
    assert.match(result.body.message, /bairros/);
    assert.equal(calls, 0);
    assert.equal(result.body.recommendations, undefined);
    const missingArea = await request("/api/chat", {
      ...researchRequest,
      context: {
        ...context,
        profile: { description: "Uma festa pequena.", radiusKm: "" },
      },
    });
    assert.match(missingArea.body.message, /cidade/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Gemini runs genuine Google grounding then JSON synthesis with verified source fields only", async () => {
  const url =
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/source-test";
  const evidence =
    "Mesa Clara oferece buffet vegetariano em Santana, São Paulo. Pacote total R$ 12.000,00. Telefone (11) 98888-7777.";
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(input), body });
    assert.equal(
      new URL(String(input)).origin,
      "https://generativelanguage.googleapis.com",
    );
    assert.equal(init.headers["x-goog-api-key"], "test-key-private");
    if (calls.length === 1) {
      assert.deepEqual(body.tools, [{ google_search: {} }]);
      assert.equal(body.generationConfig.responseMimeType, undefined);
      return jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: evidence }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: url, title: "Mesa Clara Buffet" } },
              ],
              groundingSupports: [
                { segment: { text: evidence }, groundingChunkIndices: [0] },
              ],
              searchEntryPoint: {
                renderedContent: "<div>Original Google Suggestions</div>",
              },
            },
          },
        ],
      });
    }
    assert.equal(body.tools, undefined);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(JSON.stringify(body).includes("PRIVATE-GUEST"), false);
    assert.equal(JSON.stringify(body).includes("test-key-private"), false);
    return jsonResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  message:
                    "Encontrei uma opção com fonte; confirme condições diretamente.",
                  proposal: null,
                  sources: [
                    { title: "Forged", url: "https://invented.example/" },
                  ],
                  searchSuggestionsHtml: "<script>not metadata</script>",
                  recommendations: [
                    {
                      name: "Mesa Clara",
                      categoryId: "food",
                      category: "Buffet",
                      location: "Santana, São Paulo",
                      description: "Atendimento vegetariano anunciado.",
                      url,
                      phone: "(11) 98888-7777",
                      price: 12000,
                    },
                    {
                      name: "Empresa inventada",
                      category: "Local",
                      location: "Perto",
                      description: "",
                      url: "https://invented.example/",
                      price: 1,
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    });
  };
  try {
    const result = await request("/api/chat", {
      ...researchRequest,
      context: {
        ...researchRequest.context,
        guestsList: [{ name: "PRIVATE-GUEST", phone: "PRIVATE-PHONE" }],
      },
    });
    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(result.body.sources, [
      { title: "Mesa Clara Buffet", url },
    ]);
    assert.equal(result.body.recommendations.length, 1);
    assert.equal(result.body.recommendations[0].price, 12000);
    assert.equal(result.body.recommendations[0].phone, "(11) 98888-7777");
    assert.equal(
      result.body.searchSuggestionsHtml,
      "<div>Original Google Suggestions</div>",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("DeepSeek search requires a separate Tavily key without making a provider request", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("No search credentials");
  };
  try {
    const result = await request("/api/chat", {
      ...researchRequest,
      provider: "deepseek",
      model: "deepseek-current",
    });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /Tavily/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("DeepSeek executes one model tool call through Tavily and synthesizes its actual results", async () => {
  const sourceUrl = "https://buffet.example/vegetariano";
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    assert.equal(init.redirect, "error");
    if (url === "https://api.tavily.com/search") {
      assert.equal(init.headers.Authorization, "Bearer separate-tavily-secret");
      assert.match(body.query, /Santana/);
      assert.equal(body.max_results, 6);
      assert.equal(JSON.stringify(body).includes("test-key-private"), false);
      return jsonResponse({
        results: [
          {
            title: "Mesa Clara",
            url: sourceUrl,
            content:
              "Mesa Clara buffet vegetariano em Santana, São Paulo. Pacote total R$ 12.000,00.",
          },
        ],
      });
    }
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer test-key-private");
    assert.equal(
      JSON.stringify(body).includes("separate-tavily-secret"),
      false,
    );
    if (calls.length === 1) {
      assert.equal(body.tools[0].function.name, "search_wedding_suppliers");
      return jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_search_1",
                  type: "function",
                  function: {
                    name: "search_wedding_suppliers",
                    arguments: JSON.stringify({
                      query: "buffet vegetariano para casamento",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
    }
    assert.equal(body.messages.at(-1).role, "tool");
    assert.equal(body.messages.at(-1).tool_call_id, "call_search_1");
    assert.equal(body.tools, undefined);
    return jsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              message:
                "Encontrei um buffet. Solicite uma cotação para sua data.",
              proposal: null,
              recommendations: [
                {
                  name: "Mesa Clara",
                  categoryId: "food",
                  category: "Buffet",
                  location: "Santana, São Paulo",
                  description: "Opção vegetariana.",
                  url: sourceUrl,
                  price: 12000,
                },
              ],
            }),
          },
        },
      ],
    });
  };
  try {
    const result = await request("/api/chat", {
      ...researchRequest,
      provider: "deepseek",
      model: "deepseek-current",
      searchApiKey: "separate-tavily-secret",
    });
    assert.equal(result.status, 200);
    assert.equal(calls.length, 3);
    assert.deepEqual(result.body.sources, [
      { title: "Mesa Clara", url: sourceUrl },
    ]);
    assert.equal(result.body.recommendations[0].price, 12000);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Google without grounded matches retains an editable budget and rejects invented research results", async () => {
  try {
    let googleCalls = 0;
    globalThis.fetch = async (_url, init) => {
      googleCalls += 1;
      const body = JSON.parse(init.body);
      if (body.tools)
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Unsupported recommendation with no sources." },
                ],
              },
            },
          ],
        });
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.match(JSON.stringify(body.systemInstruction), /venue-a/);
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    ...validReply,
                    recommendations: [
                      {
                        name: "Invented Venue",
                        url: "https://invented.example/",
                        price: 1,
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      });
    };
    const noSources = await request("/api/chat", {
      ...researchRequest,
      messages: [
        {
          role: "user",
          content: "Monte um orçamento equilibrado com minhas opções.",
        },
      ],
    });
    assert.equal(noSources.status, 200);
    assert.match(noSources.body.message, /não trouxe fontes verificáveis/);
    assert.equal(googleCalls, 2);
    assert.deepEqual(noSources.body.proposal, validReply.proposal);
    assert.equal(noSources.body.sources, undefined);
    assert.equal(noSources.body.recommendations, undefined);
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call_bad",
                  function: {
                    name: "search_wedding_suppliers",
                    arguments: JSON.stringify({
                      query: "buffet",
                      url: "http://127.0.0.1/private",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
    };
    const badCall = await request("/api/chat", {
      ...researchRequest,
      provider: "deepseek",
      model: "deepseek-current",
      searchApiKey: "separate-tavily-secret",
    });
    assert.equal(badCall.status, 502);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Google follow-up research includes the recent category and preserves key errors separately from search incompatibility", async () => {
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return jsonResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                text: body.tools
                  ? "No verified matches."
                  : JSON.stringify({
                      message: "Qual categoria devemos comparar?",
                      proposal: null,
                    }),
              },
            ],
          },
        },
      ],
    });
  };
  try {
    const result = await request("/api/chat", {
      ...researchRequest,
      messages: [
        { role: "user", content: "Quero um buffet vegetariano em Santana." },
        {
          role: "assistant",
          content: "Podemos comparar buffets vegetarianos.",
        },
        { role: "user", content: "Encontre outras opções mais baratas." },
      ],
    });
    assert.equal(result.status, 200);
    assert.match(JSON.stringify(body.contents), /buffet vegetariano/);
    assert.match(JSON.stringify(body.contents), /mais baratas/);
    globalThis.fetch = async () => new Response("{}", { status: 400 });
    const incompatible = await request("/api/chat", researchRequest);
    assert.equal(incompatible.status, 400);
    assert.match(incompatible.body.error, /Google Search/);
    assert.match(incompatible.body.error, /desative/);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: { details: [{ reason: "API_KEY_INVALID" }] } }),
        { status: 400 },
      );
    const invalidKey = await request("/api/chat", researchRequest);
    assert.equal(invalidKey.status, 401);
    assert.match(invalidKey.body.error, /chave de API/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("DeepSeek may advise on registered budgets without executing or claiming a web search", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    assert.equal(String(url), "https://api.deepseek.com/chat/completions");
    assert.match(JSON.stringify(JSON.parse(init.body).messages), /venue-a/);
    return jsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              message: "Priorize a comida e compare os valores já cadastrados.",
              proposal: null,
            }),
          },
        },
      ],
    });
  };
  try {
    const result = await request("/api/chat", {
      ...researchRequest,
      provider: "deepseek",
      model: "deepseek-current",
      searchApiKey: "separate-tavily-secret",
      messages: [
        {
          role: "user",
          content: "Como equilibrar prioridades sem aumentar meu orçamento?",
        },
      ],
    });
    assert.equal(result.status, 200);
    assert.equal(calls, 1);
    assert.match(result.body.message, /não houve pesquisa na web/);
    assert.equal(result.body.sources, undefined);
    assert.equal(result.body.recommendations, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("DeepSeek no-tool planning preserves validated editable proposals while web search is enabled", async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    assert.equal(body.tools[0].function.name, "search_wedding_suppliers");
    assert.match(
      body.messages[0].content,
      /inclua proposal com seleções válidas e IDs exatos/,
    );
    assert.match(body.messages[0].content, /ID_DA_CATEGORIA/);
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify(validReply) } }],
    });
  };
  try {
    const result = await request("/api/chat", {
      ...researchRequest,
      provider: "deepseek",
      model: "deepseek-current",
      searchApiKey: "separate-tavily-secret",
      messages: [
        {
          role: "user",
          content:
            "Monte meu orçamento equilibrado com os fornecedores cadastrados.",
        },
      ],
    });
    assert.equal(result.status, 200);
    assert.equal(calls, 1);
    assert.deepEqual(result.body.proposal, validReply.proposal);
    assert.match(result.body.message, /não houve pesquisa na web/);
    assert.equal(result.body.recommendations, undefined);
    assert.equal(result.body.sources, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("requested contact links work from saved evidence without enabling another web search", async () => {
  const knownUrl = "https://www.instagram.com/jardim_real/";
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    assert.equal(
      String(input),
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-current:generateContent",
    );
    const body = JSON.parse(init.body);
    assert.equal(body.tools, undefined);
    assert.match(
      JSON.stringify(body.systemInstruction),
      /não derive um @handle/,
    );
    return jsonResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  message:
                    "Aqui estão o link cadastrado e atalhos para pesquisar.",
                  proposal: null,
                  links: [
                    { title: "Instagram cadastrado", url: knownUrl },
                    {
                      title: "Invented business profile",
                      url: "https://www.instagram.com/invented_vendor/",
                    },
                    { title: "Unsafe", url: "javascript:alert(1)" },
                  ],
                }),
              },
            ],
          },
        },
      ],
    });
  };
  try {
    const result = await request("/api/chat", {
      ...researchRequest,
      searchEnabled: false,
      context: {
        ...researchRequest.context,
        suppliers: context.suppliers.map((supplier) =>
          supplier.id === "venue-a"
            ? { ...supplier, notes: `Fonte: ${knownUrl}` }
            : supplier,
        ),
      },
      messages: [
        {
          role: "user",
          content: "Envie os links Google e Instagram do Jardim.",
        },
      ],
    });
    assert.equal(result.status, 200);
    assert.equal(calls, 1);
    assert.equal(result.body.links.length, 3);
    assert.ok(
      result.body.links.some(
        (link) => link.url === knownUrl && /cadastrado/.test(link.title),
      ),
    );
    assert.equal(
      result.body.links.some((link) => link.url.includes("invented_vendor")),
      false,
    );
    assert.equal(result.body.recommendations, undefined);
    assert.equal(result.body.sources, undefined);
    assert.match(result.body.message, /não houve pesquisa na web/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

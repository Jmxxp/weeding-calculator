import assert from "node:assert/strict";
import { test } from "node:test";
import {
  safeHttpUrl,
  normalizeSources,
  geminiResearch,
  groundedRecommendations,
  responseLinks,
} from "../server/search.js";

test("web citations allow real HTTP sources and official Google redirect URLs without fetching them", () => {
  assert.equal(
    safeHttpUrl(
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    ),
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
  );
  assert.equal(
    safeHttpUrl("https://vendor.example/service#price"),
    "https://vendor.example/service",
  );
  for (const value of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:secret@example.com/",
    "http://127.0.0.1/",
    "http://192.168.0.1/",
    "http://localhost/",
    "https://example.com/\nsecret",
  ])
    assert.equal(safeHttpUrl(value), null);
});

test("recommendations require an actual source URL and the vendor name in its evidence", () => {
  const sources = normalizeSources([
    {
      title: "Jardim Real",
      url: "https://vendor.example/local",
      content:
        "Jardim Real em Campinas. Pacote de casamento R$ 15.000,00. Telefone (19) 98888-7777.",
    },
  ]);
  const base = {
    name: "Jardim Real",
    categoryId: "venue",
    category: "Local",
    location: "Campinas",
    description: "Um local para casamento.",
    url: "https://vendor.example/local",
    price: 15000,
    phone: "(19) 98888-7777",
  };
  const categories = [{ id: "venue", name: "Local" }];
  const result = groundedRecommendations(
    [
      base,
      { ...base, name: "Unseen Vendor" },
      { ...base, url: "https://invented.example/" },
    ],
    sources,
    categories,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].price, 15000);
  assert.equal(result[0].phone, "(19) 98888-7777");
  const unproved = groundedRecommendations(
    [
      {
        ...base,
        location: "Outra cidade",
        price: 1,
        phone: "(19) 91111-1111",
        categoryId: "unknown",
      },
    ],
    sources,
    categories,
  )[0];
  assert.equal(unproved.price, undefined);
  assert.equal(unproved.phone, undefined);
  assert.equal(unproved.categoryId, undefined);
  assert.match(unproved.location, /confirmar/);
});

test("per-person, starting and missing public prices never become total package quotes", () => {
  for (const content of [
    "Jardim Real: R$ 150,00 por pessoa.",
    "Jardim Real: a partir de R$ 150,00.",
    "Jardim Real: R$ 150,00 a R$ 500,00.",
    "Jardim Real: consulte o preço.",
  ]) {
    const sources = normalizeSources([
      { title: "Jardim Real", url: "https://vendor.example/local", content },
    ]);
    const result = groundedRecommendations(
      [
        {
          name: "Jardim Real",
          url: sources[0].url,
          category: "Local",
          location: "",
          description: "",
          price: 150,
        },
      ],
      sources,
      [],
    );
    assert.equal(result[0].price, undefined);
  }
});

test("Google evidence uses cited segments and refuses unsafe citations and oversized suggestions", () => {
  const result = geminiResearch({
    content: {
      parts: [{ text: "Jardim Real: R$ 99,00 sem fonte. Local verificado." }],
    },
    groundingMetadata: {
      groundingChunks: [
        { web: { uri: "https://vendor.example/local", title: "Jardim Real" } },
        { web: { uri: "javascript:evil()", title: "Unsafe" } },
      ],
      groundingSupports: [
        { groundingChunkIndices: [0], segment: { text: "Local verificado." } },
      ],
      searchEntryPoint: { renderedContent: "x".repeat(60_001) },
    },
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].content, "Local verificado.");
  assert.equal(result.searchSuggestionsHtml, undefined);
  const recommendations = groundedRecommendations(
    [
      {
        name: "Jardim Real",
        url: result.sources[0].url,
        category: "Local",
        location: "",
        description: "",
        price: 99,
      },
    ],
    result.sources,
    [],
  );
  assert.equal(recommendations[0].price, undefined);
});

test("contact links admit exact evidence and saved URLs while rejecting invented profiles and unsafe hosts", () => {
  const sources = normalizeSources([
    {
      title: "Instagram Mesa Clara",
      url: "https://www.instagram.com/mesa_clara/",
      content: "Mesa Clara buffet.",
    },
  ]);
  const context = {
    suppliers: [
      { name: "Jardim Real", notes: "Fonte: https://jardim.example/contato" },
    ],
    categories: [],
    profile: { location: "Campinas" },
  };
  const links = responseLinks(
    [
      { title: "<img src=x onerror=evil()>", url: sources[0].url },
      { title: "Jardim", url: "https://jardim.example/contato" },
      {
        title: "Invented handle",
        url: "https://www.instagram.com/guessed_vendor/",
      },
      {
        title: "Fake Google host",
        url: "https://www.google.com.evil.example/search?q=vendor",
      },
      { title: "Credentials", url: "https://private:secret@example.com/" },
      { title: "Unsafe", url: "javascript:alert(1)" },
    ],
    sources,
    context,
  );
  assert.equal(links.length, 2);
  assert.equal(links[0].title, "Fonte: Instagram Mesa Clara");
  assert.equal(links[1].title, "Link cadastrado: Jardim Real");
  assert.equal(JSON.stringify(links).includes("onerror"), false);
});

test("Google and Instagram shortcuts encode the query and area and explicitly identify themselves as searches", () => {
  const context = {
    suppliers: [],
    categories: [{ id: "food", name: "Buffet" }],
    profile: { location: 'São Paulo <img src=x onerror="evil()"> & Jardins' },
  };
  const links = responseLinks(
    [],
    [],
    context,
    "Mande os links Google e Instagram para buffet",
  );
  assert.equal(links.length, 2);
  for (const link of links) {
    const url = new URL(link.url);
    assert.equal(url.origin, "https://www.google.com");
    assert.equal(url.pathname, "/search");
    assert.equal(link.url.includes("<"), false);
    assert.equal(link.url.includes('"'), false);
    assert.match(url.searchParams.get("q"), /São Paulo/);
    assert.match(link.title, /atalho de busca/);
  }
  assert.match(
    new URL(links[1].url).searchParams.get("q"),
    /^site:instagram\.com /,
  );
  assert.equal(
    responseLinks([], [], context, "Monte meu orçamento equilibrado.").length,
    0,
  );
});

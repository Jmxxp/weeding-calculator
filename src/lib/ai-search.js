/**
 * Public provider contracts, checked 2026-10-23:
 * https://ai.google.dev/gemini-api/docs/generate-content/google-search
 * https://api-docs.deepseek.com/guides/tool_calls/
 * https://docs.tavily.com/documentation/api-reference/endpoint/search
 * https://support.google.com/websearch/answer/2466433
 * Search result URLs are displayed as evidence, never fetched by this server.
 */
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 2000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const comparable = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function safeHttpUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    const host = url.hostname.toLowerCase();
    if (
      !host.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(host) ||
      /^(?:0|10|127|169\.254|192\.168)\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
      host.startsWith("[")
    )
      return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeSources(values) {
  if (!Array.isArray(values)) return [];
  const sources = new Map();
  for (const value of values.slice(0, 30)) {
    if (!object(value)) continue;
    const url = safeHttpUrl(value.url);
    if (!url) continue;
    const prior = sources.get(url);
    const content = text(value.content, 5000);
    if (prior) prior.content = `${prior.content}\n${content}`.slice(0, 8000);
    else
      sources.set(url, {
        title: text(value.title, 200) || new URL(url).hostname,
        url,
        content,
      });
  }
  return [...sources.values()].slice(0, 12);
}

/** Confirmed source links stay separate from explicit, server-created search shortcuts. */
export function responseLinks(
  values,
  sources = [],
  context = {},
  requestText = "",
) {
  const known = new Map();
  for (const source of sources) {
    const url = safeHttpUrl(source?.url);
    if (url)
      known.set(url, {
        title: `Fonte: ${text(source.title, 160) || new URL(url).hostname}`,
        url,
      });
  }
  // Saved source URLs can be reused, but do not imply fresh web verification.
  for (const supplier of Array.isArray(context.suppliers)
    ? context.suppliers
    : []) {
    for (const match of text(supplier?.notes, 5000).matchAll(
      /https?:\/\/[^\s<>"']+/gi,
    )) {
      const url = safeHttpUrl(match[0].replace(/[),.;\]}]+$/, ""));
      if (url && !known.has(url))
        known.set(url, {
          title: `Link cadastrado: ${text(supplier.name, 140) || "fornecedor"}`,
          url,
        });
    }
  }
  const links = new Map();
  for (const value of Array.isArray(values) ? values.slice(0, 20) : []) {
    if (links.size >= 6) break;
    const url = safeHttpUrl(value?.url);
    if (url && known.has(url)) links.set(url, known.get(url));
  }
  const request = comparable(requestText);
  if (
    /\b(?:link|links|site|sites|instagram|google|contato|contatos|telefone|telefones|numero|numeros|whatsapp|perfil|perfis)\b/.test(
      request,
    )
  ) {
    for (const [url, link] of known) {
      if (links.size >= 6) break;
      links.set(url, link);
    }
    const matchedNames = (
      Array.isArray(context.suppliers) ? context.suppliers : []
    )
      .filter(
        (supplier) =>
          comparable(supplier.name).length >= 3 &&
          request.includes(comparable(supplier.name)),
      )
      .map((supplier) => text(supplier.name, 160))
      .slice(0, 2);
    const matchedCategories = (
      Array.isArray(context.categories) ? context.categories : []
    )
      .filter(
        (category) =>
          comparable(category.name).length >= 3 &&
          request.includes(comparable(category.name)),
      )
      .map((category) => text(category.name, 100))
      .slice(0, 2);
    const subject = matchedNames.length
      ? matchedNames.join(" ")
      : matchedCategories.length
        ? `${matchedCategories.join(" ")} casamento`
        : text(requestText, 180)
            .replace(/https?:\/\/\S+/gi, "")
            .trim() || "fornecedores casamento";
    const query =
      `${subject} ${text(context.profile?.location || context.planningProfile?.location, 200)}`
        .trim()
        .slice(0, 500);
    const google = new URL("https://www.google.com/search");
    google.searchParams.set("q", query);
    links.set(google.toString(), {
      title: "Pesquisar no Google — atalho de busca",
      url: google.toString(),
    });
    // site: is documented by Google and does not guess an Instagram username.
    const instagram = new URL("https://www.google.com/search");
    instagram.searchParams.set("q", `site:instagram.com ${query}`);
    links.set(instagram.toString(), {
      title: "Pesquisar perfis no Instagram pelo Google — atalho de busca",
      url: instagram.toString(),
    });
  }
  return [...links.values()].slice(0, 8);
}

export function geminiResearch(candidate) {
  const metadata = object(candidate?.groundingMetadata)
    ? candidate.groundingMetadata
    : {};
  const chunks = Array.isArray(metadata.groundingChunks)
    ? metadata.groundingChunks
    : [];
  const supports = Array.isArray(metadata.groundingSupports)
    ? metadata.groundingSupports
    : [];
  const output = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
        .filter(
          (part) =>
            object(part) && !part.thought && typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("")
    : "";
  const sources = normalizeSources(
    chunks.map((chunk, index) => {
      if (!object(chunk?.web)) return null;
      const segments = supports
        .filter(
          (support) =>
            Array.isArray(support?.groundingChunkIndices) &&
            support.groundingChunkIndices.includes(index),
        )
        .map((support) => {
          if (typeof support.segment?.text === "string")
            return support.segment.text;
          const { startIndex = 0, endIndex } = support.segment || {};
          return Number.isInteger(startIndex) &&
            Number.isInteger(endIndex) &&
            startIndex >= 0 &&
            endIndex > startIndex
            ? new TextDecoder().decode(
                new TextEncoder().encode(output).subarray(startIndex, endIndex),
              )
            : "";
        });
      return {
        title: chunk.web.title,
        url: chunk.web.uri,
        content: segments.join("\n"),
      };
    }),
  );
  const html = metadata.searchEntryPoint?.renderedContent;
  return {
    sources,
    // Only Google's original suggestions metadata, never generated text or web-page HTML.
    ...(typeof html === "string" && html.length <= 60_000
      ? { searchSuggestionsHtml: html }
      : {}),
  };
}

export async function tavilySearch(apiKey, query, requestJson, signal) {
  if (
    typeof query !== "string" ||
    query.trim().length < 3 ||
    query.length > 600
  ) {
    throw new Error("INVALID_SEARCH_QUERY");
  }
  const response = await requestJson(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query.trim(),
        search_depth: "basic",
        max_results: 6,
        topic: "general",
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        safe_search: true,
        language: "pt",
      }),
    },
    20_000,
    signal,
  );
  if (!Array.isArray(response.results))
    throw new Error("INVALID_SEARCH_RESPONSE");
  return {
    sources: normalizeSources(
      response.results.map((result) => ({
        title: result?.title,
        url: result?.url,
        content: result?.content,
      })),
    ),
  };
}

function priceInEvidence(price, evidence) {
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000)
    return false;
  for (const match of evidence.matchAll(
    /(?:R\$\s*|BRL\s*)(\d+(?:[.,]\d{1,3})*)/gi,
  )) {
    const nearby = evidence.slice(
      Math.max(0, match.index - 45),
      match.index + match[0].length + 75,
    );
    // Per-person rates, ranges and starting prices cannot become a total wedding quote.
    if (
      /a partir|desde|por\s+(?:pessoa|convidad|hora|unidade)|\/\s*(?:pessoa|convidad|hora)|at[eé]\s*R\$|R\$\s*[\d.,]+\s*(?:a|at[eé]|[-–])\s*(?:R\$\s*)?\d/i.test(
        nearby,
      )
    )
      continue;
    let digits = match[1];
    if (digits.includes(","))
      digits = digits.replace(/\./g, "").replace(",", ".");
    else if (!/\.\d{1,2}$/.test(digits)) digits = digits.replace(/\./g, "");
    if (Math.abs(Number(digits) - price) < 0.005) return true;
  }
  return false;
}

export function groundedRecommendations(values, sources, categories) {
  if (!Array.isArray(values) || !sources.length) return [];
  const byUrl = new Map(sources.map((source) => [source.url, source]));
  const byCategory = new Map(
    categories.map((category) => [category.id, category]),
  );
  const recommendations = [];
  const seen = new Set();
  for (const value of values.slice(0, 20)) {
    if (!object(value)) continue;
    const url = safeHttpUrl(value.url);
    const source = byUrl.get(url);
    const name = text(value.name, 160);
    const evidence = source ? `${source.title}\n${source.content}` : "";
    if (
      !source ||
      name.length < 3 ||
      !comparable(evidence).includes(comparable(name))
    )
      continue;
    const key = `${url}:${comparable(name)}`;
    if (seen.has(key)) continue;
    const category = byCategory.get(value.categoryId);
    const claimedLocation = text(value.location, 300);
    const recommendation = {
      name,
      ...(category ? { categoryId: category.id } : {}),
      category:
        category?.name || text(value.category, 100) || "Categoria a confirmar",
      location:
        claimedLocation &&
        comparable(evidence).includes(comparable(claimedLocation))
          ? claimedLocation
          : "Localização a confirmar",
      description: text(value.description, 1000),
      url,
    };
    const phone = text(value.phone, 40);
    const phoneDigits = phone.replace(/\D/g, "");
    if (
      phoneDigits.length >= 8 &&
      phoneDigits.length <= 15 &&
      evidence.replace(/\D/g, "").includes(phoneDigits)
    )
      recommendation.phone = phone;
    if (
      typeof value.price === "number" &&
      priceInEvidence(value.price, source.content)
    )
      recommendation.price = value.price;
    recommendations.push(recommendation);
    seen.add(key);
    if (recommendations.length === 6) break;
  }
  return recommendations;
}

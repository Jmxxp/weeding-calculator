import { scenarioTotal } from "../lib/budget.js";
import { uid } from "../lib/demo.js";
import { categoryColors } from "../ui.js";
import { aiFetch } from "../lib/ai-client.js";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
export const HISTORY_KEY = "weeding-calculator-ai-history-v1";
const MAX_THREADS = 8;
const MAX_MESSAGES = 60;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const paths = {
  sparkles:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/><path d="M20 2v4M18 4h4M3 18v4M1 20h4"/>',
  wallet:
    '<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v11H5a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v4h5M16 14h.01"/>',
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  up: '<path d="m6 12 6-6 6 6M12 6v13"/>',
  settings: '<path d="M4 5h16M4 12h16M4 19h16M8 2v6M16 9v6M10 16v6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/>',
  retry: '<path d="M3 11a9 9 0 1 1 2.4 7M3 4v7h7"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9M16 16l3-3M19 19l3-3"/>',
  message:
    '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
  lightbulb: '<path d="M9 18h6M9 21h6M9 15a6 6 0 1 1 6 0v3H9v-3Z"/>',
  loader: '<path d="M12 3a9 9 0 1 1-9 9"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  map: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"/>',
};
const icon = (name, size = 16, spinning = false) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${spinning ? ' class="assistant-spin"' : ""}>${paths[name] || paths.sparkles}</svg>`;
const prompts = [
  {
    text: "Encontre onde economizar",
    description: "Pequenos ajustes, uma boa diferença no total.",
    icon: "wallet",
  },
  {
    text: "Monte um orçamento equilibrado",
    description: "Uma combinação com bom custo-benefício.",
    icon: "sparkles",
  },
  {
    text: "Compare meus favoritos",
    description: "Veja como suas escolhas combinam no orçamento.",
    icon: "heart",
  },
  {
    text: "Busque fornecedores na minha região",
    description: "Encontre opções reais e confira as fontes.",
    icon: "search",
  },
];

function normalizeProfile(value) {
  const source = value && typeof value === "object" ? value : {};
  const radius = Number(source.radiusKm);
  return {
    description:
      typeof source.description === "string"
        ? source.description.slice(0, 3000)
        : "",
    location:
      typeof source.location === "string" ? source.location.slice(0, 300) : "",
    radiusKm:
      source.radiusKm !== "" &&
      source.radiusKm != null &&
      Number.isFinite(radius) &&
      radius >= 1 &&
      radius <= 500
        ? radius
        : undefined,
    priorities:
      typeof source.priorities === "string"
        ? source.priorities.slice(0, 2000)
        : "",
  };
}

const profileComplete = (profile) =>
  Boolean(profile.description.trim() && profile.location.trim());

function safeUrl(value) {
  if (typeof value !== "string" || value.length > 3000) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function validSources(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 20).flatMap((source) => {
    const url = safeUrl(source?.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [
      {
        url,
        title:
          typeof source.title === "string" && source.title.trim()
            ? source.title.trim().slice(0, 200)
            : new URL(url).hostname,
      },
    ];
  });
}

function validRecommendations(value, data) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((recommendation) => {
    const url = safeUrl(recommendation?.url);
    if (
      !url ||
      typeof recommendation.name !== "string" ||
      !recommendation.name.trim()
    )
      return [];
    const result = {
      name: recommendation.name.trim().slice(0, 160),
      category:
        typeof recommendation.category === "string"
          ? recommendation.category.slice(0, 100)
          : "Fornecedor",
      location:
        typeof recommendation.location === "string"
          ? recommendation.location.slice(0, 250)
          : "",
      description:
        typeof recommendation.description === "string"
          ? recommendation.description.slice(0, 1500)
          : "",
      url,
    };
    if (
      typeof recommendation.categoryId === "string" &&
      data.categories.some(
        (category) => category.id === recommendation.categoryId,
      )
    )
      result.categoryId = recommendation.categoryId;
    if (typeof recommendation.phone === "string")
      result.phone = recommendation.phone.slice(0, 60);
    if (
      typeof recommendation.price === "number" &&
      Number.isFinite(recommendation.price) &&
      recommendation.price >= 0
    )
      result.price = recommendation.price;
    return [result];
  });
}

function normalizeProposal(value, data) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim().slice(0, 90)
        : "Sugestão do assistente",
    description:
      typeof value.description === "string"
        ? value.description.slice(0, 1000)
        : "",
    selections: validSelections(value.selections, data),
  };
}

function linkify(value) {
  const text = String(value ?? "");
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let output = "",
    cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0].replace(/[),.!?;:]+$/, "");
    const url = safeUrl(raw);
    output += escape(text.slice(cursor, match.index));
    output += url
      ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(raw)}</a>`
      : escape(raw);
    cursor = match.index + raw.length;
  }
  return output + escape(text.slice(cursor));
}

function normalizeHistory(value, data) {
  if (!value || value.version !== 1 || !Array.isArray(value.threads))
    return { threads: [], activeId: "" };
  const threadIds = new Set();
  const threads = value.threads.slice(-MAX_THREADS).flatMap((thread) => {
    if (
      !thread ||
      typeof thread.id !== "string" ||
      !thread.id ||
      !Array.isArray(thread.messages)
    )
      return [];
    const threadId = /^[a-zA-Z0-9_-]{1,100}$/.test(thread.id)
      ? thread.id
      : uid();
    if (threadIds.has(threadId)) return [];
    threadIds.add(threadId);
    const messageIds = new Set();
    const messages = thread.messages.slice(-MAX_MESSAGES).flatMap((entry) => {
      if (
        !entry ||
        !["user", "assistant"].includes(entry.role) ||
        typeof entry.content !== "string" ||
        !entry.content.trim()
      )
        return [];
      const id =
        typeof entry.id === "string" &&
        /^[a-zA-Z0-9_-]{1,100}$/.test(entry.id) &&
        !messageIds.has(entry.id)
          ? entry.id
          : uid();
      messageIds.add(id);
      const message = {
        id,
        role: entry.role,
        content: entry.content.slice(0, entry.role === "user" ? 6000 : 20000),
        failed: Boolean(entry.failed),
      };
      if (entry.role === "assistant") {
        message.provider =
          entry.provider === "DeepSeek" ? "DeepSeek" : "Gemini";
        message.sources = validSources(entry.sources);
        message.links = validSources(entry.links);
        message.recommendations = validRecommendations(
          entry.recommendations,
          data,
        );
        const proposal = normalizeProposal(entry.proposal, data);
        if (proposal) message.proposal = proposal;
        // Provider HTML is deliberately kept out of persistent history.
      }
      return [message];
    });
    return [
      {
        id: threadId,
        title:
          typeof thread.title === "string"
            ? thread.title.slice(0, 80)
            : "Conversa",
        updatedAt:
          typeof thread.updatedAt === "string"
            ? thread.updatedAt.slice(0, 30)
            : "",
        messages,
      },
    ];
  });
  return {
    threads,
    activeId: threads.some((thread) => thread.id === value.activeId)
      ? value.activeId
      : threads.at(-1)?.id || "",
  };
}

function validSelections(value, data) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    data.categories.flatMap((category) => {
      const id = value[category.id];
      return typeof id === "string" &&
        data.suppliers.some(
          (supplier) =>
            supplier.id === id && supplier.categoryId === category.id,
        )
        ? [[category.id, id]]
        : [];
    }),
  );
}

function signature(proposal) {
  return JSON.stringify([
    proposal.name.trim(),
    proposal.description.trim(),
    Object.entries(proposal.selections).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

// Compare refreshed credentials without keeping a second copy of the API key.
function configToken(config) {
  let hash = 2166136261;
  for (const character of `${config.apiKey || ""}\0${config.searchApiKey || ""}`)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${config.provider}:${config.model}:${config.apiKey?.length || 0}:${hash >>> 0}`;
}

/** Native DOM chat workspace. The owner supplies current data/config and controls persistence. */
export function mountAssistant(
  container,
  {
    getData,
    getConfig,
    onOpenSettings,
    onSaveScenario,
    onSaveProfile = () => {},
    onAddSupplier,
  },
) {
  const prefix = `assistant-${uid()}`;
  let restored = { threads: [], activeId: "" };
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (raw && raw.length <= 1500000)
      restored = normalizeHistory(JSON.parse(raw), getData());
  } catch {
    /* A blocked or malformed history does not prevent planning. */
  }
  let threads = restored.threads;
  let activeThreadId = restored.activeId || uid();
  let messages =
    threads.find((thread) => thread.id === activeThreadId)?.messages || [];
  let draft = "";
  let isLoading = false;
  let error = "";
  const saveErrors = new Map();
  let lastRequest = null;
  let activeRequest = null;
  let destroyed = false;
  let lastConfigToken = configToken(getConfig());
  let profile = normalizeProfile(getData().planningProfile);
  let profileDraft = { ...profile, radiusKm: profile.radiusKm ?? "" };
  let profileEditing = !profileComplete(profile);
  let profileError = "";
  let storedProfileToken = JSON.stringify(profile);
  let searchEnabled = true;
  let persistTimer = null;
  let historyError = "";
  const historyPrivateValues = new Set(
    [
      getConfig().apiKey,
      getConfig().searchApiKey,
      ...(getData().guestsList || []).flatMap((guest) => [
        guest.phone,
        guest.email,
      ]),
    ].filter((value) => typeof value === "string" && value.length >= 4),
  );
  const savedSignatures = new Set();

  const isConnected = () => Boolean(getConfig().apiKey?.trim());
  const providerName = () =>
    getConfig().provider === "deepseek" ? "DeepSeek" : "Gemini";
  const searchReady = () =>
    !searchEnabled ||
    getConfig().provider !== "deepseek" ||
    Boolean(getConfig().searchApiKey?.trim());
  const canSend = () =>
    isConnected() &&
    searchReady() &&
    profileComplete(profile) &&
    !profileEditing &&
    !isLoading;
  const currentProposal = (messageId) => {
    const proposal = messages.find(
      (message) => message.id === messageId,
    )?.proposal;
    return proposal
      ? {
          ...proposal,
          selections: validSelections(proposal.selections, getData()),
        }
      : null;
  };
  const isSaved = (current) =>
    Boolean(
      current &&
        (savedSignatures.has(signature(current)) ||
          getData().scenarios.some(
            (scenario) =>
              signature({
                ...scenario,
                selections: validSelections(scenario.selections, getData()),
              }) === signature(current),
          )),
    );

  function persistHistory() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    const config = getConfig();
    for (const value of [
      config.apiKey,
      config.searchApiKey,
      ...(getData().guestsList || []).flatMap((guest) => [
        guest.phone,
        guest.email,
      ]),
    ]) {
      if (typeof value === "string" && value.length >= 4)
        historyPrivateValues.add(value);
    }
    const redact = (value) =>
      [...historyPrivateValues].reduce(
        (text, secret) => text.split(secret).join("[dado privado omitido]"),
        value,
      );
    const cleanMessages =
      normalizeHistory(
        { version: 1, threads: [{ id: activeThreadId, title: "", messages }] },
        getData(),
      ).threads[0]?.messages || [];
    const current = {
      id: activeThreadId,
      title: (
        messages.find((message) => message.role === "user")?.content ||
        "Nova conversa"
      ).slice(0, 60),
      updatedAt: new Date().toISOString(),
      messages: cleanMessages,
    };
    threads = [
      ...threads.filter((thread) => thread.id !== activeThreadId),
      current,
    ].slice(-MAX_THREADS);
    try {
      let snapshot = JSON.parse(
        JSON.stringify(
          { version: 1, activeId: activeThreadId, threads },
          (_key, value) => (typeof value === "string" ? redact(value) : value),
        ),
      );
      let serialized = JSON.stringify(snapshot);
      while (serialized.length > 1000000 && snapshot.threads.length > 1) {
        snapshot.threads.shift();
        serialized = JSON.stringify(snapshot);
      }
      while (
        serialized.length > 1000000 &&
        snapshot.threads[0]?.messages.length > 1
      ) {
        snapshot.threads[0].messages.shift();
        serialized = JSON.stringify(snapshot);
      }
      window.localStorage.setItem(HISTORY_KEY, serialized);
      threads = snapshot.threads;
      historyError = "";
    } catch {
      historyError =
        "O navegador não permitiu guardar esta conversa. Ela continua disponível enquanto esta tela estiver aberta.";
    }
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistHistory, 250);
  }

  function historyMarkup() {
    const choices = [...threads];
    if (!choices.some((thread) => thread.id === activeThreadId))
      choices.push({ id: activeThreadId, title: "Nova conversa" });
    return `<div class="assistant-history-toolbar"><div><label for="${prefix}-history">Histórico de conversas</label><select id="${prefix}-history" data-assistant-field="history" data-assistant-focus="history">${choices.map((thread) => `<option value="${escape(thread.id)}"${thread.id === activeThreadId ? " selected" : ""}>${escape(thread.title || "Nova conversa")}</option>`).join("")}</select></div><button class="assistant-secondary-button" type="button" data-assistant-action="new-conversation">${icon("message", 16)}Nova conversa</button></div>${historyError ? `<p class="assistant-history-notice" role="status">${escape(historyError)}</p>` : ""}`;
  }

  function changeConversation(id) {
    if (id === activeThreadId) return;
    abortPending();
    if (
      messages.length ||
      threads.some((thread) => thread.id === activeThreadId)
    )
      persistHistory();
    const existing = threads.find((thread) => thread.id === id);
    activeThreadId = existing?.id || uid();
    messages = existing
      ? normalizeHistory(
          { version: 1, threads: [existing], activeId: existing.id },
          getData(),
        ).threads[0].messages
      : [];
    draft = "";
    error = "";
    lastRequest = null;
    restoreUnansweredTurn();
    if (existing) persistHistory();
    render();
  }

  function restoreUnansweredTurn() {
    const last = messages.at(-1);
    if (last?.role !== "user") return;
    messages = messages.map((message) =>
      message.id === last.id ? { ...message, failed: true } : message,
    );
    lastRequest = messages.filter(
      (message) => !message.failed || message.id === last.id,
    );
    error =
      "Esta pergunta ficou sem resposta. Tente novamente para continuar a conversa.";
  }

  function focusSnapshot() {
    const active = document.activeElement;
    const field = container.contains(active)
      ? active?.dataset?.assistantFocus
      : "";
    return {
      field,
      start:
        typeof active?.selectionStart === "number"
          ? active.selectionStart
          : null,
      end:
        typeof active?.selectionEnd === "number" ? active.selectionEnd : null,
      scroll:
        container.querySelector(".assistant-conversation")?.scrollTop || 0,
    };
  }

  function restoreFocus(snapshot) {
    if (!snapshot.field) return;
    const field = [
      ...container.querySelectorAll("[data-assistant-focus]"),
    ].find((element) => element.dataset.assistantFocus === snapshot.field);
    if (!field || field.disabled) return;
    field.focus({ preventScroll: true });
    if (
      snapshot.start !== null &&
      typeof field.setSelectionRange === "function"
    ) {
      field.setSelectionRange(
        Math.min(snapshot.start, field.value.length),
        Math.min(snapshot.end, field.value.length),
      );
    }
  }

  function profileMarkup() {
    const canCancel = profileComplete(profile);
    return `<div class="assistant-briefing">
      <span class="assistant-briefing-badge">${icon("heart", 16)} PRIMEIRO, O CASAMENTO DE VOCÊS</span>
      <h2>O que vocês estão imaginando?</h2>
      <p>Conte o estilo do casamento e onde querem celebrar. Assim, a busca considera a região e o que faz diferença para vocês.</p>
      <form class="assistant-profile-form" data-assistant-form="profile">
        <div class="assistant-field"><label for="${prefix}-brief-description">Como vocês imaginam o casamento?</label><textarea id="${prefix}-brief-description" data-assistant-profile="description" data-assistant-focus="profile-description" rows="3" maxlength="3000" placeholder="Ex.: cerimônia ao ar livre, clima intimista, almoço para 80 pessoas e festa com banda." required>${escape(profileDraft.description)}</textarea></div>
        <div class="assistant-profile-grid"><div class="assistant-field"><label for="${prefix}-brief-location">Cidade, região ou locais desejados</label><input id="${prefix}-brief-location" data-assistant-profile="location" data-assistant-focus="profile-location" value="${escape(profileDraft.location)}" maxlength="300" placeholder="Ex.: Campinas e cidades próximas, SP" required></div>
        <div class="assistant-field"><label for="${prefix}-brief-radius">Raio de busca em km <span>opcional</span></label><input id="${prefix}-brief-radius" type="number" min="1" max="500" step="1" data-assistant-profile="radiusKm" data-assistant-focus="profile-radius" value="${escape(profileDraft.radiusKm)}" placeholder="Ex.: 50"></div></div>
        <div class="assistant-field"><label for="${prefix}-brief-priorities">Prioridades e escolhas dos sonhos <span>opcional</span></label><textarea id="${prefix}-brief-priorities" data-assistant-profile="priorities" data-assistant-focus="profile-priorities" rows="2" maxlength="2000" placeholder="Ex.: não abrimos mão de fotos bonitas e boa comida; podemos economizar em decoração e lembrancinhas.">${escape(profileDraft.priorities)}</textarea></div>
        ${profileError ? `<p class="assistant-profile-error" role="alert">${escape(profileError)}</p>` : ""}
        <div class="assistant-profile-actions">${canCancel ? '<button class="assistant-secondary-button" type="button" data-assistant-action="cancel-profile">Cancelar</button>' : ""}<button class="assistant-configure-button" type="submit">${icon("check", 16)}${canCancel ? "Salvar briefing" : "Salvar e continuar"}</button></div>
      </form>
    </div>`;
  }

  function researchMarkup(message) {
    const recommendations = message.recommendations || [];
    const sources = message.sources || [];
    const links = message.links || [];
    const searchUrl = (query) =>
      `https://www.google.com/search?${new URLSearchParams({ q: query })}`;
    const publicPhone = (phone) => {
      const digits = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
      return digits.length >= 6 && digits.length <= 20
        ? `${phone.trim().startsWith("+") ? "+" : ""}${digits}`
        : "";
    };
    return `${
      recommendations.length
        ? `<div class="assistant-recommendations" aria-label="Fornecedores encontrados">${recommendations
            .map(
              (
                recommendation,
                index,
              ) => `<article class="assistant-recommendation">
      <span class="assistant-recommendation-category">${escape(recommendation.category || "Fornecedor")}</span><h3>${escape(recommendation.name)}</h3>
      ${recommendation.location ? `<p class="assistant-recommendation-location">${icon("map", 14)}${escape(recommendation.location)}</p>` : ""}
      ${recommendation.description ? `<p class="assistant-recommendation-description">${escape(recommendation.description)}</p>` : ""}
      ${publicPhone(recommendation.phone) ? `<a class="assistant-recommendation-phone" href="tel:${escape(publicPhone(recommendation.phone))}">${escape(recommendation.phone)}</a>` : ""}
      <div class="assistant-recommendation-price"><strong>${typeof recommendation.price === "number" ? escape(money.format(recommendation.price)) : "Cotação a consultar"}</strong>${typeof recommendation.price === "number" ? "<span>Preço público; confirme condições e o que está incluído.</span>" : "<span>Solicite um orçamento para a data e o número de convidados.</span>"}</div>
      <div class="assistant-recommendation-actions"><a href="${escape(recommendation.url)}" target="_blank" rel="noopener noreferrer">Ver fonte ${icon("arrow", 14)}</a>${typeof onAddSupplier === "function" ? `<button type="button" class="assistant-add-supplier-button" data-assistant-action="add-recommendation" data-assistant-message="${escape(message.id)}" data-assistant-recommendation="${index}">Adicionar ao kanban</button>` : ""}</div>
      <div class="assistant-search-shortcuts"><a href="${escape(searchUrl(`${recommendation.name} ${recommendation.location || profile.location}`))}" target="_blank" rel="noopener noreferrer">Pesquisar no Google ${icon("arrow", 12)}</a><a href="${escape(searchUrl(`site:instagram.com ${recommendation.name} ${recommendation.location || profile.location}`))}" target="_blank" rel="noopener noreferrer">Pesquisar perfis no Instagram pelo Google ${icon("arrow", 12)}</a></div>
    </article>`,
            )
            .join("")}</div>`
        : ""
    }${links.length ? `<div class="assistant-sources assistant-useful-links"><h3>Links úteis</h3><ul>${links.map((link) => `<li><a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.title)} ${icon("arrow", 12)}</a></li>`).join("")}</ul></div>` : ""}${sources.length ? `<div class="assistant-sources"><h3>Fontes desta resposta</h3><ol>${sources.map((source) => `<li><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)} ${icon("arrow", 12)}</a></li>`).join("")}</ol></div>` : ""}${message.searchSuggestionsHtml ? `<iframe class="assistant-google-suggestions" title="Sugestões de pesquisa Google" sandbox="" referrerpolicy="no-referrer" loading="lazy" srcdoc="${escape(message.searchSuggestionsHtml)}"></iframe>` : ""}`;
  }

  function searchMarkup() {
    const deepseek = getConfig().provider === "deepseek";
    return `<div class="assistant-search-controls"><label class="assistant-search-toggle" for="${prefix}-search"><input id="${prefix}-search" type="checkbox" data-assistant-field="search" data-assistant-focus="search"${searchEnabled ? " checked" : ""}${isLoading ? " disabled" : ""}><span>${icon("search", 16)}Buscar fornecedores na web</span></label>
      <p>${searchEnabled ? (deepseek ? "A busca usa Tavily com a chave de busca configurada para o DeepSeek." : "A busca usa o Google Search com sua chave do Gemini e apresenta as fontes encontradas.") : "Busca desligada: a IA pode ajudar a comparar as opções cadastradas e planejar o orçamento."}</p></div>`;
  }

  function requestContext() {
    const data = getData();
    return {
      wedding: {
        budget: data.wedding.budget,
        guests: data.wedding.guests,
        date: data.wedding.date,
      },
      categories: data.categories.map(({ id, name }) => ({ id, name })),
      suppliers: data.suppliers.map(
        ({ id, categoryId, name, price, favorite, rating, notes }) => ({
          id,
          categoryId,
          name,
          price,
          favorite,
          rating,
          notes,
        }),
      ),
      scenarios: data.scenarios.map(
        ({ id, name, description, selections, source }) => ({
          id,
          name,
          description,
          selections,
          source,
        }),
      ),
      profile: { ...profile },
    };
  }

  function contextMarkup() {
    const data = getData();
    return `<div class="assistant-context">
      <h2>Seus dados</h2>
      <p>${profileComplete(profile) ? `${escape(profile.location)}${profile.radiusKm ? ` · até ${escape(profile.radiusKm)} km` : ""}` : "Preencha o briefing para procurar fornecedores na região desejada."}</p>
      ${profileComplete(profile) ? `<div class="assistant-profile-summary"><p>${escape(profile.description)}</p>${profile.priorities ? `<p><strong>Prioridades:</strong> ${escape(profile.priorities)}</p>` : ""}<button type="button" class="assistant-secondary-button" data-assistant-action="edit-profile">${icon("edit", 14)}Editar briefing</button></div>` : ""}
      <div class="assistant-context-budget"><span>Orçamento planejado</span><strong>${data.wedding.budget > 0 ? escape(money.format(data.wedding.budget)) : "Ainda não definido"}</strong></div>
      <div class="assistant-context-stats"><div><strong>${String(data.categories.length).padStart(2, "0")}</strong><span>categorias para planejar</span></div><div><strong>${String(data.suppliers.length).padStart(2, "0")}</strong><span>opções para combinar</span></div></div>
      <div class="assistant-context-note">${icon("lightbulb", 14)}<p>Podemos priorizar uma ou duas escolhas dos sonhos e buscar opções mais econômicas nas demais categorias, conforme o que importa para vocês.</p></div>
    </div>`;
  }

  function proposalMarkup(message) {
    const current = currentProposal(message.id);
    if (!current) return "";
    const data = getData();
    const proposalId = `${prefix}-${message.id}`;
    const total = scenarioTotal(
      { ...current, id: "ai-draft", createdAt: "", source: "ai" },
      data.suppliers,
    );
    const selectedCount = Object.keys(current.selections).length;
    const missingCount = data.categories.length - selectedCount;
    const overBudget = data.wedding.budget > 0 && total > data.wedding.budget;
    return `<div class="assistant-proposal assistant-inline-proposal" data-assistant-proposal="${escape(message.id)}">
      <span class="assistant-proposal-badge">${icon("sparkles", 16)} SUGESTÃO DA IA</span><h2>Orçamento sugerido</h2><p class="assistant-proposal-intro">Troque os fornecedores para ajustar o total e salve quando quiser.</p>
      <div class="assistant-proposal-fields"><div class="assistant-field"><label for="${escape(proposalId)}-name">Nome do orçamento</label><input id="${escape(proposalId)}-name" data-assistant-message="${escape(message.id)}" data-assistant-field="proposal-name" data-assistant-focus="proposal-name:${escape(message.id)}" value="${escape(current.name)}" maxlength="90"></div>
      <div class="assistant-field"><label for="${escape(proposalId)}-description">Sobre esta combinação</label><textarea id="${escape(proposalId)}-description" data-assistant-message="${escape(message.id)}" data-assistant-field="proposal-description" data-assistant-focus="proposal-description:${escape(message.id)}" rows="2" maxlength="1000">${escape(current.description)}</textarea></div></div>
      <div class="assistant-selections">${
        data.categories
          .map((category, index) => {
            const options = data.suppliers.filter(
              (supplier) => supplier.categoryId === category.id,
            );
            const selection = current.selections[category.id] || "";
            const selected = options.find(
              (supplier) => supplier.id === selection,
            );
            return `<div class="assistant-selection" style="${escape(categoryColors(index))}"><div class="assistant-selection-top"><label class="assistant-selection-label" for="${escape(proposalId)}-category-${index}">${escape(category.name)}</label></div>
          <div class="assistant-inline-supplier"><strong>${selected ? escape(selected.name) : "Escolha um fornecedor"}</strong><p>${selected?.notes ? escape(selected.notes.slice(0, 180)) : selected ? "Opção cadastrada no seu kanban." : "Esta categoria ainda não está no total."}</p>${selected ? `<span class="assistant-selection-price">${escape(money.format(selected.price))}</span>` : ""}</div>
          <div class="assistant-select-wrap"><select id="${escape(proposalId)}-category-${index}" data-assistant-message="${escape(message.id)}" data-assistant-category="${escape(category.id)}" data-assistant-focus="selection:${escape(message.id)}:${escape(category.id)}"${options.length ? "" : " disabled"}><option value="">${options.length ? "Escolher uma opção" : "Nenhuma opção cadastrada"}</option>${options.map((supplier) => `<option value="${escape(supplier.id)}"${selection === supplier.id ? " selected" : ""}>${supplier.favorite ? "★ " : ""}${escape(supplier.name)} · ${escape(money.format(supplier.price))}</option>`).join("")}</select>${icon("down", 13)}</div></div>`;
          })
          .join("") ||
        '<p class="assistant-empty-categories">Cadastre categorias e fornecedores para montar um orçamento.</p>'
      }</div>
      <div class="assistant-proposal-total"><span>Total da combinação</span><strong>${escape(money.format(total))}</strong></div>
      ${missingCount > 0 ? `<p class="assistant-proposal-warning">${icon("alert", 12)}${missingCount} ${missingCount === 1 ? "categoria ainda sem escolha. O total é parcial." : "categorias ainda sem escolha. O total é parcial."}</p>` : ""}
      ${overBudget ? `<p class="assistant-proposal-warning">${icon("alert", 12)}${escape(money.format(total - data.wedding.budget))} acima do orçamento planejado.</p>` : ""}
      ${!overBudget && data.wedding.budget > 0 && selectedCount > 0 ? `<p class="assistant-proposal-warning is-within-budget">${icon("check", 12)}${escape(money.format(data.wedding.budget - total))} disponíveis no orçamento${missingCount > 0 ? " antes de completar as escolhas" : ""}.</p>` : ""}
      <div data-assistant-save-feedback="${escape(message.id)}">${saveFeedbackMarkup(message.id)}</div>
    </div>`;
  }

  function saveFeedbackMarkup(messageId) {
    const current = currentProposal(messageId);
    if (!current) return "";
    const saved = isSaved(current);
    const disabled =
      saved ||
      !current.name.trim() ||
      Object.keys(current.selections).length === 0;
    return `${saveErrors.get(messageId) ? `<p class="assistant-save-error" role="alert">${escape(saveErrors.get(messageId))}</p>` : ""}<button class="assistant-save-button" type="button" data-assistant-action="save" data-assistant-message="${escape(messageId)}"${disabled ? " disabled" : ""}>${icon("check", 18)}${saved ? "Orçamento salvo" : "Salvar orçamento"}</button><p class="assistant-save-note">${saved ? "Edite para salvar outra versão." : "Ele aparecerá na aba Orçamentos salvos."}</p>`;
  }

  function updateSaveFeedback(messageId) {
    const feedback = [
      ...container.querySelectorAll("[data-assistant-save-feedback]"),
    ].find((element) => element.dataset.assistantSaveFeedback === messageId);
    if (feedback) feedback.innerHTML = saveFeedbackMarkup(messageId);
  }

  function render({ scrollToBottom = false } = {}) {
    if (destroyed) return;
    const snapshot = focusSnapshot();
    const config = getConfig();
    const connected = isConnected();
    container.innerHTML = `<section class="assistant-workspace ${profileEditing ? "is-briefing" : "is-chatting"}" aria-labelledby="${prefix}-heading">
      <div class="assistant-heading"><div><h1 id="${prefix}-heading">Vamos planejar o casamento de vocês?</h1><p class="assistant-heading-copy">Busque fornecedores na região desejada, compare possibilidades e encontre espaço para as escolhas dos sonhos.</p></div>
      <div class="assistant-heading-actions">${profileComplete(profile) && !profileEditing ? `<button class="assistant-secondary-button" type="button" data-assistant-action="edit-profile">${icon("edit", 14)}Editar briefing</button>` : ""}<button class="assistant-provider-button" type="button" data-assistant-action="settings" aria-label="Configurar inteligência artificial. Provedor atual: ${providerName()}"><span class="assistant-provider-dot${connected ? " is-connected" : ""}" aria-hidden="true"></span>${providerName()}${icon("settings", 13)}</button></div></div>
      ${historyMarkup()}
      <div class="assistant-columns"><div class="assistant-chat-panel${!connected || !searchReady() ? " needs-configuration" : ""}">${
        profileEditing
          ? profileMarkup()
          : `<div class="assistant-chat-toolbar"><span class="assistant-chat-title">${icon("map", 16)}${escape(profile.location)}${profile.radiusKm ? ` · ${escape(profile.radiusKm)} km` : ""}</span><span class="assistant-model" title="${escape(config.model)}">${escape(config.model || "Escolha um modelo")}</span></div>
      ${searchMarkup()}
      <div class="assistant-conversation" role="log" aria-label="Conversa com o assistente" aria-live="polite" aria-relevant="additions">
      ${messages.length ? "" : `<div class="assistant-welcome"><h2>Como posso ajudar?</h2><p>Escolha um pedido abaixo ou escreva sua mensagem.</p><div class="assistant-prompts" aria-label="Sugestões para começar">${prompts.map((prompt, index) => `<button class="assistant-prompt" type="button" data-assistant-action="prompt" data-assistant-prompt="${index}"${isLoading ? " disabled" : ""}>${icon(prompt.icon, 17)}<span><strong>${prompt.text}</strong><small>${prompt.description}</small></span>${icon("arrow", 14)}</button>`).join("")}</div></div>`}
      ${messages.map((message) => `<div class="assistant-message${message.role === "user" ? " is-user" : ""}" data-assistant-chat-message="${escape(message.id)}"><span class="assistant-avatar" aria-hidden="true">${message.role === "user" ? "Você" : icon("sparkles", 13)}</span><div class="assistant-message-body"><span class="assistant-message-label">${message.role === "user" ? `Você${message.failed ? " · sem resposta" : ""}` : `Assistente · ${escape(message.provider || providerName())}`}</span><p class="assistant-message-content">${linkify(message.content)}</p>${message.role === "assistant" ? proposalMarkup(message) + researchMarkup(message) : ""}</div></div>`).join("")}
      ${isLoading ? `<div class="assistant-message" role="status"><span class="assistant-avatar" aria-hidden="true">${icon("sparkles", 13)}</span><span class="assistant-thinking">${icon("loader", 13, true)}${searchEnabled ? "Pesquisando fornecedores e conferindo as fontes…" : "Pensando nas melhores combinações…"}</span></div>` : ""}
      ${error ? `<div class="assistant-error" role="alert"><div class="assistant-error-copy">${icon("alert", 15)}<p>${escape(error)}</p></div>${lastRequest ? `<button class="assistant-retry-button" type="button" data-assistant-action="retry"${isLoading ? " disabled" : ""}>${icon("retry", 12)}Tentar novamente</button>` : ""}</div>` : ""}</div>
      ${connected ? "" : `<div class="assistant-key-callout">${icon("key", 18)}<div><strong>Conecte sua inteligência artificial</strong><p>Adicione sua chave do Gemini ou DeepSeek para conversar e receber orçamentos que você pode editar antes de salvar.</p><button class="assistant-configure-button" type="button" data-assistant-action="settings">Configurar minha IA${icon("arrow", 12)}</button></div></div>`}
      ${connected && !searchReady() ? `<div class="assistant-key-callout assistant-search-key-callout">${icon("search", 18)}<div><strong>Conecte a busca do DeepSeek</strong><p>Adicione uma chave Tavily nas configurações ou desligue a busca para conversar sobre os fornecedores já cadastrados.</p><button class="assistant-configure-button" type="button" data-assistant-action="settings">Configurar busca</button></div></div>` : ""}
      <div class="assistant-composer-wrap"><form class="assistant-composer" data-assistant-form="chat"><label class="assistant-sr-only" for="${prefix}-message">Sua mensagem para o assistente</label><textarea id="${prefix}-message" data-assistant-field="draft" data-assistant-focus="draft" rows="1" maxlength="6000" placeholder="Sua mensagem..."${isLoading ? " disabled" : ""}>${escape(draft)}</textarea><button class="assistant-send-button" type="submit" aria-label="Enviar mensagem"${!draft.trim() || !canSend() ? " disabled" : ""}>${icon(isLoading ? "loader" : "up", 18, isLoading)}</button></form><p class="assistant-composer-caption">Enter para enviar · Shift + Enter para uma nova linha. Valores públicos precisam de confirmação com o fornecedor.</p></div>
      `
      }</div><aside class="assistant-sidebar" aria-label="Contexto do planejamento">${contextMarkup()}</aside></div></section>`;
    resizeComposer();
    const conversation = container.querySelector(".assistant-conversation");
    if (conversation) {
      conversation.scrollTop = scrollToBottom
        ? conversation.scrollHeight
        : snapshot.scroll;
    }
    restoreFocus(snapshot);
  }

  function resizeComposer() {
    const textarea = container.querySelector('[data-assistant-field="draft"]');
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(44, Math.min(160, textarea.scrollHeight))}px`;
  }

  async function requestReply(conversation) {
    if (destroyed || activeRequest) return;
    if (!profileComplete(profile) || profileEditing) {
      profileEditing = true;
      render();
      return;
    }
    const config = getConfig();
    if (!config.apiKey?.trim() || !searchReady()) {
      onOpenSettings();
      return;
    }
    const controller = new AbortController();
    activeRequest = controller;
    lastRequest = conversation;
    isLoading = true;
    error = "";
    persistHistory();
    render({ scrollToBottom: true });
    const lastUserId = [...conversation]
      .reverse()
      .find((message) => message.role === "user")?.id;
    const requestProvider = providerName();
    const requestedSearch = searchEnabled;
    try {
      const response = await aiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          provider: config.provider,
          apiKey: config.apiKey.trim(),
          model: config.model,
          searchEnabled: requestedSearch,
          ...(requestedSearch &&
          config.provider === "deepseek" &&
          config.searchApiKey?.trim()
            ? { searchApiKey: config.searchApiKey.trim() }
            : {}),
          messages: conversation
            .slice(-20)
            .map(({ role, content }) => ({ role, content })),
          context: requestContext(),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "Não foi possível conversar com a IA agora. Confira sua conexão e tente novamente.",
        );
      if (
        !result ||
        typeof result.message !== "string" ||
        !result.message.trim()
      )
        throw new Error(
          "A IA retornou uma resposta vazia. Tente enviar sua mensagem novamente.",
        );
      if (
        destroyed ||
        controller.signal.aborted ||
        activeRequest !== controller
      )
        return;
      messages = messages.map((message) =>
        message.id === lastUserId ? { ...message, failed: false } : message,
      );
      const reply = {
        id: uid(),
        role: "assistant",
        content: result.message,
        provider: requestProvider,
        sources: requestedSearch ? validSources(result.sources) : [],
        links: validSources(result.links),
        recommendations: requestedSearch
          ? validRecommendations(result.recommendations, getData())
          : [],
        ...(requestedSearch &&
        config.provider === "gemini" &&
        typeof result.searchSuggestionsHtml === "string" &&
        result.searchSuggestionsHtml.length <= 60000
          ? { searchSuggestionsHtml: result.searchSuggestionsHtml }
          : {}),
      };
      const suggested = normalizeProposal(result.proposal, getData());
      if (suggested) reply.proposal = suggested;
      messages.push(reply);
      messages = messages.slice(-MAX_MESSAGES);
      lastRequest = null;
      persistHistory();
    } catch (requestError) {
      if (
        destroyed ||
        controller.signal.aborted ||
        activeRequest !== controller
      )
        return;
      error =
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível enviar sua mensagem. Tente novamente.";
      messages = messages.map((message) =>
        message.id === lastUserId ? { ...message, failed: true } : message,
      );
      persistHistory();
    } finally {
      if (!destroyed && activeRequest === controller) {
        activeRequest = null;
        isLoading = false;
        render({ scrollToBottom: true });
      }
    }
  }

  function sendMessage(text = draft) {
    const content = text.trim();
    if (!content || activeRequest || destroyed) return;
    if (!profileComplete(profile) || profileEditing) {
      draft = content;
      profileEditing = true;
      render();
      return;
    }
    if (!isConnected() || !searchReady()) {
      draft = content;
      render();
      onOpenSettings();
      return;
    }
    const message = { id: uid(), role: "user", content };
    const conversation = [
      ...messages.filter((entry) => !entry.failed),
      message,
    ];
    messages = [...messages, message].slice(-MAX_MESSAGES);
    draft = "";
    void requestReply(conversation);
  }

  function abortPending(message = "") {
    if (!activeRequest) return;
    activeRequest.abort();
    activeRequest = null;
    isLoading = false;
    const lastUserId = lastRequest?.at(-1)?.id;
    messages = messages.map((entry) =>
      entry.id === lastUserId ? { ...entry, failed: true } : entry,
    );
    error = message;
    if (messages.length) persistHistory();
  }

  function saveProfile() {
    const radius =
      profileDraft.radiusKm === "" ? undefined : Number(profileDraft.radiusKm);
    const candidate = {
      description: profileDraft.description.trim(),
      location: profileDraft.location.trim(),
      priorities: profileDraft.priorities.trim(),
      radiusKm: radius,
    };
    if (!profileComplete(candidate)) {
      profileError =
        "Conte como imaginam o casamento e informe a cidade ou região desejada.";
      render();
      return;
    }
    if (
      radius !== undefined &&
      (!Number.isFinite(radius) || radius < 1 || radius > 500)
    ) {
      profileError =
        "Informe um raio entre 1 e 500 km ou deixe o campo em branco.";
      render();
      return;
    }
    try {
      onSaveProfile({ ...candidate });
      profile = candidate;
      profileDraft = { ...candidate, radiusKm: radius ?? "" };
      profileEditing = false;
      profileError = "";
      storedProfileToken = JSON.stringify(
        normalizeProfile(getData().planningProfile),
      );
      if (lastRequest)
        error =
          "Briefing salvo. Tente novamente para usar as informações atualizadas.";
      render();
    } catch {
      profileError = "Não foi possível salvar o briefing. Tente novamente.";
      render();
    }
  }

  function saveProposal(messageId) {
    const current = currentProposal(messageId);
    if (
      !current ||
      !current.name.trim() ||
      !Object.keys(current.selections).length ||
      isSaved(current)
    )
      return;
    try {
      const key = signature(current);
      onSaveScenario({
        id: uid(),
        name: current.name.trim(),
        description: current.description.trim(),
        selections: { ...current.selections },
        source: "ai",
        createdAt: new Date().toISOString(),
      });
      savedSignatures.add(key);
      saveErrors.delete(messageId);
    } catch {
      saveErrors.set(
        messageId,
        "Não foi possível salvar este orçamento. Tente novamente.",
      );
    }
    if (!destroyed) render();
  }

  function click(event) {
    const button = event.target.closest?.("[data-assistant-action]");
    if (!button || !container.contains(button) || button.disabled) return;
    switch (button.dataset.assistantAction) {
      case "settings":
        onOpenSettings();
        break;
      case "prompt": {
        const prompt = prompts[Number(button.dataset.assistantPrompt)];
        if (prompt) sendMessage(prompt.text);
        break;
      }
      case "retry":
        if (lastRequest) void requestReply(lastRequest);
        break;
      case "save":
        saveProposal(button.dataset.assistantMessage);
        break;
      case "new-conversation":
        changeConversation("");
        break;
      case "edit-profile":
        abortPending(
          "A conversa foi interrompida para editar o briefing. Tente novamente quando estiver pronto.",
        );
        profileDraft = { ...profile, radiusKm: profile.radiusKm ?? "" };
        profileEditing = true;
        profileError = "";
        render();
        break;
      case "cancel-profile":
        profileEditing = false;
        profileError = "";
        render();
        break;
      case "add-recommendation": {
        const message = messages.find(
          (entry) => entry.id === button.dataset.assistantMessage,
        );
        const recommendation =
          message?.recommendations?.[
            Number(button.dataset.assistantRecommendation)
          ];
        if (recommendation && typeof onAddSupplier === "function") {
          const valid = validRecommendations([recommendation], getData())[0];
          if (valid) {
            try {
              onAddSupplier({ ...valid });
            } catch {
              error =
                "Não foi possível preparar este fornecedor para adicionar ao kanban. Tente novamente.";
              render();
            }
          }
        }
        break;
      }
    }
  }

  function input(event) {
    const profileField = event.target.dataset?.assistantProfile;
    if (
      ["description", "location", "radiusKm", "priorities"].includes(
        profileField,
      )
    ) {
      profileDraft = { ...profileDraft, [profileField]: event.target.value };
      profileError = "";
      return;
    }
    const field = event.target.dataset?.assistantField;
    if (field === "draft") {
      draft = event.target.value;
      resizeComposer();
      const send = container.querySelector(".assistant-send-button");
      if (send) send.disabled = !draft.trim() || !canSend();
    } else if (field === "proposal-name" || field === "proposal-description") {
      const message = messages.find(
        (entry) => entry.id === event.target.dataset.assistantMessage,
      );
      if (!message?.proposal) return;
      message.proposal = {
        ...message.proposal,
        [field === "proposal-name" ? "name" : "description"]:
          event.target.value,
      };
      saveErrors.delete(message.id);
      updateSaveFeedback(message.id);
      schedulePersist();
    }
  }

  function change(event) {
    if (event.target.dataset?.assistantField === "history") {
      changeConversation(event.target.value);
      return;
    }
    if (event.target.dataset?.assistantField === "search") {
      if (!isLoading) {
        searchEnabled = event.target.checked;
        render();
      }
      return;
    }
    const categoryId = event.target.dataset?.assistantCategory;
    const message = messages.find(
      (entry) => entry.id === event.target.dataset?.assistantMessage,
    );
    if (!message?.proposal || !categoryId) return;
    const selections = { ...currentProposal(message.id).selections };
    if (event.target.value) selections[categoryId] = event.target.value;
    else delete selections[categoryId];
    message.proposal = {
      ...message.proposal,
      selections: validSelections(selections, getData()),
    };
    saveErrors.delete(message.id);
    persistHistory();
    render();
  }

  function submit(event) {
    if (event.target.dataset?.assistantForm === "profile") {
      event.preventDefault();
      saveProfile();
      return;
    }
    if (event.target.dataset?.assistantForm !== "chat") return;
    event.preventDefault();
    sendMessage();
  }

  function keydown(event) {
    if (
      event.target.dataset?.assistantField === "draft" &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      sendMessage();
    }
  }

  for (const [name, handler] of [
    ["click", click],
    ["input", input],
    ["change", change],
    ["submit", submit],
    ["keydown", keydown],
  ])
    container.addEventListener(name, handler);
  const flushHistory = () => {
    if (
      messages.length ||
      threads.some((thread) => thread.id === activeThreadId)
    )
      persistHistory();
  };
  window.addEventListener("pagehide", flushHistory);
  restoreUnansweredTurn();
  render();
  return {
    refresh() {
      if (destroyed) return;
      const nextToken = configToken(getConfig());
      if (nextToken !== lastConfigToken && activeRequest) {
        abortPending(
          "A configuração da IA mudou. Tente novamente para usar o novo modelo.",
        );
      }
      lastConfigToken = nextToken;
      const nextProfile = normalizeProfile(getData().planningProfile);
      const nextProfileToken = JSON.stringify(nextProfile);
      if (nextProfileToken !== storedProfileToken) {
        abortPending(
          "O briefing mudou. Tente novamente para usar as informações atualizadas.",
        );
        profile = nextProfile;
        if (!profileEditing)
          profileDraft = {
            ...nextProfile,
            radiusKm: nextProfile.radiusKm ?? "",
          };
        if (!profileComplete(profile)) profileEditing = true;
        storedProfileToken = nextProfileToken;
      }
      render();
    },
    destroy() {
      if (destroyed) return;
      abortPending();
      flushHistory();
      if (persistTimer) clearTimeout(persistTimer);
      window.removeEventListener("pagehide", flushHistory);
      destroyed = true;
      activeRequest?.abort();
      activeRequest = null;
      for (const [name, handler] of [
        ["click", click],
        ["input", input],
        ["change", change],
        ["submit", submit],
        ["keydown", keydown],
      ])
        container.removeEventListener(name, handler);
      container.replaceChildren();
      messages = [];
      lastRequest = null;
    },
  };
}

export default mountAssistant;

import { createEmptyData, uid } from "./lib/demo.js";
import { generateStrategies } from "./lib/budget.js";
import { loadData, saveData } from "./lib/storage.js";
import { escapeHtml as e, icon, navigationIcon } from "./ui.js";
import { renderBoard, renderSavedBudgets } from "./views.js";
import { dialogHTML } from "./dialogs.js";
import { mountAssistant } from "./components/assistant.js";
import { mountGuests } from "./guests.js";
import { aiFetch } from "./lib/ai-client.js";

const viewNames = {
  overview: "Montar orçamento",
  scenarios: "Orçamentos salvos",
  assistant: "Assistente IA",
  guests: "Convidados",
};
const emptyConfig = (provider) => ({
  provider,
  apiKey: "",
  model: "",
  searchApiKey: "",
});
const DRAFT_KEY = "weeding-calculator-draft-v1";
function cleanSelections(selections, data) {
  return Object.fromEntries(
    data.categories.flatMap((category) => {
      const supplierId = selections?.[category.id];
      return data.suppliers.some(
        (s) => s.id === supplierId && s.categoryId === category.id,
      )
        ? [[category.id, supplierId]]
        : [];
    }),
  );
}
function readSession(key, fallback) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null") || fallback;
  } catch {
    return fallback;
  }
}
function validConfig(c) {
  return (
    c &&
    ["gemini", "deepseek"].includes(c.provider) &&
    typeof c.apiKey === "string" &&
    typeof c.model === "string"
  );
}

/** Mounts the application with native DOM events; no framework or compilation required. */
export function mountApp(root) {
  if (!root)
    throw new Error("O elemento principal do aplicativo não foi encontrado.");
  const session = readSession("sim-ai-session", emptyConfig("gemini"));
  const storedProfiles = readSession("sim-ai-profiles", {});
  const state = {
    data: loadData(),
    view: "overview",
    dialog: null,
    config: validConfig(session) ? session : emptyConfig("gemini"),
    profiles: Object.fromEntries(
      ["gemini", "deepseek"]
        .filter((p) => validConfig(storedProfiles[p]))
        .map((p) => [p, storedProfiles[p]]),
    ),
    storageError: false,
    selections: {},
    draftName: "Meu orçamento",
    editingId: null,
    boardScroll: 0,
  };
  if (state.data.isDemo) {
    const first = ["local", "buffet", "vestido", "musica"];
    state.data.categories = [...state.data.categories].sort((a, b) => {
      const ia = first.indexOf(a.id),
        ib = first.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (draft && typeof draft.name === "string") {
      state.draftName = draft.name.slice(0, 100);
      state.selections = cleanSelections(draft.selections, state.data);
      state.editingId = state.data.scenarios.some(
        (s) => s.id === draft.editingId,
      )
        ? draft.editingId
        : null;
    }
  } catch {}
  if (state.config.apiKey)
    state.profiles[state.config.provider] = { ...state.config };
  const overlay = document.createElement("div");
  overlay.id = "overlay-root";
  const toastRoot = document.createElement("div");
  toastRoot.id = "toast-root";
  root.after(overlay, toastRoot);
  let assistant = null,
    assistantElement = null,
    guestsView = null,
    guestsElement = null,
    toastTimer,
    modelRequest,
    focusBeforeDialog,
    destroyed = false;
  let pointerDrag = null,
    nativeDrag = null,
    suppressClickUntil = 0,
    autoScrollFrame = null,
    scrollPointer = null;

  function rememberFocus() {
    const a = document.activeElement;
    if (a?.id)
      return { id: a.id, start: a.selectionStart, end: a.selectionEnd };
    const card = a?.closest?.(".supplier-card");
    return card && root.contains(card)
      ? {
          supplierId: card.dataset.supplierId,
          action: a === card ? null : a.dataset.action,
          selection: !!card.closest(".budget-selection-list"),
        }
      : null;
  }
  function restoreFocus(f) {
    if (!f) return;
    let a = f.id ? document.getElementById(f.id) : null;
    if (f.supplierId) {
      const scope = root.querySelector(
        f.selection ? ".budget-selection-list" : ".kanban-board",
      );
      const card = [...(scope?.querySelectorAll(".supplier-card") || [])].find(
        (c) => c.dataset.supplierId === f.supplierId,
      );
      a = f.action
        ? [...(card?.querySelectorAll("[data-action]") || [])].find(
            (c) => c.dataset.action === f.action,
          )
        : card;
    }
    if (a) {
      a.focus({ preventScroll: true });
      if (
        typeof a.setSelectionRange === "function" &&
        typeof f.start === "number"
      ) {
        try {
          a.setSelectionRange(f.start, f.end);
        } catch {}
      }
    }
  }
  function render() {
    if (destroyed) return;
    const focus = rememberFocus();
    const previousBoard = root.querySelector(".kanban-board");
    if (previousBoard) state.boardScroll = previousBoard.scrollLeft;
    const columnScroll = new Map(
      [...root.querySelectorAll(".kanban-column")].map((c) => [
        c.dataset.categoryId,
        c.scrollTop,
      ]),
    );
    const selectionScroll =
      root.querySelector(".budget-selection-list")?.scrollLeft || 0;
    const d = state.data;
    if (state.view !== "assistant" && assistant) {
      assistant.destroy();
      assistant = null;
      assistantElement = null;
    }
    if (assistantElement) assistantElement.remove();
    if (state.view !== "guests" && guestsView) {
      guestsView.destroy();
      guestsView = null;
      guestsElement = null;
    }
    if (guestsElement) guestsElement.remove();
    root.innerHTML = `<div class="reference-shell" aria-label="Weeding Calculator">
      <aside class="icon-rail"><nav class="rail-nav" aria-label="Navegação principal">
        <button type="button" class="rail-button rail-brand ${state.view === "assistant" ? "active" : ""}" data-action="view" data-view="assistant" title="Inteligência artificial" aria-label="Inteligência artificial">${navigationIcon("ai")}</button>
        <button type="button" class="rail-button ${state.view === "scenarios" ? "active" : ""}" data-action="view" data-view="scenarios" title="Orçamentos salvos" aria-label="Orçamentos salvos">${navigationIcon("saved")}</button>
        <button type="button" class="rail-button" data-action="open-strategies" title="Combinações de orçamento" aria-label="Combinações de orçamento">${navigationIcon("strategies")}</button>
        <button type="button" class="rail-button ${state.view === "guests" ? "active" : ""}" data-action="view" data-view="guests" title="Convidados" aria-label="Convidados">${navigationIcon("suppliers")}</button>
        <button type="button" class="rail-button" data-action="open-wedding" title="Dados do casamento" aria-label="Dados do casamento">${navigationIcon("wedding")}</button>
        <button type="button" class="rail-button ${state.view === "overview" ? "active" : ""}" data-action="view" data-view="overview" title="Montar orçamento" aria-label="Montar orçamento">${navigationIcon("board")}</button>
        <span class="rail-divider"></span><button type="button" class="rail-button rail-clear" data-action="request-clear-budget" title="Limpar orçamento atual" aria-label="Limpar orçamento atual">${navigationIcon("clear")}</button>
      </nav></aside>
      <main class="workspace-content">
        ${state.storageError ? '<div class="storage-warning" role="alert">Não foi possível salvar neste navegador. Confira se há espaço disponível antes de fechar.</div>' : ""}
        ${state.view === "overview" ? renderBoard(d, state) : `<section class="secondary-view">${state.view === "scenarios" ? `<div class="secondary-heading"><h1>Orçamentos salvos</h1><button type="button" class="button button-primary" data-action="new-budget">${icon("Plus", 18)} Novo orçamento</button></div>${renderSavedBudgets(d)}` : state.view === "guests" ? '<div id="guests-root"></div>' : '<div id="assistant-root"></div>'}</section>`}
      </main>
    </div>`;
    if (state.view === "assistant") {
      const target = root.querySelector("#assistant-root");
      if (assistantElement) {
        target.replaceWith(assistantElement);
        assistant.refresh();
      } else {
        assistantElement = target;
        assistant = mountAssistant(target, {
          getData: () => state.data,
          getConfig: () => state.config,
          onOpenSettings: () => openSettings("ai"),
          onSaveScenario: saveScenario,
          onSaveProfile: (profile) =>
            commit({ ...state.data, planningProfile: profile }),
          onAddSupplier: addRecommendedSupplier,
        });
      }
    }
    if (state.view === "guests") {
      const target = root.querySelector("#guests-root");
      if (guestsElement) {
        target.replaceWith(guestsElement);
        guestsView.refresh();
      } else {
        guestsElement = target;
        guestsView = mountGuests(target, {
          getData: () => state.data,
          onSaveGuests: (list) => commit({ ...state.data, guestsList: list }),
        });
      }
    }
    const board = root.querySelector(".kanban-board");
    if (board) board.scrollLeft = state.boardScroll;
    for (const column of root.querySelectorAll(".kanban-column"))
      column.scrollTop = columnScroll.get(column.dataset.categoryId) || 0;
    const selectionList = root.querySelector(".budget-selection-list");
    if (selectionList) selectionList.scrollLeft = selectionScroll;
    updateScrollFades();
    restoreFocus(focus);
  }
  function commit(next) {
    state.data = next;
    state.selections = cleanSelections(state.selections, next);
    if (!next.scenarios.some((s) => s.id === state.editingId))
      state.editingId = null;
    state.storageError = !saveData(next);
    persistDraft();
    render();
  }
  function persistDraft() {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          name: state.draftName,
          selections: state.selections,
          editingId: state.editingId,
        }),
      );
    } catch {
      state.storageError = true;
    }
  }
  function selectSupplier(id, toggle = true) {
    const supplier = state.data.suppliers.find((s) => s.id === id);
    if (!supplier) return;
    const alreadySelected = state.selections[supplier.categoryId] === id;
    state.selections = Object.fromEntries([
      ...Object.entries(state.selections).filter(
        ([categoryId]) => categoryId !== supplier.categoryId,
      ),
      ...(!toggle || !alreadySelected ? [[supplier.categoryId, id]] : []),
    ]);
    persistDraft();
    render();
  }
  function startBudget(scenario, duplicate = false) {
    state.selections = scenario
      ? cleanSelections(scenario.selections, state.data)
      : {};
    state.draftName = scenario
      ? `${scenario.name}${duplicate ? " (cópia)" : ""}`.slice(0, 100)
      : "Meu orçamento";
    state.editingId = scenario && !duplicate ? scenario.id : null;
    persistDraft();
    navigate("overview");
  }
  function saveBudget() {
    const name = state.draftName.trim();
    const selections = cleanSelections(state.selections, state.data);
    if (!name || !Object.keys(selections).length) {
      toast("Escolha um fornecedor e dê um nome ao orçamento.");
      return;
    }
    const existing = state.data.scenarios.find((s) => s.id === state.editingId);
    const scenario = {
      id: existing?.id || uid(),
      name,
      description: existing?.description || "",
      selections,
      source: existing?.source || "manual",
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    state.editingId = scenario.id;
    state.draftName = name;
    saveScenario(scenario);
  }
  function toast(message) {
    clearTimeout(toastTimer);
    toastRoot.innerHTML = `<div class="toast" role="status">${icon("CheckCircle2", 18)}<span>${e(message)}</span><button class="icon-button" data-action="close-toast" aria-label="Fechar aviso">${icon("X", 16)}</button></div>`;
    toastTimer = setTimeout(() => {
      toastRoot.innerHTML = "";
    }, 4200);
  }
  function navigate(view) {
    if (!(view in viewNames)) return;
    cleanupDrag();
    state.view = view;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function openDialog(dialog) {
    modelRequest?.abort();
    if (!state.dialog) focusBeforeDialog = document.activeElement;
    state.dialog = dialog;
    renderDialog(true);
    document.body.style.overflow = "hidden";
  }
  function renderDialog(initial = false) {
    const focus = rememberFocus();
    overlay.innerHTML = state.dialog
      ? dialogHTML(state.dialog, state.data)
      : "";
    if (initial)
      overlay
        .querySelector("input:not([type=hidden]),select,textarea,button")
        ?.focus();
    else restoreFocus(focus);
  }
  function closeDialog() {
    modelRequest?.abort();
    state.dialog = null;
    overlay.innerHTML = "";
    document.body.style.overflow = "";
    if (focusBeforeDialog?.isConnected)
      focusBeforeDialog.focus({ preventScroll: true });
  }
  function openSettings(tab = "wedding") {
    openDialog({
      type: "settings",
      tab,
      wedding: { ...state.data.wedding },
      config: { ...state.config },
      profiles: structuredClone(state.profiles),
      models: [],
      status: "idle",
      error: "",
      reveal: false,
    });
  }
  function openSupplier(id, categoryId, selectOnSave = false) {
    const existing = state.data.suppliers.find((s) => s.id === id);
    if (!state.data.categories.length) {
      openDialog({
        type: "category",
        isSaved: false,
        draft: { id: uid(), name: "", icon: "Flower2" },
        error: "",
      });
      return;
    }
    openDialog({
      type: "supplier",
      selectOnSave,
      isSaved: !!existing,
      draft: existing
        ? { ...existing }
        : {
            id: uid(),
            categoryId: categoryId || state.data.categories[0].id,
            name: "",
            price: "",
            phone: "",
            favorite: false,
            rating: 3,
            notes: "",
          },
      error: "",
    });
  }
  function saveScenario(scenario) {
    const exists = state.data.scenarios.some((s) => s.id === scenario.id);
    commit({
      ...state.data,
      scenarios: exists
        ? state.data.scenarios.map((s) => (s.id === scenario.id ? scenario : s))
        : [...state.data.scenarios, scenario],
    });
    toast("Orçamento salvo. Veja em Orçamentos salvos.");
  }
  function addRecommendedSupplier(recommendation) {
    const category =
      state.data.categories.find((c) => c.id === recommendation.categoryId) ||
      state.data.categories.find(
        (c) =>
          c.name.toLocaleLowerCase("pt-BR") ===
          String(recommendation.category || "").toLocaleLowerCase("pt-BR"),
      );
    if (!state.data.categories.length) {
      toast("Crie uma categoria antes de adicionar este fornecedor.");
      return;
    }
    const notes = [
      recommendation.description,
      recommendation.location,
      recommendation.url ? `Fonte: ${recommendation.url}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    openDialog({
      type: "supplier",
      isSaved: false,
      draft: {
        id: uid(),
        name: String(recommendation.name || ""),
        categoryId: category?.id || state.data.categories[0].id,
        price:
          Number.isFinite(recommendation.price) && recommendation.price >= 0
            ? recommendation.price
            : "",
        phone: String(recommendation.phone || ""),
        favorite: false,
        rating: 3,
        notes,
      },
      error: "",
    });
  }
  function supplierDraft(form) {
    const f = new FormData(form);
    return {
      ...state.dialog.draft,
      name: String(f.get("name") || "").trim(),
      categoryId: String(f.get("categoryId") || ""),
      price: f.get("price") === "" ? "" : Number(f.get("price")),
      phone: String(f.get("phone") || "").trim(),
      rating: Number(f.get("rating")),
      favorite: f.get("favorite") === "true",
      notes: String(f.get("notes") || "").trim(),
    };
  }
  function captureSettings() {
    const d = state.dialog;
    if (d?.type !== "settings") return;
    const form = overlay.querySelector("form");
    if (!form) return;
    const f = new FormData(form);
    if (d.tab === "wedding")
      d.wedding = {
        couple: String(f.get("couple") || ""),
        date: String(f.get("date") || ""),
        guests: Number(f.get("guests")),
        budget: Number(f.get("budget")),
      };
    else
      d.config = {
        ...d.config,
        apiKey: String(f.get("apiKey") || "").trim(),
        model: String(f.get("model") || "").trim(),
        searchApiKey: String(f.get("searchApiKey") || "").trim(),
      };
  }
  function saveAI(disconnect = false) {
    const d = state.dialog;
    captureSettings();
    const c = disconnect ? emptyConfig(d.config.provider) : d.config;
    const profiles = { ...d.profiles };
    if (disconnect) delete profiles[c.provider];
    else profiles[c.provider] = { ...c };
    state.config = { ...c };
    state.profiles = profiles;
    try {
      sessionStorage.setItem("sim-ai-profiles", JSON.stringify(profiles));
      if (c.apiKey) sessionStorage.setItem("sim-ai-session", JSON.stringify(c));
      else sessionStorage.removeItem("sim-ai-session");
    } catch {}
    closeDialog();
    assistant?.refresh();
    toast(disconnect ? "IA desconectada." : "IA configurada para esta sessão.");
  }
  async function fetchModels() {
    captureSettings();
    const d = state.dialog;
    if (d?.type !== "settings") return;
    if (!d.config.apiKey) {
      d.error = "Cole sua chave de API para conectar.";
      renderDialog();
      return;
    }
    modelRequest?.abort();
    const controller = new AbortController();
    modelRequest = controller;
    d.status = "loading";
    d.error = "";
    renderDialog();
    try {
      const res = await aiFetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: d.config.provider,
          apiKey: d.config.apiKey,
        }),
        signal: controller.signal,
      });
      const result = await res.json().catch(() => null);
      if (controller.signal.aborted || state.dialog !== d) return;
      if (!res.ok)
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "Não foi possível conectar ao provedor.",
        );
      const models = Array.isArray(result?.models)
        ? result.models.filter(
            (m) => m && typeof m.id === "string" && typeof m.name === "string",
          )
        : [];
      if (!models.length)
        throw new Error("Nenhum modelo disponível para esta chave.");
      d.models = models;
      if (!models.some((m) => m.id === d.config.model))
        d.config.model = models[0].id;
      d.status = "success";
      renderDialog();
    } catch (err) {
      if (controller.signal.aborted || state.dialog !== d) return;
      d.status = "error";
      d.error =
        err instanceof Error
          ? err.message
          : "Falha de conexão. Tente novamente.";
      renderDialog();
    }
  }
  function click(event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const a = button.dataset.action,
      id = button.dataset.id,
      d = state.dialog;
    switch (a) {
      case "view":
        navigate(button.dataset.view);
        break;
      case "open-wedding":
        openSettings();
        break;
      case "open-add-menu":
        openDialog({ type: "add-menu" });
        break;
      case "open-strategies":
        openDialog({ type: "strategies" });
        break;
      case "request-clear-budget":
        openDialog({ type: "clear-budget" });
        break;
      case "request-save-budget":
        if (Object.keys(state.selections).length)
          openDialog({
            type: "save-budget",
            draftName: state.draftName,
            editingId: state.editingId,
            error: "",
          });
        break;
      case "open-ai":
        openSettings("ai");
        break;
      case "reset":
        openDialog({ type: "reset" });
        break;
      case "reset-confirm":
        state.selections = {};
        state.draftName = "Meu orçamento";
        state.editingId = null;
        commit(createEmptyData());
        openSettings();
        toast("Um novo começo para o grande dia.");
        break;
      case "add-supplier":
        openSupplier(
          undefined,
          button.dataset.category,
          !!button.closest("[data-budget-category]"),
        );
        break;
      case "add-category":
        openDialog({
          type: "category",
          isSaved: false,
          draft: { id: uid(), name: "", icon: "Flower2" },
          error: "",
        });
        break;
      case "edit-category": {
        const category = state.data.categories.find((c) => c.id === id);
        if (category)
          openDialog({
            type: "category",
            isSaved: true,
            draft: { ...category },
            error: "",
          });
        break;
      }
      case "category-request-delete":
        openDialog({ type: "delete-category", id });
        break;
      case "select-supplier":
      case "add-selection":
        selectSupplier(id, false);
        break;
      case "drag-handle":
        break;
      case "remove-selection":
        state.selections = Object.fromEntries(
          Object.entries(state.selections).filter(
            ([categoryId]) => categoryId !== button.dataset.category,
          ),
        );
        persistDraft();
        render();
        break;
      case "clear-budget":
        state.selections = {};
        persistDraft();
        navigate("overview");
        closeDialog();
        break;
      case "new-budget":
        startBudget(null);
        break;
      case "load-budget":
      case "duplicate-budget": {
        const budget = state.data.scenarios.find((s) => s.id === id);
        if (budget) startBudget(budget, a === "duplicate-budget");
        break;
      }
      case "apply-strategy": {
        const strategy = generateStrategies(state.data).find(
          (s) => s.id === id,
        );
        if (!strategy) break;
        state.selections = { ...strategy.selections };
        state.draftName = strategy.name;
        state.editingId = null;
        persistDraft();
        navigate("overview");
        closeDialog();
        break;
      }
      case "supplier-edit":
        openSupplier(id);
        break;
      case "supplier-delete":
        openDialog({ type: "delete-supplier", id });
        break;
      case "supplier-remove":
        commit({
          ...state.data,
          suppliers: state.data.suppliers.filter((s) => s.id !== id),
          scenarios: state.data.scenarios.map((s) => ({
            ...s,
            selections: Object.fromEntries(
              Object.entries(s.selections).filter(([, v]) => v !== id),
            ),
          })),
        });
        closeDialog();
        toast("Fornecedor excluído.");
        break;
      case "toggle-favorite":
        commit({
          ...state.data,
          suppliers: state.data.suppliers.map((s) =>
            s.id === id ? { ...s, favorite: !s.favorite } : s,
          ),
        });
        break;
      case "supplier-rating":
        d.draft = supplierDraft(overlay.querySelector("form"));
        d.draft.rating = Number(button.dataset.value);
        renderDialog();
        break;
      case "supplier-favorite":
        d.draft = supplierDraft(overlay.querySelector("form"));
        d.draft.favorite = !d.draft.favorite;
        renderDialog();
        break;
      case "delete-scenario":
        openDialog({ type: "delete-scenario", id });
        break;
      case "scenario-remove":
        commit({
          ...state.data,
          scenarios: state.data.scenarios.filter((s) => s.id !== id),
        });
        closeDialog();
        toast("Orçamento excluído.");
        break;
      case "close-dialog":
        closeDialog();
        break;
      case "close-toast":
        clearTimeout(toastTimer);
        toastRoot.innerHTML = "";
        break;
      case "category-delete":
        commit({
          ...state.data,
          categories: state.data.categories.filter((c) => c.id !== id),
          suppliers: state.data.suppliers.filter((s) => s.categoryId !== id),
          scenarios: state.data.scenarios.map((s) => ({
            ...s,
            selections: Object.fromEntries(
              Object.entries(s.selections).filter(([c]) => c !== id),
            ),
          })),
        });
        closeDialog();
        break;
      case "settings-tab":
        captureSettings();
        d.tab = button.dataset.tab;
        renderDialog();
        break;
      case "ai-provider":
        captureSettings();
        modelRequest?.abort();
        d.profiles[d.config.provider] = { ...d.config };
        d.config = {
          ...(d.profiles[button.dataset.provider] ||
            emptyConfig(button.dataset.provider)),
        };
        d.models = [];
        d.status = "idle";
        d.error = "";
        renderDialog();
        break;
      case "ai-reveal":
        captureSettings();
        d.reveal = !d.reveal;
        renderDialog();
        break;
      case "ai-fetch-models":
        void fetchModels();
        break;
      case "ai-disconnect":
        saveAI(true);
        break;
    }
  }
  function input(event) {
    if (
      state.dialog?.type === "settings" &&
      state.dialog.tab === "ai" &&
      event.target.name === "apiKey"
    ) {
      captureSettings();
      modelRequest?.abort();
      state.dialog.status = "idle";
      state.dialog.models = [];
      state.dialog.error = "";
      renderDialog();
    }
  }
  function change(event) {
    const t = event.target;
    if (t.matches?.("[data-budget-choice]")) {
      const supplier = state.data.suppliers.find(
        (item) => item.id === t.value && item.categoryId === t.dataset.category,
      );
      if (supplier) {
        selectSupplier(supplier.id, false);
        const slot = [...root.querySelectorAll("[data-budget-category]")].find(
          (item) => item.dataset.budgetCategory === supplier.categoryId,
        );
        slot?.querySelector(".supplier-card")?.focus({ preventScroll: true });
      }
      return;
    }
    if (t.name === "modelSelect" && state.dialog?.type === "settings") {
      captureSettings();
      state.dialog.config.model = t.value;
      overlay.querySelector("input[name=model]").value = t.value;
    }
  }
  function submit(event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const d = state.dialog,
      f = new FormData(form);
    if (form.dataset.form === "supplier") {
      const s = supplierDraft(form);
      if (!s.name || !Number.isFinite(s.price) || s.price < 0) {
        d.draft = s;
        d.error = "Informe um nome e um valor total válido.";
        renderDialog();
        return;
      }
      const previous = state.data.suppliers.find((x) => x.id === s.id);
      const moved = previous && previous.categoryId !== s.categoryId;
      if (d.selectOnSave)
        state.selections = { ...state.selections, [s.categoryId]: s.id };
      commit({
        ...state.data,
        suppliers: previous
          ? state.data.suppliers.map((x) => (x.id === s.id ? s : x))
          : [...state.data.suppliers, s],
        scenarios: moved
          ? state.data.scenarios.map((x) => ({
              ...x,
              selections: Object.fromEntries(
                Object.entries(x.selections).filter(
                  ([categoryId, supplierId]) =>
                    supplierId !== s.id || categoryId === s.categoryId,
                ),
              ),
            }))
          : state.data.scenarios,
      });
      closeDialog();
      toast("Fornecedor salvo. As combinações já foram atualizadas.");
    }
    if (form.dataset.form === "save-budget") {
      const name = String(f.get("name") || "").trim();
      if (!name) {
        d.draftName = "";
        d.error = "Dê um nome ao orçamento.";
        renderDialog();
        return;
      }
      state.draftName = name;
      saveBudget();
      closeDialog();
    }
    if (form.dataset.form === "category") {
      const name = String(f.get("name") || "").trim();
      const category = {
        ...d.draft,
        name,
        icon: String(f.get("icon") || "Flower2"),
      };
      if (
        !name ||
        state.data.categories.some(
          (c) =>
            c.id !== category.id &&
            c.name.toLocaleLowerCase("pt-BR") ===
              name.toLocaleLowerCase("pt-BR"),
        )
      ) {
        d.draft = category;
        d.error = "Escolha um nome diferente para a categoria.";
        renderDialog();
        return;
      }
      commit({
        ...state.data,
        categories: d.isSaved
          ? state.data.categories.map((c) =>
              c.id === category.id ? category : c,
            )
          : [...state.data.categories, category],
      });
      closeDialog();
      toast("Categoria salva.");
    }
    if (form.dataset.form === "wedding") {
      captureSettings();
      if (!d.wedding.couple.trim()) {
        d.wedding.couple = "Nosso casamento";
      }
      d.wedding.couple = d.wedding.couple.trim();
      commit({ ...state.data, wedding: { ...d.wedding } });
      closeDialog();
      toast("Os detalhes do grande dia foram salvos.");
    }
    if (form.dataset.form === "ai") saveAI();
  }
  function keydown(event) {
    if (event.key === "Escape" && (pointerDrag || nativeDrag)) {
      event.preventDefault();
      cleanupDrag(true);
      return;
    }
    const card = event.target.closest?.(
      ".supplier-card[data-action=supplier-edit]",
    );
    if (
      !state.dialog &&
      card &&
      event.target === card &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      openSupplier(card.dataset.id);
      return;
    }
    if (!state.dialog) return;
    if (event.key === "Escape") {
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [
      ...overlay.querySelectorAll(
        "button:not(:disabled),input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
      ),
    ];
    const first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  function backdrop(event) {
    if (event.target.matches("[data-backdrop]")) closeDialog();
  }
  function updateScrollFades() {
    for (const wrapper of root.querySelectorAll("[data-scroll-fade]")) {
      const scroller = wrapper.querySelector("[data-horizontal-scroll]");
      if (!scroller) continue;
      wrapper.classList.toggle("can-scroll-left", scroller.scrollLeft > 2);
      wrapper.classList.toggle(
        "can-scroll-right",
        scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2,
      );
    }
  }
  function validDrop(id, target) {
    const supplier = state.data.suppliers.find((item) => item.id === id);
    const slot = target?.closest?.("[data-budget-category]");
    return (
      !!supplier &&
      (!slot || slot.dataset.budgetCategory === supplier.categoryId)
    );
  }
  function acceptDrop(id, target) {
    if (validDrop(id, target)) {
      selectSupplier(id, false);
      return;
    }
    const supplier = state.data.suppliers.find((item) => item.id === id);
    const category = state.data.categories.find(
      (item) => item.id === supplier?.categoryId,
    );
    if (category) toast(`Solte este fornecedor no espaço ${category.name}.`);
  }
  function setDropHighlight(active, id, target = null) {
    const zone = root.querySelector("[data-budget-dropzone]");
    if (!zone) return;
    const supplier = state.data.suppliers.find((s) => s.id === id);
    const hoveredSlot = target?.closest?.("[data-budget-category]");
    const category = state.data.categories.find(
      (item) => item.id === supplier?.categoryId,
    );
    const invalid =
      active &&
      supplier &&
      hoveredSlot &&
      hoveredSlot.dataset.budgetCategory !== supplier.categoryId;
    zone.classList.toggle("is-dragover", !!active && !!supplier);
    for (const slot of zone.querySelectorAll("[data-budget-category]")) {
      slot.classList.toggle(
        "is-drop-target",
        !!active && slot.dataset.budgetCategory === supplier?.categoryId,
      );
      slot.classList.toggle(
        "is-invalid-drop",
        !!invalid && slot === hoveredSlot,
      );
    }
    const hint = zone.querySelector(".drop-indicator");
    if (hint)
      hint.textContent = invalid
        ? `Use o espaço ${category?.name || ""} para este fornecedor.`
        : supplier
          ? `Solte para incluir ${supplier.name} em ${category?.name || ""}`
          : "Solte para incluir no orçamento";
  }
  function previewCard(card, pointer = false) {
    const preview = card.cloneNode(true);
    preview.classList.add(
      pointer ? "pointer-drag-preview" : "native-drag-preview",
    );
    preview.classList.remove("is-dragging", "is-holding");
    preview.inert = true;
    preview.setAttribute("aria-hidden", "true");
    preview.removeAttribute("tabindex");
    preview.style.width = `${Math.max(170, card.getBoundingClientRect().width || 190)}px`;
    const track = card.closest('[style*="--card-color"]');
    if (track) {
      preview.style.setProperty(
        "--card-color",
        track.style.getPropertyValue("--card-color"),
      );
      preview.style.setProperty(
        "--category-color",
        track.style.getPropertyValue("--category-color"),
      );
    }
    document.body.append(preview);
    return preview;
  }
  function cleanupDrag(suppress = false) {
    if (pointerDrag) {
      clearTimeout(pointerDrag.timer);
      pointerDrag.source?.classList.remove("is-dragging", "is-holding");
      pointerDrag.preview?.remove();
      try {
        pointerDrag.source?.releasePointerCapture?.(pointerDrag.id);
      } catch {}
    }
    if (nativeDrag) {
      nativeDrag.source?.classList.remove("is-dragging");
      nativeDrag.preview?.remove();
    }
    pointerDrag = null;
    nativeDrag = null;
    scrollPointer = null;
    if (autoScrollFrame !== null) {
      if (window.cancelAnimationFrame)
        window.cancelAnimationFrame(autoScrollFrame);
      else clearTimeout(autoScrollFrame);
      autoScrollFrame = null;
    }
    document.body.classList.remove("drag-active");
    setDropHighlight(false);
    if (suppress) suppressClickUntil = Date.now() + 280;
  }
  function autoScroll() {
    if (autoScrollFrame !== null) return;
    const request =
      window.requestAnimationFrame?.bind(window) ||
      ((callback) => setTimeout(callback, 16));
    autoScrollFrame = request(() => {
      autoScrollFrame = null;
      if (!scrollPointer || (!nativeDrag && !pointerDrag?.active)) return;
      for (const el of root.querySelectorAll("[data-horizontal-scroll]")) {
        if (el.scrollWidth <= el.clientWidth) continue;
        const r = el.getBoundingClientRect(),
          p = scrollPointer;
        if (
          p.y < r.top ||
          p.y > r.bottom ||
          p.x < r.left - 30 ||
          p.x > r.right + 30
        )
          continue;
        const distance =
          p.x < r.left + 42
            ? p.x - r.left - 42
            : p.x > r.right - 42
              ? p.x - r.right + 42
              : 0;
        el.scrollLeft += Math.max(-18, Math.min(18, distance * 0.4));
      }
      updateScrollFades();
      autoScroll();
    });
  }
  function dragStart(event) {
    const card = event.target.closest("[data-supplier-id]");
    if (!card || !event.dataTransfer) return;
    if (pointerDrag || event.target.closest("[data-drag-handle]")) {
      event.preventDefault();
      return;
    }
    cleanupDrag();
    nativeDrag = {
      supplierId: card.dataset.supplierId,
      source: card,
      preview: previewCard(card),
    };
    event.dataTransfer.setData("text/plain", nativeDrag.supplierId);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setDragImage?.(nativeDrag.preview, 90, 25);
    card.classList.add("is-dragging");
    document.body.classList.add("drag-active");
  }
  function dragOver(event) {
    scrollPointer = { x: event.clientX || 0, y: event.clientY || 0 };
    if (nativeDrag) autoScroll();
    const target = event.target.closest("[data-budget-dropzone]");
    if (!target) return;
    event.preventDefault();
    const id = nativeDrag?.supplierId;
    if (event.dataTransfer)
      event.dataTransfer.dropEffect = validDrop(id, event.target)
        ? "copy"
        : "none";
    setDropHighlight(true, id, event.target);
  }
  function dragLeave(event) {
    const target = event.target.closest("[data-budget-dropzone]");
    if (target && !target.contains(event.relatedTarget))
      setDropHighlight(false);
  }
  function drop(event) {
    const target = event.target.closest("[data-budget-dropzone]");
    if (!target) return;
    event.preventDefault();
    const id =
      event.dataTransfer?.getData("text/plain") || nativeDrag?.supplierId;
    cleanupDrag(true);
    acceptDrop(id, event.target);
  }
  function activatePointerDrag() {
    const drag = pointerDrag;
    if (!drag || drag.active) return;
    drag.active = true;
    drag.preview = previewCard(drag.source, true);
    drag.source.classList.remove("is-holding");
    drag.source.classList.add("is-dragging");
    document.body.classList.add("drag-active");
    try {
      drag.source.setPointerCapture?.(drag.id);
    } catch {}
    movePointerPreview();
  }
  function movePointerPreview() {
    const drag = pointerDrag;
    if (!drag?.active) return;
    drag.preview.style.transform = `translate3d(${drag.x - 80}px,${drag.y - 24}px,0) rotate(-3deg)`;
    const point = document.elementFromPoint?.(drag.x, drag.y);
    const target = point?.closest?.("[data-budget-dropzone]");
    setDropHighlight(!!target, drag.supplierId, point);
    scrollPointer = { x: drag.x, y: drag.y };
    autoScroll();
  }
  function pointerDown(event) {
    const handle = event.target.closest?.("[data-drag-handle]");
    if (event.button > 0 || state.dialog || event.isPrimary === false) return;
    if (!handle && event.target.closest?.("button,a,input,select,textarea"))
      return;
    const card = event.target.closest?.(".supplier-card[data-supplier-id]");
    if (!card) return;
    cleanupDrag();
    if (handle || event.pointerType === "mouse") event.preventDefault();
    pointerDrag = {
      id: event.pointerId,
      supplierId: card.dataset.supplierId,
      source: card,
      x: event.clientX || 0,
      y: event.clientY || 0,
      startX: event.clientX || 0,
      startY: event.clientY || 0,
      fromHandle: !!handle,
      pointerType: event.pointerType || "mouse",
      active: false,
      timer: null,
    };
    pointerDrag.timer = setTimeout(activatePointerDrag, 180);
    card.classList.add("is-holding");
  }
  function pointerMove(event) {
    const drag = pointerDrag;
    if (!drag || drag.id !== event.pointerId) return;
    drag.x = event.clientX || 0;
    drag.y = event.clientY || 0;
    if (
      !drag.active &&
      Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 5
    ) {
      if (!drag.fromHandle && drag.pointerType === "touch") {
        cleanupDrag();
        return;
      }
      clearTimeout(drag.timer);
      activatePointerDrag();
    }
    if (drag.active) {
      event.preventDefault();
      movePointerPreview();
    }
  }
  function pointerUp(event) {
    const drag = pointerDrag;
    if (!drag || drag.id !== event.pointerId) return;
    const point =
      drag.active &&
      document.elementFromPoint?.(
        event.clientX || drag.x,
        event.clientY || drag.y,
      );
    const target = point?.closest?.("[data-budget-dropzone]");
    const id = drag.supplierId,
      wasActive = drag.active;
    cleanupDrag(wasActive);
    if (target) acceptDrop(id, point);
  }
  function dragEnd() {
    cleanupDrag(true);
  }
  function pointerCancel() {
    cleanupDrag(true);
  }
  function touchMove(event) {
    if (pointerDrag?.active && event.cancelable) event.preventDefault();
  }
  function contextMenu(event) {
    if (pointerDrag?.active) event.preventDefault();
  }
  function horizontalWheel(event) {
    const bar = event.target.closest?.("[data-budget-dropzone]");
    const scroller =
      bar?.querySelector("[data-horizontal-scroll]") ||
      event.target.closest?.(".kanban-area")?.querySelector(".kanban-board");
    if (
      !scroller ||
      event.ctrlKey ||
      scroller.scrollWidth <= scroller.clientWidth
    )
      return;
    const horizontalIntent =
      event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const column = !bar && event.target.closest?.(".kanban-column");
    if (
      !horizontalIntent &&
      column &&
      column.scrollHeight > column.clientHeight
    ) {
      const canScrollUp = event.deltaY < 0 && column.scrollTop > 0;
      const canScrollDown =
        event.deltaY > 0 &&
        column.scrollTop + column.clientHeight < column.scrollHeight - 1;
      if (canScrollUp || canScrollDown) return;
    }
    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    const scale =
      event.deltaMode === 1
        ? 20
        : event.deltaMode === 2
          ? scroller.clientWidth
          : 1;
    const next = Math.max(
      0,
      Math.min(
        scroller.scrollWidth - scroller.clientWidth,
        scroller.scrollLeft + delta * scale,
      ),
    );
    if (next === scroller.scrollLeft) return;
    event.preventDefault();
    scroller.scrollLeft = next;
    updateScrollFades();
  }
  for (const el of [root, overlay]) {
    el.addEventListener("click", click);
    el.addEventListener("input", input);
    el.addEventListener("change", change);
    el.addEventListener("submit", submit);
  }
  toastRoot.addEventListener("click", click);
  root.addEventListener("dragstart", dragStart);
  root.addEventListener("dragover", dragOver);
  root.addEventListener("dragleave", dragLeave);
  root.addEventListener("drop", drop);
  root.addEventListener("dragend", dragEnd);
  root.addEventListener("pointerdown", pointerDown);
  root.addEventListener("scroll", updateScrollFades, true);
  root.addEventListener("wheel", horizontalWheel, { passive: false });
  root.addEventListener("touchmove", touchMove, { passive: false });
  root.addEventListener("contextmenu", contextMenu);
  document.addEventListener("pointermove", pointerMove, { passive: false });
  document.addEventListener("pointerup", pointerUp);
  document.addEventListener("pointercancel", pointerCancel);
  window.addEventListener("resize", updateScrollFades);
  overlay.addEventListener("mousedown", backdrop);
  document.addEventListener("keydown", keydown);
  state.storageError = !saveData(state.data);
  render();
  return {
    destroy() {
      destroyed = true;
      cleanupDrag();
      assistant?.destroy();
      guestsView?.destroy();
      modelRequest?.abort();
      clearTimeout(toastTimer);
      for (const el of [root, overlay]) {
        el.removeEventListener("click", click);
        el.removeEventListener("input", input);
        el.removeEventListener("change", change);
        el.removeEventListener("submit", submit);
      }
      document.removeEventListener("keydown", keydown);
      root.removeEventListener("dragstart", dragStart);
      root.removeEventListener("dragover", dragOver);
      root.removeEventListener("dragleave", dragLeave);
      root.removeEventListener("drop", drop);
      root.removeEventListener("dragend", dragEnd);
      root.removeEventListener("pointerdown", pointerDown);
      root.removeEventListener("scroll", updateScrollFades, true);
      root.removeEventListener("wheel", horizontalWheel);
      root.removeEventListener("touchmove", touchMove);
      root.removeEventListener("contextmenu", contextMenu);
      document.removeEventListener("pointermove", pointerMove);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("resize", updateScrollFades);
      overlay.remove();
      toastRoot.remove();
      root.innerHTML = "";
      document.body.style.overflow = "";
    },
  };
}

import { resolveScenario } from "./lib/budget.js";
import {
  escapeHtml as e,
  money,
  icon,
  categoryColors as colors,
} from "./ui.js";

function selectedBudget(data, selections = {}) {
  return resolveScenario({ selections }, data);
}

function bookmark(favorite) {
  return `<svg width="17" height="19" viewBox="0 0 20 24" fill="${favorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M4 2h12v20l-6-4-6 4V2Z"/></svg>`;
}

/** The board and the selection panel intentionally use the same compact supplier card. */
function supplierCard(supplier, selected, inBudget = false) {
  return `<article class="supplier-card ${selected ? "is-selected" : ""}" draggable="true" data-supplier-id="${e(supplier.id)}" data-action="supplier-edit" data-id="${e(supplier.id)}" role="button" tabindex="0" aria-label="${e(`Configurar ${supplier.name}`)}">
    <div class="supplier-card-top"><button type="button" class="supplier-card-grip" data-drag-handle="true" data-action="drag-handle" data-id="${e(supplier.id)}" title="Segure e arraste" aria-label="${e(`Arrastar ${supplier.name}`)}">${icon("GripVertical", 17)}</button><button type="button" class="supplier-card-bookmark ${supplier.favorite ? "is-favorite" : ""}" data-action="toggle-favorite" data-id="${e(supplier.id)}" aria-label="${e(supplier.favorite ? `Remover ${supplier.name} dos favoritos` : `Favoritar ${supplier.name}`)}" aria-pressed="${Boolean(supplier.favorite)}">${bookmark(supplier.favorite)}</button></div>
    <h3 class="supplier-card-name">${e(supplier.name)}</h3><p class="supplier-card-notes">${e(supplier.notes)}</p>
    <div class="supplier-card-bottom"><span class="supplier-card-rating" title="Sua avaliação">${icon("Star", 11, true)} ${e(supplier.rating)}/5</span><strong class="supplier-card-price">${e(money(supplier.price))}</strong><button type="button" class="card-budget-toggle ${selected ? "is-selected" : ""}" data-action="${inBudget ? "remove-selection" : "add-selection"}" data-category="${e(supplier.categoryId)}" data-id="${e(supplier.id)}" title="${inBudget ? "Remover do orçamento" : selected ? "Já está no orçamento" : "Incluir no orçamento"}" aria-label="${e(`${inBudget ? "Remover" : "Incluir"} ${supplier.name} ${inBudget ? "do" : "no"} orçamento`)}">${icon(inBudget ? "X" : selected ? "Check" : "Plus", 14)}</button></div>
  </article>`;
}

function budgetBuilder(data, state) {
  const result = selectedBudget(data, state.selections);
  const selected = result.items.filter((item) => item.supplier);
  const totalTitle = result.isComplete
    ? "Total dos fornecedores selecionados"
    : `Valor parcial: ${result.selectedCount} de ${data.categories.length} categorias selecionadas`;
  const missing = result.missingCategories.length;
  const completion = result.isComplete
    ? "Orçamento completo"
    : data.categories.length
      ? `Faltam ${missing} ${missing === 1 ? "categoria" : "categorias"}`
      : "Crie as categorias do orçamento";
  return `<aside class="budget-builder" data-budget-dropzone="true" aria-label="Orçamento selecionado"><div class="budget-summary"><h2 class="budget-builder-heading">MEU ORÇAMENTO</h2><div class="budget-builder-total" title="${e(totalTitle)}"><strong>${e(money(result.total))}</strong></div><span class="budget-coverage">${result.selectedCount}/${data.categories.length} categorias <strong class="budget-completion ${result.isComplete ? "is-complete" : "is-incomplete"}">${e(completion)}</strong></span><div class="budget-builder-actions"><button type="button" class="save-budget-button" data-action="request-save-budget" ${!selected.length ? "disabled" : ""}>Salvar orçamento</button></div></div>
    <div class="budget-selection-viewport scroll-fade" data-scroll-fade><div class="budget-selection-list" data-horizontal-scroll aria-label="Categorias do orçamento">${result.items
      .map(({ category, supplier }, index) => {
        const options = data.suppliers.filter(
          (option) => option.categoryId === category.id,
        );
        const empty = `<div class="budget-empty-slot"><strong>Falta escolher</strong><small>Solte um cartão aqui</small></div>${options.length ? `<select class="budget-choice" data-budget-choice data-category="${e(category.id)}" aria-label="Escolher fornecedor para ${e(category.name)}"><option value="">Escolher fornecedor...</option>${options.map((option) => `<option value="${e(option.id)}">${e(option.name)} · ${e(money(option.price))}</option>`).join("")}</select>` : `<button type="button" class="budget-empty-add" data-action="add-supplier" data-category="${e(category.id)}" aria-label="Adicionar fornecedor em ${e(category.name)}">${icon("Plus", 16)} Adicionar fornecedor</button>`}`;
        return `<section class="budget-selection ${supplier ? "is-filled" : "is-empty"}" data-budget-category="${e(category.id)}" style="${colors(index)}" aria-label="${e(`${category.name}: ${supplier ? supplier.name : "Falta escolher"}`)}"><h3 class="budget-selection-category">${e(category.name.toLocaleUpperCase("pt-BR"))}</h3>${supplier ? supplierCard(supplier, true, true) : empty}</section>`;
      })
      .join(
        "",
      )}</div></div><div class="drop-indicator" aria-hidden="true">Solte para incluir no orçamento</div>
  </aside>`;
}

/** Native HTML templates follow the supplied board sketch; interaction stays in app.js. */
export function renderBoard(data, state = {}) {
  const selections = state.selections || {};
  const hint = data.suppliers.length
    ? "Toque para editar. Segure o cartão e arraste para o orçamento."
    : "Comece pelo +: cadastre um fornecedor e informe o valor.";
  return `<div class="board-layout"><section class="kanban-area" aria-label="Fornecedores por categoria"><div class="board-topbar"><span class="board-gesture-hint">${hint}</span><button type="button" class="board-add-button" data-action="open-add-menu" aria-label="Adicionar fornecedor ou categoria">${icon("Plus", 27)}</button></div>
    <div class="kanban-viewport scroll-fade" data-scroll-fade><div class="kanban-board" data-horizontal-scroll>${data.categories
      .map((category, index) => {
        const options = data.suppliers.filter(
          (supplier) => supplier.categoryId === category.id,
        );
        return `<div class="category-track" style="${colors(index)}"><header class="kanban-column-header"><h2 class="kanban-column-title">${e(category.name.toLocaleUpperCase("pt-BR"))}</h2><button type="button" class="category-edit-button" data-action="edit-category" data-id="${e(category.id)}" aria-label="${e(`Editar categoria ${category.name}`)}">${icon("Pencil", 17)}</button></header>
        <section class="kanban-column" data-category-id="${e(category.id)}" aria-label="${e(category.name)}"><div class="kanban-cards">${options.map((supplier) => supplierCard(supplier, selections[category.id] === supplier.id)).join("")}${!options.length ? `<button type="button" class="kanban-empty-add" data-action="add-supplier" data-category="${e(category.id)}" aria-label="${e(`Adicionar fornecedor em ${category.name}`)}">${icon("Plus", 18)} Adicionar opção</button>` : ""}</div></section></div>`;
      })
      .join("")}</div></div></section>${budgetBuilder(data, state)}</div>`;
}

/** Saved totals continue to use current supplier quotes without changing selected supplier IDs. */
export function renderSavedBudgets(data) {
  if (!data.scenarios.length)
    return `<div class="budgets-empty"><h2>Nenhum orçamento salvo</h2><p>Selecione os fornecedores no quadro e salve uma combinação.</p><button type="button" class="button button-primary" data-action="new-budget">${icon("Plus", 18)} Montar orçamento</button></div>`;
  return `<div class="saved-budgets-grid">${data.scenarios
    .map((scenario) => {
      const result = selectedBudget(data, scenario.selections);
      const selected = result.items.filter((item) => item.supplier);
      const over =
        data.wedding.budget > 0 && result.total > data.wedding.budget;
      return `<article class="saved-budget-card"><header class="saved-budget-header"><h2>${e(scenario.name)}</h2><button type="button" class="icon-button danger-hover" data-action="delete-scenario" data-id="${e(scenario.id)}" aria-label="${e(`Excluir orçamento ${scenario.name}`)}">${icon("Trash2", 19)}</button></header>
      <strong class="saved-budget-total">${e(money(result.total))}</strong><p class="saved-budget-coverage ${over ? "over-budget" : ""}">${result.selectedCount} de ${data.categories.length} categorias${!result.isComplete ? " · valor parcial" : ""}${over ? " · acima do limite" : ""}</p>
      ${scenario.description ? `<p class="saved-budget-description">${e(scenario.description)}</p>` : ""}
      <ul class="saved-budget-items">${selected.map(({ category, supplier }) => `<li class="saved-budget-item" style="${colors(data.categories.findIndex((item) => item.id === category.id))}"><div><span>${e(category.name)}</span><strong>${e(supplier.name)}</strong></div><strong>${e(money(supplier.price))}</strong></li>`).join("")}${!selected.length ? '<li class="saved-budget-item"><span>Sem fornecedores selecionados.</span></li>' : ""}</ul>
      <div class="saved-budget-actions"><button type="button" class="button button-primary" data-action="load-budget" data-id="${e(scenario.id)}">${icon("Pencil", 17)} Editar orçamento</button><button type="button" class="button button-secondary" data-action="duplicate-budget" data-id="${e(scenario.id)}">${icon("Copy", 17)} Duplicar</button></div></article>`;
    })
    .join("")}</div>`;
}

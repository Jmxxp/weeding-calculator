import { escapeHtml as e, icon, money } from "./ui.js";
import { generateStrategies, resolveScenario } from "./lib/budget.js";

const btn = (label, action, kind = "secondary", extra = "") =>
  `<button type="button" class="button button-${kind}" data-action="${action}" ${extra}>${label}</button>`;
const actions = (content) => `<div class="modal-actions">${content}</div>`;
const cancel = () => btn("Cancelar", "close-dialog");
const submit = (label) =>
  `<button type="submit" class="button button-primary">${icon("Check", 16)} ${label}</button>`;
const categoryIcons = [
  ["Flower2", "Flor"],
  ["Heart", "Coração"],
  ["MapPin", "Local"],
  ["UtensilsCrossed", "Comida"],
  ["Music2", "Música"],
  ["Camera", "Foto"],
  ["Gift", "Presente"],
  ["Church", "Cerimônia"],
  ["Shirt", "Traje"],
  ["CakeSlice", "Bolo"],
  ["Sparkles", "Decoração"],
  ["HeartHandshake", "Celebrante"],
  ["Mail", "Convite"],
];
const categoryIconOptions = (selected) => {
  const choices =
    selected && !categoryIcons.some(([value]) => value === selected)
      ? [...categoryIcons, [selected, "Ícone atual"]]
      : categoryIcons;
  return choices
    .map(
      ([value, label]) =>
        `<option value="${e(value)}" ${selected === value ? "selected" : ""}>${label}</option>`,
    )
    .join("");
};
export function dialogHTML(dialog, data) {
  let title = "",
    subtitle = "",
    content = "";
  switch (dialog.type) {
    case "add-menu": {
      title = "Adicionar";
      content = `<div class="dialog-choice-list">
        <button type="button" class="dialog-choice button button-secondary" data-action="add-category">${icon("Plus", 18)} Categoria</button>
        <button type="button" class="dialog-choice button button-secondary" data-action="add-supplier">${icon("Users", 18)} Fornecedor</button>
      </div><div class="modal-actions">
        ${data.isDemo ? '<button type="button" class="text-button" data-action="reset">Começar sem exemplos</button>' : ""}
      </div>`;
      break;
    }
    case "save-budget": {
      title = dialog.editingId ? "Salvar alterações" : "Salvar orçamento";
      content = `<form class="form-stack" data-form="save-budget">
        <label>Nome do orçamento<input id="save-budget-name" name="name" value="${e(dialog.draftName)}" maxlength="100" required /></label>
        ${dialog.error ? `<p class="error-message" role="alert">${e(dialog.error)}</p>` : ""}
        ${actions(cancel() + submit("Salvar"))}</form>`;
      break;
    }
    case "strategies": {
      title = "Preencher orçamento";
      subtitle = "Escolha uma combinação para preencher o orçamento atual.";
      const labels = ["Mais barato", "Custo-benefício", "Favoritos"];
      content = `<div class="dialog-choice-list">${generateStrategies(data)
        .map((strategy, index) => {
          const resolved = resolveScenario(strategy, data);
          return `<button type="button" class="dialog-choice button button-secondary" data-action="apply-strategy" data-id="${e(strategy.id)}" ${resolved.selectedCount ? "" : "disabled"}>
            <span><strong>${labels[index]}</strong><small>${resolved.selectedCount} de ${data.categories.length} categorias${resolved.isComplete ? "" : " · parcial"}</small></span>
            <strong>${e(money(resolved.total))}</strong>
          </button>`;
        })
        .join("")}</div>${actions(btn("Limpar escolhas", "clear-budget"))}`;
      break;
    }
    case "supplier": {
      const s = dialog.draft;
      title = dialog.isSaved ? "Editar fornecedor" : "Adicionar fornecedor";
      subtitle = "Informe o preço total e os dados de contato.";
      content = `<form class="form-stack" data-form="supplier">
        <label>Nome do fornecedor<input name="name" value="${e(s.name)}" maxlength="120" required placeholder="Ex.: Espaço Jardim das Oliveiras" /></label>
        <div class="form-grid"><label>Categoria<select name="categoryId" required>${data.categories.map((c) => `<option value="${e(c.id)}" ${c.id === s.categoryId ? "selected" : ""}>${e(c.name)}</option>`).join("")}</select></label><label>Valor total (R$)<input name="price" type="number" min="0" max="1000000000" step="0.01" value="${e(s.price)}" required /></label></div>
        <p class="field-hint tight">Informe o orçamento completo do serviço. Para buffet, inclua o total de convidados.</p>
        <label>Telefone / WhatsApp <span class="optional">opcional</span><input name="phone" type="tel" value="${e(s.phone)}" placeholder="(11) 99999-9999" maxlength="40" /></label>
        <div class="form-grid"><label>Sua avaliação<input type="hidden" name="rating" value="${s.rating}" /><span class="rating-picker">${[1, 2, 3, 4, 5].map((n) => `<button type="button" aria-label="Avaliação ${n} de 5" aria-pressed="${s.rating === n}" class="${s.rating === n ? "selected" : ""}" data-action="supplier-rating" data-value="${n}">${n}</button>`).join("")}</span><span class="field-hint">1 = básico · 5 = excelente</span></label>
        <label>Favorito<input type="hidden" name="favorite" value="${s.favorite}" /><button type="button" data-action="supplier-favorite" aria-pressed="${s.favorite}" class="favorite-choice ${s.favorite ? "selected" : ""}">${icon("Star", 18, s.favorite)} ${s.favorite ? "Favorito" : "Marcar favorito"}</button></label></div>
        <label>Observações <span class="optional">opcional</span><textarea name="notes" rows="3" maxlength="2000" placeholder="Serviços incluídos e condições de pagamento">${e(s.notes)}</textarea></label>
        ${dialog.error ? `<p class="error-message" role="alert">${e(dialog.error)}</p>` : ""}
        ${dialog.isSaved ? `<div>${btn("Excluir fornecedor", "supplier-delete", "danger", `data-id="${e(s.id)}"`)}</div>` : ""}
        ${actions(cancel() + submit("Salvar fornecedor"))}</form>`;
      break;
    }
    case "category": {
      const c = dialog.draft;
      title = dialog.isSaved ? "Editar categoria" : "Adicionar categoria";
      subtitle = "Cada categoria aparece como uma coluna no quadro.";
      content = `<form class="form-stack" data-form="category">
        <label>Nome da categoria<input name="name" value="${e(c.name)}" maxlength="60" placeholder="Ex.: Flores" required /></label>
        <label>Ícone<select name="icon">${categoryIconOptions(c.icon)}</select></label>
        ${dialog.error ? `<p class="error-message" role="alert">${e(dialog.error)}</p>` : ""}
        ${dialog.isSaved ? `<div>${btn("Excluir categoria", "category-request-delete", "danger", `data-id="${e(c.id)}"`)}</div>` : ""}
        ${actions(cancel() + submit("Salvar categoria"))}</form>`;
      break;
    }
    case "delete-category": {
      const category = data.categories.find((entry) => entry.id === dialog.id);
      const supplierCount = data.suppliers.filter(
        (supplier) => supplier.categoryId === dialog.id,
      ).length;
      title = "Excluir categoria?";
      content = `<p class="confirm-copy">A categoria <strong>${e(category?.name)}</strong> e ${supplierCount} ${supplierCount === 1 ? "fornecedor vinculado serão excluídos" : "fornecedores vinculados serão excluídos"}.</p>
        <p class="confirm-copy">As seleções dessa categoria serão removidas do orçamento em edição e dos orçamentos salvos. Os demais dados serão mantidos.</p>
        ${actions(cancel() + btn("Excluir categoria", "category-delete", "danger", `data-id="${e(dialog.id)}"`))}`;
      break;
    }
    case "settings": {
      title = "Configurações";
      const w = dialog.wedding;
      const c = dialog.config;
      const isWedding = dialog.tab === "wedding";
      content = `<div class="settings-tabs"><button type="button" data-action="settings-tab" data-tab="wedding" class="${isWedding ? "active" : ""}">Dados do casamento</button><button type="button" data-action="settings-tab" data-tab="ai" class="${!isWedding ? "active" : ""}">${icon("Sparkles", 15)} Inteligência artificial</button></div>`;
      if (isWedding)
        content += `<form class="form-stack" data-form="wedding"><label>Nome do casal<input name="couple" value="${e(w.couple)}" maxlength="100" placeholder="Ex.: Ana & Pedro" required /></label><div class="form-grid"><label>Data do casamento<input name="date" type="date" value="${e(w.date)}" /></label><label>Número de convidados<input name="guests" type="number" min="1" max="100000" step="1" value="${w.guests}" required /></label></div><label>Limite do orçamento (R$)<input name="budget" type="number" min="1" max="1000000000" step="0.01" value="${w.budget}" required /><span class="field-hint">Usado para comparar os valores dos orçamentos.</span></label>${actions(cancel() + submit("Salvar dados"))}</form>`;
      else
        content += `<form class="form-stack" data-form="ai"><div class="info-note">${icon("ShieldCheck", 21)}<p>As chaves ficam apenas nesta sessão do navegador. Seu orçamento é enviado ao provedor quando você conversa com a IA.</p></div>
        <label>Provedor<span class="provider-options">${["gemini", "deepseek"].map((p) => `<button type="button" data-action="ai-provider" data-provider="${p}" class="${c.provider === p ? "selected" : ""}">${icon("Sparkles", 18)}<span>${p === "gemini" ? "Google Gemini" : "DeepSeek"}</span>${c.provider === p ? icon("Check", 16) : ""}</button>`).join("")}</span></label>
        <label>Chave de API<span class="password-input">${icon("KeyRound", 16)}<input id="ai-key" name="apiKey" type="${dialog.reveal ? "text" : "password"}" value="${e(c.apiKey)}" autocomplete="off" spellcheck="false" placeholder="Cole sua chave aqui" required /><button type="button" data-action="ai-reveal" class="icon-button" aria-label="${dialog.reveal ? "Ocultar chave" : "Mostrar chave"}">${icon(dialog.reveal ? "EyeOff" : "Eye", 17)}</button></span><span class="field-hint">Obtenha sua chave no <a href="${c.provider === "gemini" ? "https://aistudio.google.com/apikey" : "https://platform.deepseek.com/api_keys"}" target="_blank" rel="noreferrer">${c.provider === "gemini" ? "Google AI Studio" : "DeepSeek Platform"} ↗</a>.</span></label>
        ${c.provider === "deepseek" ? `<label>Chave Tavily para pesquisa web <span class="optional">opcional para chat sem busca</span><input id="search-api-key" name="searchApiKey" type="password" value="${e(c.searchApiKey || "")}" autocomplete="off" spellcheck="false" placeholder="tvly-…" /><span class="field-hint">O DeepSeek usa esta ferramenta para pesquisar fornecedores. Obtenha a chave em <a href="https://app.tavily.com" target="_blank" rel="noreferrer">Tavily ↗</a>. Ela fica apenas nesta sessão. Sem a chave, você ainda pode planejar com os dados cadastrados, desligando a busca no chat.</span></label>` : '<p class="field-hint">A busca do Google usa a própria chave do Gemini. Selecione um modelo compatível com pesquisa web.</p>'}
        <button type="button" data-action="ai-fetch-models" class="button button-secondary" ${dialog.status === "loading" ? "disabled" : ""}>${icon(dialog.status === "loading" ? "LoaderCircle" : "RefreshCw", 16)} ${dialog.status === "loading" ? "Conectando…" : "Conectar e buscar modelos"}</button>
        ${dialog.status === "success" ? `<p class="success-text">${icon("Check", 16)} Conexão verificada. ${dialog.models.length} modelos disponíveis.</p>` : ""}${dialog.error ? `<p class="error-message" role="alert">${e(dialog.error)}</p>` : ""}
        ${dialog.models.length ? `<label>Modelos disponíveis<select name="modelSelect"><option value="" disabled>Escolha um modelo</option>${dialog.models.map((m) => `<option value="${e(m.id)}" ${c.model === m.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select></label>` : ""}
        <label>ID do modelo<input name="model" value="${e(c.model)}" maxlength="150" placeholder="Selecione acima ou informe o ID do modelo" required /><span class="field-hint">Você pode informar manualmente um modelo disponível na sua conta. O uso pode ser cobrado pelo provedor.</span></label>${actions(btn("Desconectar", "ai-disconnect") + submit("Salvar configuração"))}</form>`;
      break;
    }
    case "delete-supplier": {
      title = "Excluir fornecedor?";
      const s = data.suppliers.find((s) => s.id === dialog.id);
      content = `<p class="confirm-copy">O fornecedor <strong>${e(s?.name)}</strong> será excluído. Os orçamentos que usam esse fornecedor ficarão sem seleção nesta categoria.</p>${actions(btn("Manter fornecedor", "close-dialog") + btn("Excluir fornecedor", "supplier-remove", "danger", `data-id="${e(dialog.id)}"`))}`;
      break;
    }
    case "delete-scenario": {
      title = "Excluir orçamento?";
      const s = data.scenarios.find((s) => s.id === dialog.id);
      content = `<p class="confirm-copy">O orçamento <strong>${e(s?.name)}</strong> será excluído. Os fornecedores cadastrados serão mantidos.</p>${actions(btn("Manter orçamento", "close-dialog") + btn("Excluir orçamento", "scenario-remove", "danger", `data-id="${e(dialog.id)}"`))}`;
      break;
    }
    case "reset":
      title = "Limpar dados e começar?";
      content = `<p class="confirm-copy">Isso substituirá <strong>todo o planejamento atual</strong>, incluindo alterações, convidados e fornecedores que você adicionou durante a demonstração. Você começa com as categorias padrão, sem fornecedores ou orçamentos salvos.</p>${actions(cancel() + btn("Limpar e começar", "reset-confirm", "primary"))}`;
      break;
    case "clear-budget":
      title = "Limpar orçamento atual?";
      content = `<p class="confirm-copy">Todas as escolhas do orçamento em edição serão removidas. Os fornecedores, convidados e orçamentos salvos continuam disponíveis.</p>${actions(cancel() + btn("Limpar escolhas", "clear-budget", "danger"))}`;
      break;
    default:
      return "";
  }
  return `<div class="modal-backdrop" data-backdrop="true"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="modal-head"><div><h2 id="dialog-title">${e(title)}</h2>${subtitle ? `<p>${e(subtitle)}</p>` : ""}</div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Fechar janela">${icon("X", 20)}</button></div>${content}</div></div>`;
}

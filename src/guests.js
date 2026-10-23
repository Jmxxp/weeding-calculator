import { uid } from "./lib/demo.js";
import { escapeHtml as e, icon } from "./ui.js";

const statuses = {
  pending: "Pendente",
  confirmed: "Confirmado",
  declined: "Não irá",
};
const accents = ["#e6d4ff", "#d7f7e9", "#fff2bd", "#ffdcef"];
const blankGuest = () => ({
  id: null,
  name: "",
  phone: "",
  partySize: 1,
  status: "pending",
  notes: "",
});
const searchable = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
const sizeOf = (guest) =>
  Number.isFinite(guest.partySize)
    ? Math.max(1, Math.min(1000, Math.round(guest.partySize)))
    : 1;

/** Keeps its form and filters local; callers persist only the supplied guest list. */
export function mountGuests(container, { getData, onSaveGuests }) {
  const state = {
    search: "",
    filter: "all",
    form: null,
    deletingId: "",
    error: "",
    message: "",
  };
  let destroyed = false;
  const guests = () =>
    Array.isArray(getData().guestsList) ? getData().guestsList : [];

  function render() {
    if (destroyed) return;
    const active = container.ownerDocument.activeElement;
    const focus =
      container.contains(active) && active.id
        ? {
            id: active.id,
            start: active.selectionStart,
            end: active.selectionEnd,
          }
        : null;
    const list = guests();
    const counts = { total: 0, pending: 0, confirmed: 0, declined: 0 };
    for (const guest of list) {
      counts.total += sizeOf(guest);
      if (Object.hasOwn(statuses, guest.status))
        counts[guest.status] += sizeOf(guest);
    }
    const visible = list.filter(
      (guest) =>
        (state.filter === "all" || guest.status === state.filter) &&
        searchable(`${guest.name} ${guest.phone} ${guest.notes}`).includes(
          searchable(state.search.trim()),
        ),
    );
    container.innerHTML = `<section class="guests-view" aria-label="Lista de convidados">
      <header class="guests-header"><div><h1>Convidados</h1><p>Organize os nomes e as confirmações.</p></div><button type="button" id="guests-add" class="guests-button guests-button-primary" data-guests-action="add" ${list.length >= 10000 ? "disabled" : ""}>${icon("Plus", 18)} Convidado</button></header>
      <div class="guests-stats">${[
        ["total", "Pessoas na lista"],
        ["confirmed", "Confirmadas"],
        ["pending", "Pendentes"],
        ["declined", "Não irão"],
      ]
        .map(
          ([key, label]) =>
            `<div class="guests-stat guests-stat-${key}"><strong data-guests-count="${key}">${counts[key]}</strong><span>${label}</span></div>`,
        )
        .join("")}</div>
      ${state.form ? formHTML() : ""}
      <div class="guests-tools"><label class="guests-search">${icon("Search", 18)}<input id="guests-search" type="search" aria-label="Buscar convidado" placeholder="Buscar nome ou telefone" value="${e(state.search)}"></label><label class="guests-filter"><span>Confirmação</span><select id="guests-filter" aria-label="Filtrar confirmação"><option value="all" ${state.filter === "all" ? "selected" : ""}>Todas</option>${Object.entries(
        statuses,
      )
        .map(
          ([value, label]) =>
            `<option value="${value}" ${state.filter === value ? "selected" : ""}>${label}</option>`,
        )
        .join("")}</select></label></div>
      ${state.message ? `<p class="guests-message" role="status">${e(state.message)}</p>` : ""}
      <div class="guests-list">${visible.map((guest) => cardHTML(guest, list.indexOf(guest))).join("") || `<div class="guests-empty"><h2>${list.length ? "Nenhum convidado encontrado" : "Sua lista começa aqui"}</h2><p>${list.length ? "Ajuste a busca ou a confirmação para encontrar alguém." : "Adicione uma pessoa ou uma família e informe quantas pessoas fazem parte do convite."}</p>${list.length ? '<button type="button" class="guests-button" data-guests-action="clear-filters">Limpar filtros</button>' : ""}</div>`}</div>
      <p class="guests-footnote">${list.length} ${list.length === 1 ? "convite cadastrado" : "convites cadastrados"}. Os totais consideram o número de pessoas de cada convite.</p>
    </section>`;
    if (focus) {
      const element = container.ownerDocument.getElementById(focus.id);
      if (element && container.contains(element)) {
        element.focus({ preventScroll: true });
        if (
          typeof focus.start === "number" &&
          typeof element.setSelectionRange === "function"
        ) {
          try {
            element.setSelectionRange(focus.start, focus.end);
          } catch {}
        }
      }
    }
  }

  function formHTML() {
    const guest = state.form;
    return `<form class="guests-form" data-guests-form="guest"><h2>${guest.id ? "Editar convidado" : "Adicionar convidado"}</h2>
      <div class="guests-form-grid"><label>Nome ou família<input id="guests-name" name="name" value="${e(guest.name)}" maxlength="120" required placeholder="Ex.: Ana e família"></label><label>Telefone <span class="guests-optional">opcional</span><input id="guests-phone" name="phone" type="tel" value="${e(guest.phone)}" maxlength="40" placeholder="(11) 99999-9999"></label><label>Pessoas neste convite<input id="guests-party-size" name="partySize" type="number" min="1" max="1000" step="1" value="${e(guest.partySize)}" required></label><label>Confirmação<select id="guests-status" name="status">${Object.entries(
        statuses,
      )
        .map(
          ([value, label]) =>
            `<option value="${value}" ${guest.status === value ? "selected" : ""}>${label}</option>`,
        )
        .join("")}</select></label></div>
      <label>Observações <span class="guests-optional">opcional</span><textarea id="guests-notes" name="notes" maxlength="2000" rows="2" placeholder="Restrições alimentares, contato ou outros detalhes">${e(guest.notes)}</textarea></label>
      ${state.error ? `<p class="guests-error" role="alert">${e(state.error)}</p>` : ""}<div class="guests-form-actions"><button type="button" class="guests-button" data-guests-action="cancel-edit">Cancelar</button><button type="submit" class="guests-button guests-button-primary">${icon("Check", 17)} Salvar convidado</button></div></form>`;
  }

  function cardHTML(guest, index) {
    const status = Object.hasOwn(statuses, guest.status)
      ? guest.status
      : "pending";
    const partySize = sizeOf(guest);
    return `<article class="guests-card" data-guest-id="${e(guest.id)}" style="--guest-accent:${accents[index % accents.length]}"><div class="guests-card-main"><div class="guests-card-heading"><h2>${e(guest.name)}</h2><span class="guests-badge guests-badge-${status}">${statuses[status]}</span></div><p class="guests-party">${icon("Users", 17)} ${partySize} ${partySize === 1 ? "pessoa" : "pessoas"}</p>${guest.phone ? `<a class="guests-phone" href="tel:${e(guest.phone.replace(/[^+\d]/g, ""))}">${e(guest.phone)}</a>` : ""}${guest.notes ? `<p class="guests-notes">${e(guest.notes)}</p>` : ""}</div><div class="guests-card-actions"><button type="button" class="guests-button" data-guests-action="edit" data-id="${e(guest.id)}" aria-label="${e(`Editar ${guest.name}`)}">${icon("Pencil", 16)} Editar</button><button type="button" class="guests-button guests-button-delete" data-guests-action="request-delete" data-id="${e(guest.id)}" aria-label="${e(`Excluir ${guest.name}`)}">${icon("Trash2", 16)}</button></div>
      ${state.deletingId === guest.id ? `<div class="guests-confirm" role="group" aria-label="Confirmar exclusão"><p>Excluir <strong>${e(guest.name)}</strong> e ${partySize === 1 ? "esta pessoa" : `as ${partySize} pessoas deste convite`} da lista?</p><div><button type="button" class="guests-button" data-guests-action="cancel-delete">Manter convidado</button><button type="button" class="guests-button guests-button-danger" data-guests-action="confirm-delete" data-id="${e(guest.id)}">Excluir convite</button></div></div>` : ""}</article>`;
  }

  function click(event) {
    const button = event.target.closest?.("[data-guests-action]");
    if (!button || !container.contains(button) || button.disabled) return;
    event.preventDefault();
    const action = button.dataset.guestsAction;
    const id = button.dataset.id;
    if (action === "add") {
      state.form = blankGuest();
      state.error = "";
      state.message = "";
      state.deletingId = "";
      render();
      container.querySelector("#guests-name")?.focus();
    } else if (action === "edit") {
      const guest = guests().find((item) => item.id === id);
      if (!guest) return;
      state.form = { ...guest };
      state.error = "";
      state.message = "";
      state.deletingId = "";
      render();
      container.querySelector("#guests-name")?.focus();
    } else if (action === "cancel-edit") {
      state.form = null;
      state.error = "";
      render();
    } else if (action === "request-delete") {
      state.deletingId = state.deletingId === id ? "" : id;
      render();
    } else if (action === "cancel-delete") {
      state.deletingId = "";
      render();
    } else if (action === "confirm-delete") {
      const next = guests().filter((guest) => guest.id !== id);
      if (state.form?.id === id) state.form = null;
      state.deletingId = "";
      state.message = "Convite excluído.";
      onSaveGuests(next);
      render();
    } else if (action === "clear-filters") {
      state.search = "";
      state.filter = "all";
      render();
    }
  }

  function input(event) {
    if (event.target.id === "guests-search") {
      state.search = event.target.value;
      render();
      return;
    }
    if (state.form && event.target.closest("[data-guests-form]")) {
      const field = event.target.name;
      if (["name", "phone", "partySize", "status", "notes"].includes(field))
        state.form[field] = event.target.value;
    }
  }

  function change(event) {
    if (event.target.id === "guests-filter") {
      state.filter = event.target.value;
      render();
    } else input(event);
  }

  function submit(event) {
    const form = event.target.closest?.("form[data-guests-form]");
    if (!form || !state.form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const field = (name) => form.elements.namedItem(name).value;
    const name = field("name").trim();
    const partySize = Number(field("partySize"));
    const status = field("status");
    if (
      !name ||
      !Number.isInteger(partySize) ||
      partySize < 1 ||
      partySize > 1000 ||
      !Object.hasOwn(statuses, status)
    ) {
      state.error = "Informe um nome e um número de pessoas entre 1 e 1.000.";
      render();
      return;
    }
    const guest = {
      id: state.form.id || uid(),
      name,
      phone: field("phone").trim(),
      partySize,
      status,
      notes: field("notes").trim(),
    };
    const list = guests();
    if (!state.form.id && list.length >= 10000) {
      state.error = "A lista atingiu o limite de 10.000 convites.";
      render();
      return;
    }
    const exists = list.some((item) => item.id === guest.id);
    const next = exists
      ? list.map((item) => (item.id === guest.id ? guest : item))
      : [...list, guest];
    state.form = null;
    state.error = "";
    state.message = exists ? "Convidado atualizado." : "Convidado adicionado.";
    onSaveGuests(next);
    render();
  }

  container.addEventListener("click", click);
  container.addEventListener("input", input);
  container.addEventListener("change", change);
  container.addEventListener("submit", submit);
  render();
  return {
    refresh() {
      if (
        state.form?.id &&
        !guests().some((guest) => guest.id === state.form.id)
      )
        state.form = null;
      render();
    },
    destroy() {
      destroyed = true;
      container.removeEventListener("click", click);
      container.removeEventListener("input", input);
      container.removeEventListener("change", change);
      container.removeEventListener("submit", submit);
      container.innerHTML = "";
    },
  };
}

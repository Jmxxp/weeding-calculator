import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { fireEvent, within } from "@testing-library/dom";
import { mountApp } from "../src/app.js";
import { createEmptyData } from "../src/lib/demo.js";
import { STORAGE_KEY } from "../src/lib/storage.js";

const DRAFT_KEY = "weeding-calculator-draft-v1";
let dom, root, app, descriptors, browserErrors, captures, releases;

beforeEach(() => {
  dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://localhost/" },
  );
  dom.window.scrollTo = () => {};
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  dom.window.PointerEvent = class extends dom.window.MouseEvent {
    constructor(type, options = {}) {
      super(type, options);
      Object.defineProperties(this, {
        pointerId: { value: options.pointerId ?? 1 },
        pointerType: { value: options.pointerType ?? "touch" },
        isPrimary: { value: true },
      });
    }
  };
  captures = [];
  releases = [];
  dom.window.HTMLElement.prototype.setPointerCapture = function (id) {
    captures.push({ element: this, id });
  };
  dom.window.HTMLElement.prototype.releasePointerCapture = function (id) {
    releases.push({ element: this, id });
  };
  browserErrors = [];
  dom.window.addEventListener("error", (event) => {
    browserErrors.push(event.error);
    event.preventDefault();
  });
  descriptors = new Map();
  for (const name of [
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "FormData",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "Element",
    "Node",
    "Event",
    "MouseEvent",
    "PointerEvent",
    "KeyboardEvent",
    "navigator",
  ]) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      value: name === "window" ? dom.window : dom.window[name],
      configurable: true,
      writable: true,
    });
  }
  root = document.getElementById("root");
});

afterEach(() => {
  app?.destroy();
  app = null;
  dom.window.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  assert.deepEqual(browserErrors, [], "Browser event handlers must not throw.");
});

function mount(data = fixture()) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  app = mountApp(root);
}
function saved() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY));
}
function draft() {
  return JSON.parse(localStorage.getItem(DRAFT_KEY)) || { selections: {} };
}
function query(selector, scope = document) {
  const element = scope.querySelector(selector);
  assert.ok(element, `Missing ${selector}`);
  return element;
}
function click(selector, scope = document) {
  fireEvent.click(query(selector, scope));
}
function input(selector, value) {
  fireEvent.input(query(selector), { target: { value } });
}
function type(name, value) {
  input(`[name="${name}"]`, value);
}
function choose(selector, value) {
  fireEvent.change(query(selector), { target: { value } });
}
function formSubmit(kind) {
  click('button[type="submit"]', query(`form[data-form="${kind}"]`));
}
function navigate(view) {
  click(`nav [data-action="view"][data-view="${view}"]`);
}
function card(id, scope = document.querySelector(".kanban-board")) {
  return query(`.supplier-card[data-supplier-id="${id}"]`, scope);
}
function include(id) {
  click('[data-action="add-selection"]', card(id));
}
function total() {
  return query(".budget-builder-total strong").textContent;
}
function saveBudget(name) {
  click('[data-action="request-save-budget"]');
  input("#save-budget-name", name);
  formSubmit("save-budget");
}
function supplier(id, categoryId, name, price, rating = 4, favorite = false) {
  return {
    id,
    categoryId,
    name,
    price,
    phone: "(11) 90000-0001",
    favorite,
    rating,
    notes: "Serviço completo para o casamento.",
  };
}
function fixture() {
  const data = createEmptyData();
  data.wedding.guests = 100;
  data.categories = [
    { id: "local", name: "Local", icon: "MapPin" },
    { id: "buffet", name: "Buffet", icon: "UtensilsCrossed" },
  ];
  data.suppliers = [
    supplier("local-small", "local", "Jardim", 1000, 2),
    supplier("local-large", "local", "Casa ampla", 1800, 5, true),
    supplier("buffet-small", "buffet", "Mesa simples", 2000, 2),
    supplier("buffet-large", "buffet", "Mesa completa", 3200, 5, true),
  ];
  return data;
}
function transfer() {
  const values = new Map();
  const images = [];
  return {
    images,
    effectAllowed: "all",
    dropEffect: "none",
    setData(type, value) {
      values.set(type, value);
    },
    getData(type) {
      return values.get(type) || "";
    },
    setDragImage(element, x, y) {
      images.push({ element, x, y });
    },
    clearData() {
      values.clear();
    },
  };
}
function pointer(type, target, x, y, id = 7) {
  fireEvent[type](target, {
    pointerId: id,
    pointerType: "touch",
    button: 0,
    clientX: x,
    clientY: y,
  });
}
function fakeTime(t) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
}
function noBackupUI() {
  assert.equal(
    document.querySelector(
      '[data-action="import"],[data-action="export"],input[type="file"]',
    ),
    null,
  );
}

// DOM structure and interactions are checked here; rendered layout is verified in the browser.
test("the board places total after the columns, exposes rating corners and updates horizontal fade edges", () => {
  mount();
  const layout = query(".board-layout");
  assert.equal(layout.children[0].className, "kanban-area");
  assert.equal(layout.children[1].className, "budget-builder");
  assert.ok(query(".kanban-viewport").classList.contains("scroll-fade"));
  assert.ok(
    query(".budget-selection-viewport").classList.contains("scroll-fade"),
  );
  assert.match(
    query(".supplier-card-rating", card("local-small")).textContent,
    /2\/5/,
  );
  assert.equal(card("local-small").dataset.action, "supplier-edit");
  assert.equal(
    card("local-small").querySelector(".supplier-card-contact"),
    null,
  );
  assert.equal(
    document.querySelector(".workspace-heading,#supplier-search,#budget-name"),
    null,
  );
  noBackupUI();
  const scroller = query(".kanban-board");
  Object.defineProperties(scroller, {
    clientWidth: { value: 300, configurable: true },
    scrollWidth: { value: 1000, configurable: true },
  });
  const wrapper = query(".kanban-viewport");
  fireEvent.scroll(scroller);
  assert.equal(wrapper.classList.contains("can-scroll-left"), false);
  assert.equal(wrapper.classList.contains("can-scroll-right"), true);
  scroller.scrollLeft = 350;
  fireEvent.scroll(scroller);
  assert.equal(wrapper.classList.contains("can-scroll-left"), true);
  assert.equal(wrapper.classList.contains("can-scroll-right"), true);
  scroller.scrollLeft = 700;
  fireEvent.scroll(scroller);
  assert.equal(wrapper.classList.contains("can-scroll-right"), false);
  click('[data-action="open-wedding"]');
  noBackupUI();
});

test("click and keyboard edit cards, bookmarks only favorite, plus replaces and bottom x removes selections", () => {
  mount();
  fireEvent.click(card("local-small"));
  assert.ok(document.querySelector('form[data-form="supplier"]'));
  assert.deepEqual(draft().selections, {});
  click('[data-action="close-dialog"]');
  for (const key of ["Enter", " "]) {
    fireEvent.keyDown(card("local-large"), { key });
    assert.equal(
      query('form[data-form="supplier"] [name="name"]').value,
      "Casa ampla",
    );
    click('[data-action="close-dialog"]');
  }
  click('[data-action="toggle-favorite"]', card("local-small"));
  assert.equal(
    saved().suppliers.find((option) => option.id === "local-small").favorite,
    true,
  );
  assert.deepEqual(draft().selections, {});
  assert.equal(document.querySelector('[role="dialog"]'), null);
  include("local-small");
  include("local-large");
  include("local-large");
  assert.deepEqual(draft().selections, { local: "local-large" });
  assert.match(total(), /1\.800,00/);
  assert.equal(
    document.querySelectorAll(".budget-selection .supplier-card").length,
    1,
  );
  click('[data-action="remove-selection"]', query(".budget-selection-list"));
  assert.deepEqual(draft().selections, {});
  assert.equal(query('[data-action="request-save-budget"]').disabled, true);
});

test("native drag uses a preview, drops without accidental edit clicks and preserves scroll and reload draft", (t) => {
  mount();
  fakeTime(t);
  query(".kanban-board").scrollLeft = 354;
  const dataTransfer = transfer();
  fireEvent.dragStart(card("local-large"), { dataTransfer });
  assert.equal(dataTransfer.images.length, 1);
  assert.ok(document.querySelector(".native-drag-preview"));
  assert.equal(document.body.classList.contains("drag-active"), true);
  fireEvent.dragOver(query("[data-budget-dropzone]"), { dataTransfer });
  assert.equal(
    query("[data-budget-dropzone]").classList.contains("is-dragover"),
    true,
  );
  fireEvent.drop(query("[data-budget-dropzone]"), { dataTransfer });
  assert.deepEqual(draft().selections, { local: "local-large" });
  assert.equal(query(".kanban-board").scrollLeft, 354);
  assert.equal(
    document.querySelector(".native-drag-preview,.is-dragging"),
    null,
  );
  assert.equal(document.body.classList.contains("drag-active"), false);
  fireEvent.click(card("local-large"));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  t.mock.timers.tick(300);
  include("buffet-small");
  assert.match(total(), /3\.800,00/);
  query(".budget-selection-list").scrollLeft = 155;
  click('[data-action="toggle-favorite"]', card("local-large"));
  assert.equal(
    query(".budget-selection-list").scrollLeft,
    155,
    "Editing a card must preserve the horizontal budget position.",
  );
  app.destroy();
  app = mountApp(root);
  assert.match(total(), /3\.800,00/);
  assert.deepEqual(draft().selections, {
    local: "local-large",
    buffet: "buffet-small",
  });
});

test("ending an unsuccessful native drag removes preview and highlight without changing the budget", (t) => {
  mount();
  fakeTime(t);
  const dataTransfer = transfer();
  const source = card("local-large");
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(query("[data-budget-dropzone]"), { dataTransfer });
  fireEvent.dragEnd(source, { dataTransfer });
  assert.deepEqual(draft().selections, {});
  assert.equal(
    document.querySelector(".native-drag-preview,.is-dragging"),
    null,
  );
  assert.equal(
    query("[data-budget-dropzone]").classList.contains("is-dragover"),
    false,
  );
  fireEvent.click(card("local-large"));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  t.mock.timers.tick(300);
  fireEvent.click(card("local-large"));
  assert.ok(document.querySelector('form[data-form="supplier"]'));
});

test("touch pointer movement drags from the grip, captures and releases the pointer and drops on total", (t) => {
  mount();
  fakeTime(t);
  document.elementFromPoint = () =>
    document.querySelector("[data-budget-dropzone]");
  pointer(
    "pointerDown",
    query("[data-drag-handle]", card("local-small")),
    20,
    30,
  );
  assert.equal(document.querySelector(".pointer-drag-preview"), null);
  pointer("pointerMove", document, 40, 60);
  assert.ok(document.querySelector(".pointer-drag-preview"));
  assert.equal(captures.length, 1);
  assert.equal(captures[0].id, 7);
  assert.equal(
    query("[data-budget-dropzone]").classList.contains("is-dragover"),
    true,
  );
  pointer("pointerUp", document, 40, 60);
  assert.equal(releases.length, 1);
  assert.deepEqual(draft().selections, { local: "local-small" });
  assert.equal(
    document.querySelector(".pointer-drag-preview,.is-dragging"),
    null,
  );
  assert.equal(document.body.classList.contains("drag-active"), false);
  fireEvent.click(card("local-small"));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  t.mock.timers.tick(300);
  fireEvent.click(card("local-small"));
  assert.ok(document.querySelector('form[data-form="supplier"]'));
});

test("holding a touch grip activates dragging and pointer cancellation cleans up without selecting", (t) => {
  mount();
  fakeTime(t);
  document.elementFromPoint = () => document.body;
  pointer(
    "pointerDown",
    query("[data-drag-handle]", card("buffet-small")),
    25,
    45,
  );
  t.mock.timers.tick(179);
  assert.equal(document.querySelector(".pointer-drag-preview"), null);
  t.mock.timers.tick(2);
  assert.ok(document.querySelector(".pointer-drag-preview"));
  pointer("pointerCancel", document, 25, 45);
  assert.equal(
    document.querySelector(".pointer-drag-preview,.is-dragging"),
    null,
  );
  assert.equal(document.body.classList.contains("drag-active"), false);
  assert.deepEqual(draft().selections, {});
  assert.equal(releases.length, 1);
  t.mock.timers.tick(400);
  assert.equal(document.querySelector(".pointer-drag-preview"), null);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("holding the body of a card drags while an early touch swipe remains available for scrolling", (t) => {
  mount();
  fakeTime(t);
  const body = query(".supplier-card-name", card("local-small"));
  document.elementFromPoint = () =>
    document.querySelector("[data-budget-dropzone]");
  pointer("pointerDown", body, 80, 90);
  pointer("pointerMove", document, 80, 110);
  t.mock.timers.tick(200);
  assert.equal(document.querySelector(".pointer-drag-preview"), null);
  pointer("pointerUp", document, 80, 110);
  assert.deepEqual(draft().selections, {});
  pointer("pointerDown", body, 80, 90);
  t.mock.timers.tick(181);
  assert.ok(document.querySelector(".pointer-drag-preview"));
  assert.equal(
    fireEvent.touchMove(body, { cancelable: true }),
    false,
    "An active hold owns the drag gesture.",
  );
  pointer("pointerMove", document, 180, 390);
  pointer("pointerUp", document, 180, 390);
  assert.deepEqual(draft().selections, { local: "local-small" });
  assert.equal(document.querySelector(".pointer-drag-preview"), null);
});

test("the mouse wheel scrolls the budget horizontally without Shift and preserves browser zoom gestures", () => {
  mount();
  include("local-small");
  include("buffet-small");
  const scroller = query(".budget-selection-list");
  Object.defineProperties(scroller, {
    clientWidth: { value: 200 },
    scrollWidth: { value: 800 },
  });
  assert.equal(
    fireEvent.wheel(query(".budget-summary"), {
      deltaY: 120,
      cancelable: true,
    }),
    false,
  );
  assert.equal(scroller.scrollLeft, 120);
  assert.equal(
    fireEvent.wheel(scroller, { deltaY: -40, cancelable: true }),
    false,
  );
  assert.equal(scroller.scrollLeft, 80);
  assert.equal(
    fireEvent.wheel(scroller, { deltaY: 50, ctrlKey: true, cancelable: true }),
    true,
  );
  assert.equal(scroller.scrollLeft, 80);
});

test("save modal rejects blank names, updates a saved plan and duplicates into independent choices", () => {
  mount();
  include("local-small");
  click('[data-action="request-save-budget"]');
  input("#save-budget-name", "   ");
  formSubmit("save-budget");
  assert.equal(saved().scenarios.length, 0);
  assert.match(within(document.body).getByRole("alert").textContent, /nome/);
  input("#save-budget-name", "Plano principal");
  formSubmit("save-budget");
  const originalId = saved().scenarios[0].id;
  include("local-large");
  saveBudget("Plano revisado");
  assert.equal(saved().scenarios.length, 1);
  assert.equal(saved().scenarios[0].id, originalId);
  navigate("scenarios");
  assert.equal(
    document.querySelector(".saved-budget-coverage.over-budget"),
    null,
    "An unset spending limit must not mark every saved budget as over budget.",
  );
  click(`[data-action="duplicate-budget"][data-id="${originalId}"]`);
  include("buffet-small");
  saveBudget("Plano com jantar");
  assert.equal(saved().scenarios.length, 2);
  assert.notEqual(saved().scenarios[1].id, originalId);
  assert.deepEqual(saved().scenarios[0].selections, { local: "local-large" });
  assert.deepEqual(saved().scenarios[1].selections, {
    local: "local-large",
    buffet: "buffet-small",
  });
  noBackupUI();
});

test("editing price through a card refreshes both totals and deleting cleans draft and saved references", () => {
  mount();
  include("local-small");
  include("buffet-small");
  saveBudget("Plano original");
  fireEvent.click(card("local-small"));
  type("price", "1250");
  formSubmit("supplier");
  assert.match(total(), /3\.250,00/);
  navigate("scenarios");
  assert.match(query(".saved-budget-total").textContent, /3\.250,00/);
  click(`[data-action="load-budget"][data-id="${saved().scenarios[0].id}"]`);
  fireEvent.click(card("local-small"));
  click('[data-action="supplier-delete"]', query('form[data-form="supplier"]'));
  click('[data-action="supplier-remove"]');
  assert.deepEqual(draft().selections, { buffet: "buffet-small" });
  assert.deepEqual(saved().scenarios[0].selections, { buffet: "buffet-small" });
  assert.match(total(), /2\.000,00/);
});

test("sidebar clearing requires confirmation and only clears the draft, preserving suppliers, guests and saved plans", () => {
  const data = fixture();
  data.guestsList = [
    {
      id: "guest",
      name: "Ana",
      phone: "",
      partySize: 2,
      status: "pending",
      notes: "",
    },
  ];
  mount(data);
  include("local-small");
  include("buffet-small");
  saveBudget("Plano salvo");
  click('[data-action="request-clear-budget"]');
  assert.match(
    query('[role="dialog"]').textContent,
    /orçamentos salvos continuam/,
  );
  click('[data-action="close-dialog"]');
  assert.deepEqual(draft().selections, {
    local: "local-small",
    buffet: "buffet-small",
  });
  click('[data-action="request-clear-budget"]');
  click('[data-action="clear-budget"]', query('[role="dialog"]'));
  assert.deepEqual(draft().selections, {});
  assert.deepEqual(saved().scenarios[0].selections, {
    local: "local-small",
    buffet: "buffet-small",
  });
  assert.equal(saved().suppliers.length, 4);
  assert.equal(saved().guestsList.length, 1);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(query('[data-action="request-save-budget"]').disabled, true);
});

test("the guests sidebar saves families and counts across views and reload without altering the budget estimate", () => {
  mount();
  include("local-large");
  navigate("guests");
  click('[data-guests-action="add"]');
  input("#guests-name", "Ana e família");
  input("#guests-party-size", "3");
  choose("#guests-status", "confirmed");
  click('[data-guests-form] button[type="submit"]');
  assert.equal(saved().guestsList.length, 1);
  assert.equal(saved().guestsList[0].partySize, 3);
  assert.equal(saved().wedding.guests, 100);
  assert.equal(query('[data-guests-count="confirmed"]').textContent, "3");
  noBackupUI();
  navigate("overview");
  assert.match(total(), /1\.800,00/);
  navigate("guests");
  assert.match(query(".guests-list").textContent, /Ana e família/);
  app.destroy();
  app = mountApp(root);
  navigate("guests");
  assert.equal(query('[data-guests-count="confirmed"]').textContent, "3");
  assert.equal(saved().wedding.guests, 100);
});

test("the kanban wheel moves horizontally without Shift, yields to a scrollable column and leaves zoom untouched", () => {
  mount();
  const board = query(".kanban-board");
  const column = query('[data-category-id="local"]');
  Object.defineProperties(board, {
    clientWidth: { value: 300, configurable: true },
    scrollWidth: { value: 1500, configurable: true },
  });
  assert.equal(
    fireEvent.wheel(board, { deltaY: 120, cancelable: true }),
    false,
  );
  assert.equal(board.scrollLeft, 120);
  Object.defineProperties(column, {
    clientHeight: { value: 180, configurable: true },
    scrollHeight: { value: 600, configurable: true },
  });
  column.scrollTop = 100;
  assert.equal(
    fireEvent.wheel(card("local-small"), { deltaY: 90, cancelable: true }),
    true,
    "The browser must retain the vertical gesture while the column can scroll.",
  );
  assert.equal(board.scrollLeft, 120);
  column.scrollTop = 420;
  assert.equal(
    fireEvent.wheel(card("local-small"), { deltaY: 90, cancelable: true }),
    false,
  );
  assert.equal(board.scrollLeft, 210);
  column.scrollTop = 0;
  assert.equal(
    fireEvent.wheel(column, { deltaY: -50, cancelable: true }),
    false,
  );
  assert.equal(board.scrollLeft, 160);
  assert.equal(
    fireEvent.wheel(board, { deltaY: 60, ctrlKey: true, cancelable: true }),
    true,
  );
  assert.equal(board.scrollLeft, 160);
});

test("every category has a colored budget slot before selection and choosing or removing keeps the slot visible", () => {
  mount();
  let slots = [...document.querySelectorAll("[data-budget-category]")];
  assert.equal(slots.length, 2);
  assert.deepEqual(
    slots.map((slot) => slot.dataset.budgetCategory),
    ["local", "buffet"],
  );
  assert.equal(
    new Set(
      slots.map((slot) => slot.style.getPropertyValue("--category-color")),
    ).size,
    2,
  );
  assert.ok(slots.every((slot) => /Falta escolher/i.test(slot.textContent)));
  assert.equal(
    document.querySelectorAll(".budget-selection .supplier-card").length,
    0,
  );
  assert.match(total(), /0,00/);
  assert.match(query(".budget-coverage").textContent, /0\/2/);
  choose('[data-budget-choice][data-category="local"]', "local-large");
  assert.deepEqual(draft().selections, { local: "local-large" });
  assert.match(total(), /1\.800,00/);
  let localSlot = query('[data-budget-category="local"]');
  assert.equal(
    query(".supplier-card", localSlot).dataset.supplierId,
    "local-large",
  );
  assert.match(
    query('[data-budget-category="buffet"]').textContent,
    /Falta escolher/i,
  );
  assert.match(query(".budget-coverage").textContent, /1\/2/);
  choose('[data-budget-choice][data-category="buffet"]', "buffet-small");
  assert.match(total(), /3\.800,00/);
  assert.match(query(".budget-coverage").textContent, /2\/2/);
  assert.match(query(".budget-coverage").textContent, /completo/i);
  localSlot = query('[data-budget-category="local"]');
  const color = localSlot.style.getPropertyValue("--category-color");
  click('[data-action="remove-selection"]', localSlot);
  slots = [...document.querySelectorAll("[data-budget-category]")];
  assert.equal(slots.length, 2);
  localSlot = query('[data-budget-category="local"]');
  assert.equal(localSlot.style.getPropertyValue("--category-color"), color);
  assert.equal(localSlot.querySelector(".supplier-card"), null);
  assert.match(localSlot.textContent, /Falta escolher/i);
  assert.match(total(), /2\.000,00/);
  assert.deepEqual(draft().selections, { buffet: "buffet-small" });
});

test("creating a supplier from an empty budget slot fills it while board creation keeps the choice empty", () => {
  const data = fixture();
  data.suppliers = [];
  mount(data);
  click(
    '[data-action="add-supplier"]',
    query('[data-budget-category="local"]'),
  );
  assert.equal(query('[name="categoryId"]').value, "local");
  type("name", "Local novo");
  type("price", "1500");
  formSubmit("supplier");
  const created = saved().suppliers.find(
    (option) => option.name === "Local novo",
  );
  assert.ok(created);
  assert.deepEqual(draft().selections, { local: created.id });
  assert.match(total(), /1\.500,00/);
  click('.kanban-empty-add[data-category="buffet"]');
  type("name", "Buffet novo");
  type("price", "2000");
  formSubmit("supplier");
  assert.equal(saved().suppliers.length, 2);
  assert.deepEqual(draft().selections, { local: created.id });
  assert.ok(query('[data-budget-category="buffet"] [data-budget-choice]'));
});

test("native drops reject the wrong category slot, accept the matching slot and route outer-bar drops by supplier", (t) => {
  mount();
  fakeTime(t);
  let dataTransfer = transfer();
  fireEvent.dragStart(card("local-small"), { dataTransfer });
  let slot = query('[data-budget-category="buffet"]');
  fireEvent.dragOver(slot, { dataTransfer });
  assert.equal(slot.classList.contains("is-invalid-drop"), true);
  assert.equal(slot.classList.contains("is-drop-target"), false);
  fireEvent.drop(slot, { dataTransfer });
  assert.deepEqual(draft().selections, {});
  assert.equal(
    document.querySelector(".native-drag-preview,.is-dragging"),
    null,
  );
  t.mock.timers.tick(300);
  dataTransfer = transfer();
  fireEvent.dragStart(card("local-small"), { dataTransfer });
  slot = query('[data-budget-category="local"]');
  fireEvent.dragOver(slot, { dataTransfer });
  assert.equal(slot.classList.contains("is-drop-target"), true);
  fireEvent.drop(slot, { dataTransfer });
  assert.deepEqual(draft().selections, { local: "local-small" });
  t.mock.timers.tick(300);
  dataTransfer = transfer();
  fireEvent.dragStart(card("buffet-large"), { dataTransfer });
  fireEvent.dragOver(query(".budget-summary"), { dataTransfer });
  fireEvent.drop(query(".budget-summary"), { dataTransfer });
  assert.deepEqual(draft().selections, {
    local: "local-small",
    buffet: "buffet-large",
  });
  assert.match(total(), /4\.200,00/);
  assert.equal(
    document.querySelector(
      ".is-drop-target,.is-invalid-drop,.native-drag-preview",
    ),
    null,
  );
});

test("touch drops reject mismatched slots and select only after releasing over the matching category", (t) => {
  mount();
  fakeTime(t);
  document.elementFromPoint = () =>
    document.querySelector('[data-budget-category="buffet"]');
  pointer(
    "pointerDown",
    query("[data-drag-handle]", card("local-large")),
    20,
    30,
  );
  pointer("pointerMove", document, 40, 60);
  assert.equal(
    query('[data-budget-category="buffet"]').classList.contains(
      "is-invalid-drop",
    ),
    true,
  );
  pointer("pointerUp", document, 40, 60);
  assert.deepEqual(draft().selections, {});
  assert.equal(
    document.querySelector(".pointer-drag-preview,.is-dragging"),
    null,
  );
  t.mock.timers.tick(300);
  document.elementFromPoint = () =>
    document.querySelector('[data-budget-category="local"]');
  pointer(
    "pointerDown",
    query("[data-drag-handle]", card("local-large")),
    20,
    30,
  );
  pointer("pointerMove", document, 40, 60);
  assert.equal(
    query('[data-budget-category="local"]').classList.contains(
      "is-drop-target",
    ),
    true,
  );
  assert.deepEqual(
    draft().selections,
    {},
    "Hovering over a slot must not commit the choice.",
  );
  pointer("pointerUp", document, 40, 60);
  assert.deepEqual(draft().selections, { local: "local-large" });
  assert.equal(
    query('[data-budget-category="local"] .supplier-card').dataset.supplierId,
    "local-large",
  );
  assert.equal(
    document.querySelector(
      ".pointer-drag-preview,.is-drop-target,.is-invalid-drop",
    ),
    null,
  );
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { fireEvent } from "@testing-library/dom";
import { mountGuests } from "../src/guests.js";
import { createEmptyData } from "../src/lib/demo.js";

let dom, container, view, data, savedLists, descriptors, browserErrors;
beforeEach(() => {
  dom = new JSDOM(
    '<!doctype html><html><body><div id="guests-root"></div></body></html>',
    { url: "http://localhost/" },
  );
  descriptors = new Map();
  for (const [name, value] of [
    ["window", dom.window],
    ["document", dom.window.document],
  ]) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  }
  browserErrors = [];
  dom.window.addEventListener("error", (event) => {
    browserErrors.push(event.error);
    event.preventDefault();
  });
  container = document.getElementById("guests-root");
  data = createEmptyData();
  data.wedding.guests = 100;
  savedLists = [];
});
afterEach(() => {
  view?.destroy();
  view = null;
  dom.window.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  assert.deepEqual(browserErrors, []);
});
function mount() {
  view = mountGuests(container, {
    getData: () => data,
    onSaveGuests: (list) => {
      savedLists.push(structuredClone(list));
      data = { ...data, guestsList: list };
      view.refresh();
    },
  });
}
function query(selector) {
  const node = container.querySelector(selector);
  assert.ok(node, `Missing ${selector}`);
  return node;
}
function click(selector) {
  fireEvent.click(query(selector));
}
function input(selector, value) {
  fireEvent.input(query(selector), { target: { value } });
}
function change(selector, value) {
  fireEvent.change(query(selector), { target: { value } });
}
function save() {
  click('[data-guests-form] button[type="submit"]');
}
function count(status) {
  return Number(query(`[data-guests-count="${status}"]`).textContent);
}
const guest = (id, name, partySize, status) => ({
  id,
  name,
  partySize,
  status,
  phone: "",
  notes: "",
});

test("adding and editing a family updates weighted RSVP counts without replacing wedding.guests", () => {
  mount();
  click('[data-guests-action="add"]');
  input("#guests-name", "Ana e família");
  input("#guests-phone", "(11) 90000-0001");
  input("#guests-party-size", "3");
  change("#guests-status", "confirmed");
  input("#guests-notes", "Uma opção vegetariana.");
  save();
  assert.equal(savedLists.length, 1);
  assert.equal(data.guestsList[0].partySize, 3);
  assert.equal(data.guestsList[0].status, "confirmed");
  assert.equal(count("total"), 3);
  assert.equal(count("confirmed"), 3);
  assert.equal(count("pending"), 0);
  assert.equal(data.wedding.guests, 100);
  click('[data-guests-action="edit"]');
  input("#guests-party-size", "2");
  change("#guests-status", "declined");
  save();
  assert.equal(data.guestsList.length, 1);
  assert.equal(savedLists.length, 2);
  assert.equal(count("total"), 2);
  assert.equal(count("confirmed"), 0);
  assert.equal(count("declined"), 2);
  assert.equal(data.guestsList[0].notes, "Uma opção vegetariana.");
  assert.equal(data.wedding.guests, 100);
});

test("accent-insensitive search and status filters show the right invitations while counts remain global", () => {
  data.guestsList = [
    guest("a", "João e família", 3, "confirmed"),
    guest("b", "Maria", 2, "pending"),
    guest("c", "Ana e família", 4, "declined"),
  ];
  mount();
  assert.equal(count("total"), 9);
  assert.equal(count("confirmed"), 3);
  assert.equal(count("pending"), 2);
  assert.equal(count("declined"), 4);
  input("#guests-search", "joao");
  assert.equal(container.querySelectorAll(".guests-card").length, 1);
  assert.match(query(".guests-card").textContent, /João/);
  change("#guests-filter", "pending");
  assert.equal(container.querySelectorAll(".guests-card").length, 0);
  assert.equal(count("total"), 9);
  click('[data-guests-action="clear-filters"]');
  assert.equal(container.querySelectorAll(".guests-card").length, 3);
  change("#guests-filter", "declined");
  assert.equal(container.querySelectorAll(".guests-card").length, 1);
  assert.match(query(".guests-card").textContent, /Ana/);
});

test("deletion requires an inline confirmation and cancellation leaves the list unchanged", () => {
  data.guestsList = [
    guest("family", "Bruno e família", 4, "pending"),
    guest("single", "Carla", 1, "confirmed"),
  ];
  mount();
  click('[data-guests-action="request-delete"][data-id="family"]');
  assert.match(query(".guests-confirm").textContent, /4 pessoas/);
  assert.equal(savedLists.length, 0);
  click('[data-guests-action="cancel-delete"]');
  assert.equal(container.querySelector(".guests-confirm"), null);
  assert.equal(data.guestsList.length, 2);
  click('[data-guests-action="request-delete"][data-id="family"]');
  click('[data-guests-action="confirm-delete"][data-id="family"]');
  assert.equal(savedLists.length, 1);
  assert.deepEqual(
    data.guestsList.map((item) => item.id),
    ["single"],
  );
  assert.equal(count("total"), 1);
  assert.equal(count("pending"), 0);
  assert.equal(count("confirmed"), 1);
});

test("refresh preserves a form draft, focus and filters; cancel discards edits", () => {
  data.guestsList = [guest("one", "Joana", 1, "pending")];
  mount();
  input("#guests-search", "Joana");
  change("#guests-filter", "pending");
  click('[data-guests-action="edit"]');
  input("#guests-name", "Joana e família");
  input("#guests-notes", "Precisa de cadeira infantil.");
  query("#guests-notes").focus();
  query("#guests-notes").setSelectionRange(4, 10);
  view.refresh();
  assert.equal(query("#guests-name").value, "Joana e família");
  assert.equal(query("#guests-notes").value, "Precisa de cadeira infantil.");
  assert.equal(document.activeElement.id, "guests-notes");
  assert.equal(query("#guests-notes").selectionStart, 4);
  assert.equal(query("#guests-filter").value, "pending");
  assert.equal(query("#guests-search").value, "Joana");
  click('[data-guests-action="cancel-edit"]');
  assert.equal(container.querySelector("[data-guests-form]"), null);
  assert.equal(savedLists.length, 0);
  assert.equal(data.guestsList[0].name, "Joana");
});

test("guest forms reject invalid entries and escape names, contacts and notes as plain text", () => {
  mount();
  click('[data-guests-action="add"]');
  input("#guests-name", "   ");
  save();
  assert.equal(savedLists.length, 0);
  assert.ok(container.querySelector('[role="alert"]'));
  input("#guests-name", "<img src=x onerror=bad()>");
  input("#guests-party-size", "0");
  save();
  assert.equal(savedLists.length, 0);
  input("#guests-party-size", "1001");
  save();
  assert.equal(savedLists.length, 0);
  input("#guests-party-size", "1");
  input("#guests-phone", '"><script>bad()</script>');
  input("#guests-notes", "<svg onload=bad()>");
  save();
  assert.equal(savedLists.length, 1);
  assert.equal(container.querySelector("img,script,svg[onload]"), null);
  assert.match(
    query(".guests-card").textContent,
    /<img src=x onerror=bad\(\)>/,
  );
  assert.match(query(".guests-notes").textContent, /<svg onload=bad\(\)>/);
  assert.equal(query(".guests-phone").getAttribute("href"), "tel:");
});

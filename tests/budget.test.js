import assert from "node:assert/strict";
import test from "node:test";
import {
  generateStrategies,
  resolveScenario,
  scenarioTotal,
} from "../src/lib/budget.js";
import { createEmptyData, createInitialData } from "../src/lib/demo.js";
import {
  loadData,
  normalizeStorage,
  prepareFreshStart,
  saveData,
  STORAGE_KEY,
  FRESH_START_KEY,
} from "../src/lib/storage.js";
const option = (
  id,
  price,
  rating = 4,
  favorite = false,
  categoryId = "local",
) => ({
  id,
  categoryId,
  name: id,
  price,
  rating,
  favorite,
  phone: "",
  notes: "",
});
const scenario = (selections) => ({
  id: "test",
  name: "Test",
  description: "",
  selections,
  createdAt: new Date(0).toISOString(),
  source: "manual",
});
test("strategies independently select cheapest, balanced quality and starred choice", () => {
  const data = createEmptyData();
  data.categories = data.categories.slice(0, 1);
  data.suppliers = [
    option("cheap", 100, 1),
    option("balanced", 110, 5),
    option("favorite", 200, 4, true),
  ];
  const [cheapest, balanced, favorites] = generateStrategies(data);
  assert.equal(cheapest.selections.local, "cheap");
  assert.equal(balanced.selections.local, "balanced");
  assert.equal(favorites.selections.local, "favorite");
});
test("multiple stars prioritize rating and then price, independent of input order", () => {
  const data = createEmptyData();
  data.suppliers = [
    option("first", 300, 4, true),
    option("second", 200, 5, true),
    option("winner", 100, 5, true),
    option("unstarred", 50, 5),
  ];
  assert.equal(generateStrategies(data)[2].selections.local, "winner");
  data.suppliers.reverse();
  assert.equal(generateStrategies(data)[2].selections.local, "winner");
});
test("favorites without a star choose best rating then price; equal prices stay finite", () => {
  const data = createEmptyData();
  data.suppliers = [
    option("a", 100, 3),
    option("b", 100, 5),
    option("c", 120, 5),
  ];
  const strategies = generateStrategies(data);
  assert.equal(strategies[1].selections.local, "b");
  assert.equal(strategies[2].selections.local, "b");
  data.suppliers = [option("a", 0, 3), option("b", 0, 5)];
  assert.equal(generateStrategies(data)[1].selections.local, "b");
});
test("missing categories remain incomplete and stale or cross-category IDs do not inflate totals", () => {
  const data = createEmptyData();
  data.suppliers = [option("a", 123.45), option("b", 20, 4, false, "buffet")];
  const selected = scenario({ local: "b", buffet: "deleted", flowers: "a" });
  assert.equal(scenarioTotal(selected, data.suppliers), 0);
  const resolved = resolveScenario(selected, data);
  assert.equal(resolved.total, 0);
  assert.equal(resolved.isComplete, false);
  assert.equal(resolved.missingCategories.length, data.categories.length);
  const cheapest = generateStrategies(data)[0];
  assert.equal(scenarioTotal(cheapest, data.suppliers), 143.45);
  assert.equal(resolveScenario(cheapest, data).selectedCount, 2);
});
test("invalid supplier prices are excluded, free options count, and decimal totals are rounded", () => {
  const data = createEmptyData();
  data.suppliers = [
    option("nan", NaN),
    option("negative", -10),
    option("free", 0),
    option("buffet", 0.1, 4, false, "buffet"),
    option("decor", 0.2, 4, false, "decoracao"),
  ];
  const cheapest = generateStrategies(data)[0];
  assert.equal(cheapest.selections.local, "free");
  assert.equal(scenarioTotal(cheapest, data.suppliers), 0.3);
  assert.equal(resolveScenario(cheapest, data).selectedCount, 3);
});
test("demo is complete, fictional and independently cloned", () => {
  const demo = createInitialData();
  assert.equal(demo.categories.length, 12);
  assert.equal(
    new Set(demo.categories.map((category) => category.id)).size,
    12,
  );
  assert.equal(
    resolveScenario(generateStrategies(demo)[0], demo).isComplete,
    true,
  );
  assert.ok(
    demo.suppliers.every((supplier) =>
      /^\(11\) 90000-\d{4}$/.test(supplier.phone),
    ),
  );
  demo.categories[0].name = "Changed";
  assert.equal(createInitialData().categories[0].name, "Local");
});
test("normalization recovers records while removing duplicates, orphan suppliers and stale selections", () => {
  const data = createEmptyData();
  const input = {
    ...data,
    wedding: { couple: " Test ", date: "bad", guests: NaN, budget: Infinity },
    categories: [
      data.categories[0],
      data.categories[0],
      null,
      { id: "bad", name: "" },
    ],
    suppliers: [
      option("valid", 120.555, 9),
      option("valid", 10),
      option("orphan", 3, 4, false, "missing"),
      option("nan", NaN),
      option("negative", -5),
    ],
    scenarios: [
      {
        ...scenario({ local: "valid", unknown: "valid", buffet: "deleted" }),
        createdAt: "bad",
        source: "other",
      },
    ],
  };
  const normalized = normalizeStorage(input);
  assert.equal(normalized.categories.length, 1);
  assert.equal(normalized.suppliers.length, 1);
  assert.equal(normalized.suppliers[0].rating, 5);
  assert.equal(normalized.suppliers[0].price, 120.56);
  assert.equal(normalized.wedding.guests, 0);
  assert.equal(normalized.wedding.budget, 0);
  assert.equal(normalized.wedding.date, "");
  assert.deepEqual(normalized.scenarios[0].selections, { local: "valid" });
  assert.equal(normalized.scenarios[0].source, "manual");
  assert.equal(normalized.scenarios[0].createdAt, new Date(0).toISOString());
});
test("normalization rejects broken roots but preserves deliberately empty categories", () => {
  assert.equal(normalizeStorage("{broken"), null);
  assert.equal(normalizeStorage(null), null);
  assert.equal(normalizeStorage({ version: 99 }), null);
  assert.equal(
    normalizeStorage({ version: 1, categories: [], suppliers: [] }),
    null,
  );
  const data = createEmptyData();
  data.categories = [];
  assert.deepEqual(normalizeStorage(JSON.stringify(data)), data);
});
test("normalization rejects calendar overflow and safely retains unusual category IDs", () => {
  const data = createEmptyData();
  data.wedding.date = "2027-02-30";
  data.categories = [{ id: "__proto__", name: "Custom", icon: "Heart" }];
  data.suppliers = [option("custom", 50, 5, false, "__proto__")];
  const [cheapest] = generateStrategies(data);
  assert.equal(Object.hasOwn(cheapest.selections, "__proto__"), true);
  data.scenarios = [cheapest];
  const normalized = normalizeStorage(JSON.stringify(data));
  assert.equal(normalized.wedding.date, "");
  assert.equal(
    Object.hasOwn(normalized.scenarios[0].selections, "__proto__"),
    true,
  );
  assert.equal(
    scenarioTotal(normalized.scenarios[0], normalized.suppliers),
    50,
  );
});
test("local persistence round-trips data and survives unavailable storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map();
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    });
    const data = createEmptyData();
    data.wedding.couple = "A & B";
    assert.equal(saveData(data), true);
    assert.ok(values.has(STORAGE_KEY));
    assert.deepEqual(loadData(), data);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("Unavailable");
      },
    });
    assert.equal(saveData(data), false);
    assert.deepEqual(loadData(), createEmptyData());
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("old version-one data gains empty guests and a null planning profile without changing the estimate", () => {
  const legacy = createEmptyData();
  delete legacy.guestsList;
  delete legacy.planningProfile;
  legacy.wedding.guests = 120;
  const normalized = normalizeStorage(JSON.stringify(legacy));
  assert.deepEqual(normalized.guestsList, []);
  assert.equal(normalized.planningProfile, null);
  assert.equal(normalized.wedding.guests, 120);
  assert.equal(createInitialData().planningProfile, null);
  assert.deepEqual(createInitialData().guestsList, []);
});

test("guest normalization removes duplicate and invalid records, clamps party sizes and strips unknown fields", () => {
  const input = createEmptyData();
  input.guestsList = [
    {
      id: "a",
      name: " Ana e família ",
      phone: " 11 90000-0000 ",
      partySize: 3,
      status: "confirmed",
      notes: " Sem glúten ",
      apiKey: "private",
      password: "private",
    },
    { id: "a", name: "Duplicate", partySize: 99, status: "pending" },
    {
      id: "b",
      name: "Bruno",
      partySize: Infinity,
      status: "other",
      notes: null,
    },
    { id: "c", name: "Carla", partySize: -1, status: "declined" },
    { id: "d", name: "Davi", partySize: 9000, status: "pending" },
    { id: "e", name: "Eva", partySize: 2.4, status: "pending" },
    { id: "bad", name: "  ", partySize: 1 },
    null,
    { id: "", name: "Missing ID" },
  ];
  const result = normalizeStorage(input);
  assert.equal(result.guestsList.length, 5);
  assert.deepEqual(result.guestsList[0], {
    id: "a",
    name: "Ana e família",
    phone: "11 90000-0000",
    partySize: 3,
    status: "confirmed",
    notes: "Sem glúten",
  });
  assert.deepEqual(
    result.guestsList.map((guest) => guest.partySize),
    [3, 1, 1, 1000, 2],
  );
  assert.equal(result.guestsList[1].status, "pending");
  assert.equal(
    result.wedding.guests,
    0,
    "The guest register must not replace the planning estimate.",
  );
  assert.ok(
    result.guestsList.every(
      (guest) =>
        Number.isInteger(guest.partySize) &&
        guest.partySize >= 1 &&
        guest.partySize <= 1000,
    ),
  );
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("guest limits and planning profile survive normalization with finite values and only declared fields", () => {
  const data = createEmptyData();
  data.guestsList = Array.from({ length: 10001 }, (_, index) => ({
    id: `guest-${index}`,
    name: `Guest ${index}`,
    partySize: 1,
    status: "pending",
  }));
  data.planningProfile = {
    description: " Jardim simples ",
    location: " Campinas, SP ",
    radiusKm: 35.5,
    priorities: " Flores e fotografia ",
    apiKey: "secret",
  };
  let normalized = normalizeStorage(data);
  assert.equal(normalized.guestsList.length, 10000);
  assert.deepEqual(normalized.planningProfile, {
    description: "Jardim simples",
    location: "Campinas, SP",
    radiusKm: 35.5,
    priorities: "Flores e fotografia",
  });
  data.planningProfile = {
    description: {},
    location: null,
    radiusKm: NaN,
    priorities: false,
  };
  normalized = normalizeStorage(data);
  assert.deepEqual(normalized.planningProfile, {
    description: "",
    location: "",
    radiusKm: undefined,
    priorities: "",
  });
  data.planningProfile = ["bad"];
  assert.equal(normalizeStorage(data).planningProfile, null);
});

test("an optional planning radius stays unlimited across save/reload and only accepts 1 through 500 km", () => {
  const data = createEmptyData();
  const profile = {
    description: "Festa no jardim",
    location: "Campinas, SP",
    priorities: "Fotografia",
  };
  for (const value of [undefined, null, "", "   "]) {
    data.planningProfile = { ...profile, radiusKm: value };
    const normalized = normalizeStorage(data);
    assert.equal(normalized.planningProfile.radiusKm, undefined);
    const reloaded = normalizeStorage(JSON.stringify(normalized));
    assert.equal(
      reloaded.planningProfile.radiusKm,
      undefined,
      "Reload must not silently add a distance limit.",
    );
    assert.equal(reloaded.planningProfile.location, profile.location);
  }
  for (const value of [1, 35.5, 500, "30"]) {
    data.planningProfile = { ...profile, radiusKm: value };
    const reloaded = normalizeStorage(JSON.stringify(normalizeStorage(data)));
    assert.equal(reloaded.planningProfile.radiusKm, Number(value));
  }
  for (const value of [0, -10, 501, Infinity, NaN, "invalid", true]) {
    data.planningProfile = { ...profile, radiusKm: value };
    assert.equal(normalizeStorage(data).planningProfile.radiusKm, undefined);
  }
});

test("fresh launches are empty and the explicit clean start clears only planning data exactly once", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map([
    [STORAGE_KEY, JSON.stringify(createInitialData())],
    [
      "weeding-calculator-draft-v1",
      JSON.stringify({ name: "Old draft", selections: { local: "demo" } }),
    ],
    [
      "weeding-calculator-ai-history-v1",
      JSON.stringify({ messages: [{ text: "Old conversation" }] }),
    ],
    ["unrelated-app-data", "keep"],
    ["sim-ai-session", "keep-api-session"],
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    assert.equal(prepareFreshStart(), true);
    assert.equal(values.get(FRESH_START_KEY), "done");
    assert.equal(values.has(STORAGE_KEY), false);
    assert.equal(values.has("weeding-calculator-draft-v1"), false);
    assert.equal(values.has("weeding-calculator-ai-history-v1"), false);
    assert.equal(values.get("unrelated-app-data"), "keep");
    assert.equal(values.get("sim-ai-session"), "keep-api-session");
    const blank = loadData();
    assert.equal(blank.wedding.guests, 0);
    assert.equal(blank.wedding.budget, 0);
    assert.equal(blank.wedding.date, "");
    assert.deepEqual(blank.suppliers, []);
    assert.deepEqual(blank.scenarios, []);
    assert.deepEqual(blank.guestsList, []);
    assert.equal(blank.planningProfile, null);
    assert.equal(blank.isDemo, false);
    assert.equal(blank.categories.length, 12);
    const newData = createEmptyData();
    newData.wedding.couple = "Meus novos planos";
    assert.equal(saveData(newData), true);
    storage.setItem("weeding-calculator-draft-v1", "new draft");
    storage.setItem("weeding-calculator-ai-history-v1", "new conversation");
    assert.equal(prepareFreshStart(), false);
    assert.deepEqual(loadData(), newData);
    assert.equal(values.get("weeding-calculator-draft-v1"), "new draft");
    assert.equal(
      values.get("weeding-calculator-ai-history-v1"),
      "new conversation",
    );
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

import { createEmptyData } from "./demo.js";
export const STORAGE_KEY = "sim-wedding-planner-v1";
export const FRESH_START_KEY = "weeding-calculator-clean-start-v2";
const planningKeys = [
  STORAGE_KEY,
  "weeding-calculator-draft-v1",
  "weeding-calculator-ai-history-v1",
];
const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value, fallback = "", max = 5000) =>
  typeof value === "string" ? value.trim().slice(0, max) : fallback;
const numeric = (value, fallback, max = 1_000_000_000) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, max)
    : fallback;
const identifier = (value) => text(value, "", 200);
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return "";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : "";
};
/** Accepts a saved object or JSON string. Broken records are discarded; usable data survives. */
export function normalizeStorage(input) {
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (
    !isRecord(input) ||
    input.version !== 1 ||
    !Array.isArray(input.categories) ||
    !Array.isArray(input.suppliers) ||
    !Array.isArray(input.scenarios)
  )
    return null;
  const categories = [];
  const categoryIds = new Set();
  for (const value of input.categories.slice(0, 250)) {
    if (!isRecord(value)) continue;
    const id = identifier(value.id);
    const name = text(value.name, "", 100);
    if (!id || !name || categoryIds.has(id)) continue;
    categoryIds.add(id);
    categories.push({
      id,
      name,
      icon: text(value.icon, "Heart", 50) || "Heart",
    });
  }
  const suppliers = [];
  const supplierIds = new Set();
  for (const value of input.suppliers.slice(0, 20000)) {
    if (!isRecord(value)) continue;
    const id = identifier(value.id);
    const categoryId = identifier(value.categoryId);
    const name = text(value.name, "", 200);
    if (
      !id ||
      !name ||
      !categoryIds.has(categoryId) ||
      supplierIds.has(id) ||
      typeof value.price !== "number" ||
      !Number.isFinite(value.price) ||
      value.price < 0
    )
      continue;
    supplierIds.add(id);
    suppliers.push({
      id,
      categoryId,
      name,
      price: Math.round(numeric(value.price, 0) * 100) / 100,
      phone: text(value.phone, "", 100),
      favorite: value.favorite === true,
      rating: numeric(value.rating, 0, 5),
      notes: text(value.notes),
    });
  }
  const supplierMap = new Map(
    suppliers.map((supplier) => [supplier.id, supplier]),
  );
  const scenarios = [];
  const scenarioIds = new Set();
  for (const value of input.scenarios.slice(0, 500)) {
    if (!isRecord(value)) continue;
    const id = identifier(value.id);
    const name = text(value.name, "", 200);
    if (!id || !name || scenarioIds.has(id)) continue;
    scenarioIds.add(id);
    const selections = {};
    if (isRecord(value.selections)) {
      for (const [categoryId, supplierId] of Object.entries(value.selections)) {
        if (
          typeof supplierId === "string" &&
          categoryIds.has(categoryId) &&
          supplierMap.get(supplierId)?.categoryId === categoryId
        ) {
          Object.defineProperty(selections, categoryId, {
            value: supplierId,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
      }
    }
    scenarios.push({
      id,
      name,
      description: text(value.description),
      selections,
      createdAt:
        typeof value.createdAt === "string" &&
        Number.isFinite(Date.parse(value.createdAt))
          ? new Date(value.createdAt).toISOString()
          : new Date(0).toISOString(),
      source: value.source === "ai" ? "ai" : "manual",
    });
  }
  const guestsList = [];
  const guestIds = new Set();
  for (const value of Array.isArray(input.guestsList)
    ? input.guestsList.slice(0, 10000)
    : []) {
    if (!isRecord(value)) continue;
    const id = identifier(value.id);
    const name = text(value.name, "", 200);
    if (!id || !name || guestIds.has(id)) continue;
    guestIds.add(id);
    guestsList.push({
      id,
      name,
      phone: text(value.phone, "", 100),
      partySize: Math.max(1, Math.round(numeric(value.partySize, 1, 1000))),
      status: ["pending", "confirmed", "declined"].includes(value.status)
        ? value.status
        : "pending",
      notes: text(value.notes, "", 2000),
    });
  }
  const profile = isRecord(input.planningProfile)
    ? input.planningProfile
    : null;
  const rawRadius = profile?.radiusKm;
  const radius =
    typeof rawRadius === "number" || typeof rawRadius === "string"
      ? Number(rawRadius)
      : NaN;
  const radiusKm =
    rawRadius !== "" &&
    rawRadius != null &&
    Number.isFinite(radius) &&
    radius >= 1 &&
    radius <= 500
      ? radius
      : undefined;
  const planningProfile = profile
    ? {
        description: text(profile.description, "", 5000),
        location: text(profile.location, "", 300),
        radiusKm,
        priorities: text(profile.priorities, "", 3000),
      }
    : null;
  const wedding = isRecord(input.wedding) ? input.wedding : {};
  return {
    version: 1,
    wedding: {
      couple: text(wedding.couple, "", 200),
      date: validDate(wedding.date),
      guests: Math.round(numeric(wedding.guests, 0, 100000)),
      budget: Math.round(numeric(wedding.budget, 0) * 100) / 100,
    },
    categories,
    suppliers,
    scenarios,
    guestsList,
    planningProfile,
    isDemo: input.isDemo === true,
  };
}
export function loadData() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return (stored ? normalizeStorage(stored) : null) ?? createEmptyData();
  } catch {
    return createEmptyData();
  }
}
/** Applies the user's requested clean start once, without touching unrelated data or API sessions. */
export function prepareFreshStart() {
  try {
    const storage = globalThis.localStorage;
    if (!storage || storage.getItem(FRESH_START_KEY) === "done") return false;
    for (const key of planningKeys) storage.removeItem(key);
    storage.setItem(FRESH_START_KEY, "done");
    return true;
  } catch {
    return false;
  }
}
/** False means storage is unavailable or full; callers can show a persistence warning. */
export function saveData(data) {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

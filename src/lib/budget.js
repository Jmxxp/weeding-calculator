const validPrice = (price) =>
  Number.isFinite(price) && price >= 0 ? price : 0;
const validRating = (rating) =>
  Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : 0;
const stableName = (a, b) =>
  a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id);
const byQuality = (a, b) =>
  validRating(b.rating) - validRating(a.rating) ||
  validPrice(a.price) - validPrice(b.price) ||
  stableName(a, b);
const byPrice = (a, b) =>
  validPrice(a.price) - validPrice(b.price) || byQuality(a, b);
/**
 * One supplier per category. Cost-benefit score = 65% personal rating (rating / 5)
 * + 35% price efficiency ((maximum - price) / (maximum - minimum)) in that category.
 * Equal prices receive the same full price score; ties favor rating, price, then name/id.
 * Favorites always prefer a starred supplier, then rating and price. Without a star,
 * the best-rated supplier is selected, with the cheaper option breaking a tie.
 */
export function generateStrategies(data) {
  const createdAt = new Date().toISOString();
  const strategies = [
    {
      id: "strategy-cheapest",
      name: "Mais econômico",
      description: "A opção de menor preço em cada categoria.",
      selections: {},
      source: "manual",
      createdAt,
    },
    {
      id: "strategy-balanced",
      name: "Custo-benefício",
      description:
        "Equilibra sua avaliação (65%) e o preço dentro de cada categoria (35%).",
      selections: {},
      source: "manual",
      createdAt,
    },
    {
      id: "strategy-favorites",
      name: "Casamento favorito",
      description:
        "Prioriza as opções com estrela. Sem favoritos, escolhe a maior avaliação e depois o menor preço.",
      selections: {},
      source: "manual",
      createdAt,
    },
  ];
  for (const category of data.categories) {
    const options = data.suppliers.filter(
      (supplier) =>
        supplier.categoryId === category.id &&
        Number.isFinite(supplier.price) &&
        supplier.price >= 0,
    );
    if (!options.length) continue;
    const cheapest = [...options].sort(byPrice)[0];
    const prices = options.map((supplier) => supplier.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const score = (supplier) =>
      (validRating(supplier.rating) / 5) * 0.65 +
      (max === min ? 1 : (max - supplier.price) / (max - min)) * 0.35;
    const balanced = [...options].sort(
      (a, b) => score(b) - score(a) || byQuality(a, b),
    )[0];
    const starred = options.filter((supplier) => supplier.favorite);
    const favorite = [...(starred.length ? starred : options)].sort(
      byQuality,
    )[0];
    [cheapest, balanced, favorite].forEach((supplier, index) => {
      Object.defineProperty(strategies[index].selections, category.id, {
        value: supplier.id,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    });
  }
  return strategies;
}
/** Ignores missing, mismatched and invalid selections instead of producing NaN. */
export function scenarioTotal(scenario, suppliers) {
  const byId = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const total = Object.entries(scenario.selections).reduce(
    (sum, [categoryId, supplierId]) => {
      const supplier = byId.get(supplierId);
      return supplier?.categoryId === categoryId
        ? sum + validPrice(supplier.price)
        : sum;
    },
    0,
  );
  return Math.round((total + Number.EPSILON) * 100) / 100;
}
export function resolveScenario(scenario, data) {
  const items = data.categories.map((category) => ({
    category,
    supplier: data.suppliers.find(
      (supplier) =>
        supplier.id === scenario.selections[category.id] &&
        supplier.categoryId === category.id &&
        Number.isFinite(supplier.price) &&
        supplier.price >= 0,
    ),
  }));
  const missingCategories = items
    .filter((item) => !item.supplier)
    .map((item) => item.category);
  const total = items.reduce(
    (sum, item) => sum + (item.supplier?.price ?? 0),
    0,
  );
  return {
    items,
    total: Math.round((total + Number.EPSILON) * 100) / 100,
    selectedCount: items.length - missingCategories.length,
    missingCategories,
    isComplete: data.categories.length > 0 && missingCategories.length === 0,
  };
}

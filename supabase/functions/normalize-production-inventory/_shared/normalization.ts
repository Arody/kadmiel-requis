export type BaseUnit = "g" | "ml" | "pieza";

export type InventoryCandidate = Record<string, unknown> & {
  id?: unknown;
  inventory_id?: unknown;
  item_name?: unknown;
  name?: unknown;
  presentation?: unknown;
  total_price?: unknown;
  unit?: unknown;
  unit_price?: unknown;
};

export type InventoryNormalization = {
  inventory_id: string;
  base_unit: BaseUnit;
  base_quantity_per_presentation: number;
  base_unit_cost: number | null;
  normalization_source: "deterministic" | "minimax";
  normalization_model: "MiniMax-M3" | null;
};

type UnitInfo = { baseUnit: BaseUnit; factor: number };

const UNIT_TO_BASE: Record<string, UnitInfo> = {
  mg: { baseUnit: "g", factor: 0.001 },
  mgs: { baseUnit: "g", factor: 0.001 },
  miligramo: { baseUnit: "g", factor: 0.001 },
  miligramos: { baseUnit: "g", factor: 0.001 },
  kg: { baseUnit: "g", factor: 1_000 },
  kgs: { baseUnit: "g", factor: 1_000 },
  kilo: { baseUnit: "g", factor: 1_000 },
  kilos: { baseUnit: "g", factor: 1_000 },
  kilogramo: { baseUnit: "g", factor: 1_000 },
  kilogramos: { baseUnit: "g", factor: 1_000 },
  g: { baseUnit: "g", factor: 1 },
  gr: { baseUnit: "g", factor: 1 },
  grs: { baseUnit: "g", factor: 1 },
  gramo: { baseUnit: "g", factor: 1 },
  gramos: { baseUnit: "g", factor: 1 },
  oz: { baseUnit: "g", factor: 28.3495 },
  onza: { baseUnit: "g", factor: 28.3495 },
  onzas: { baseUnit: "g", factor: 28.3495 },
  lb: { baseUnit: "g", factor: 453.592 },
  lbs: { baseUnit: "g", factor: 453.592 },
  libra: { baseUnit: "g", factor: 453.592 },
  libras: { baseUnit: "g", factor: 453.592 },
  l: { baseUnit: "ml", factor: 1_000 },
  lt: { baseUnit: "ml", factor: 1_000 },
  lts: { baseUnit: "ml", factor: 1_000 },
  ltr: { baseUnit: "ml", factor: 1_000 },
  ltrs: { baseUnit: "ml", factor: 1_000 },
  lto: { baseUnit: "ml", factor: 1_000 },
  ltos: { baseUnit: "ml", factor: 1_000 },
  ltro: { baseUnit: "ml", factor: 1_000 },
  ltros: { baseUnit: "ml", factor: 1_000 },
  litro: { baseUnit: "ml", factor: 1_000 },
  litros: { baseUnit: "ml", factor: 1_000 },
  dl: { baseUnit: "ml", factor: 100 },
  decilitro: { baseUnit: "ml", factor: 100 },
  decilitros: { baseUnit: "ml", factor: 100 },
  cl: { baseUnit: "ml", factor: 10 },
  centilitro: { baseUnit: "ml", factor: 10 },
  centilitros: { baseUnit: "ml", factor: 10 },
  ml: { baseUnit: "ml", factor: 1 },
  mls: { baseUnit: "ml", factor: 1 },
  cc: { baseUnit: "ml", factor: 1 },
  mililitro: { baseUnit: "ml", factor: 1 },
  mililitros: { baseUnit: "ml", factor: 1 },
  pieza: { baseUnit: "pieza", factor: 1 },
  piezas: { baseUnit: "pieza", factor: 1 },
  pz: { baseUnit: "pieza", factor: 1 },
  pza: { baseUnit: "pieza", factor: 1 },
  pzas: { baseUnit: "pieza", factor: 1 },
  unidad: { baseUnit: "pieza", factor: 1 },
  unidades: { baseUnit: "pieza", factor: 1 },
  u: { baseUnit: "pieza", factor: 1 },
};

const MEASUREMENT_UNIT_PATTERN =
  "miligramos?|mgs?|mg|kilogramos?|kgs?|kilos?|kg|libras?|lbs?|onzas?|oz|gramos?|grs?|gr|g|mililitros?|mls?|ml|cc|centilitros?|cl|decilitros?|dl|litros?|ltros?|ltos?|ltrs?|ltr|lts?|lt|l|piezas?|pzas?|pza|pz|unidades?|unidad|u";
const COUNT_WORD_PATTERN =
  "cajas?|paquetes?|packs?|botes?|botellas?|latas?|bolsas?|sobres?|rollos?|barras?|piezas?|pzas?|pza|pz|unidades?|unidad|frascos?|envases?|garrafones?|charolas?|cubetas?|sacos?|costales?|tubos?";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizeFractions = (value: string) =>
  value
    .replace(/(\d+)\s*½/g, (_, whole: string) => `${Number(whole) + 0.5}`)
    .replace(/(\d+)\s*¼/g, (_, whole: string) => `${Number(whole) + 0.25}`)
    .replace(/(\d+)\s*¾/g, (_, whole: string) => `${Number(whole) + 0.75}`)
    .replace(/½/g, "0.5")
    .replace(/¼/g, "0.25")
    .replace(/¾/g, "0.75")
    .replace(
      /\b(\d+)\s+(\d+)\s*\/\s*([2348])\b/g,
      (match, whole: string, numerator: string, denominator: string) => {
        const fraction = Number(numerator) / Number(denominator);
        return fraction < 1 ? `${Number(whole) + fraction}` : match;
      },
    )
    .replace(
      /\b(\d+)\s*\/\s*([2348])\b/g,
      (match, numerator: string, denominator: string) => {
        const fraction = Number(numerator) / Number(denominator);
        return fraction < 1 ? `${fraction}` : match;
      },
    );

const normalizeText = (value: string) =>
  normalizeFractions(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[×✕]/g, "x")
    .replace(/\s+/g, " ")
    .trim();

const unitInfo = (value: unknown): UnitInfo | null => {
  if (typeof value !== "string") return null;
  return UNIT_TO_BASE[normalizeText(value).replace(/\./g, "").trim()] ?? null;
};

const positiveNumber = (value: unknown): number | null => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.replace(",", "."))
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const countMultiplier = (presentation: string) => {
  const counts: number[] = [];
  const countRegex = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(?:x\\s*)?(${COUNT_WORD_PATTERN})\\b`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = countRegex.exec(presentation)) !== null) {
    const count = positiveNumber(match[1]);
    if (count) counts.push(count);
  }

  const xRegex = /(\d+(?:\.\d+)?)\s*x\s*(?=\d)/g;
  while ((match = xRegex.exec(presentation)) !== null) {
    const count = positiveNumber(match[1]);
    if (count) counts.push(count);
  }

  const slashRegex = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*\\/\\s*(?=\\d+(?:\\.\\d+)?\\s*(?:${MEASUREMENT_UNIT_PATTERN})\\b)`,
    "g",
  );
  while ((match = slashRegex.exec(presentation)) !== null) {
    const count = positiveNumber(match[1]);
    if (count) counts.push(count);
  }

  return counts.reduce((total, count) => total * count, 1);
};

export const parsePresentationToBase = (
  presentation: unknown,
): { quantity: number; unit: BaseUnit } | null => {
  if (typeof presentation !== "string" || !presentation.trim()) return null;
  const normalized = normalizeText(presentation);
  const measurementRegex = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(${MEASUREMENT_UNIT_PATTERN})\\b`,
    "g",
  );
  const measurements: Array<{ quantity: number; unit: BaseUnit; index: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = measurementRegex.exec(normalized)) !== null) {
    const quantity = positiveNumber(match[1]);
    const info = unitInfo(match[2]);
    if (!quantity || !info) continue;
    measurements.push({
      quantity: quantity * info.factor,
      unit: info.baseUnit,
      index: match.index,
    });
  }

  const measurable = measurements.filter(({ unit }) => unit !== "pieza");
  const declaredTotal = measurable.find(({ index }) =>
    /(?:contenido|peso|volumen)?\s*neto\s*:?\s*$|total\s*:?\s*$/.test(
      normalized.slice(Math.max(0, index - 30), index),
    ),
  );
  if (declaredTotal) {
    return { quantity: declaredTotal.quantity, unit: declaredTotal.unit };
  }

  const content = measurable.at(-1);
  if (content) {
    return {
      quantity: content.quantity * countMultiplier(normalized),
      unit: content.unit,
    };
  }

  const pieces = measurements.find(({ unit }) => unit === "pieza");
  if (pieces) return { quantity: pieces.quantity, unit: "pieza" };

  const count = countMultiplier(normalized);
  return count > 1 ? { quantity: count, unit: "pieza" } : null;
};

export const getInventoryId = (candidate: InventoryCandidate): string | null => {
  const id = candidate.inventory_id ?? candidate.id;
  return typeof id === "string" && UUID_PATTERN.test(id) ? id.toLowerCase() : null;
};

const buildNormalization = (
  candidate: InventoryCandidate,
  quantity: { quantity: number; unit: BaseUnit },
  source: "deterministic" | "minimax",
): InventoryNormalization | null => {
  const inventoryId = getInventoryId(candidate);
  if (!inventoryId || !Number.isFinite(quantity.quantity) || quantity.quantity <= 0) return null;
  const catalogCost = positiveNumber(candidate.total_price) ?? positiveNumber(candidate.unit_price);
  return {
    inventory_id: inventoryId,
    base_unit: quantity.unit,
    base_quantity_per_presentation: quantity.quantity,
    base_unit_cost: catalogCost === null ? null : catalogCost / quantity.quantity,
    normalization_source: source,
    normalization_model: source === "minimax" ? "MiniMax-M3" : null,
  };
};

export const normalizeInventoryCandidate = (
  candidate: InventoryCandidate,
): InventoryNormalization | null => {
  const parsedPresentation = parsePresentationToBase(candidate.presentation);
  const declaredUnit = unitInfo(candidate.unit);
  const totalPrice = positiveNumber(candidate.total_price);
  const unitPrice = positiveNumber(candidate.unit_price);
  const priceRatio =
    totalPrice && unitPrice && declaredUnit
      ? {
          quantity: (totalPrice / unitPrice) * declaredUnit.factor,
          unit: declaredUnit.baseUnit,
        }
      : null;

  if (parsedPresentation) {
    if (
      parsedPresentation.unit === "pieza" &&
      declaredUnit &&
      declaredUnit.baseUnit !== "pieza"
    ) {
      return priceRatio ? buildNormalization(candidate, priceRatio, "deterministic") : null;
    }
    return buildNormalization(candidate, parsedPresentation, "deterministic");
  }

  if (priceRatio) return buildNormalization(candidate, priceRatio, "deterministic");

  const presentation =
    typeof candidate.presentation === "string" ? candidate.presentation.trim() : "";
  if (declaredUnit && (!presentation || !totalPrice)) {
    return buildNormalization(
      candidate,
      { quantity: declaredUnit.factor, unit: declaredUnit.baseUnit },
      "deterministic",
    );
  }

  return null;
};

export const validateAiNormalizations = (
  value: unknown,
  candidates: InventoryCandidate[],
): InventoryNormalization[] => {
  const rawItems = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : [];
  const candidatesById = new Map(
    candidates.flatMap((candidate) => {
      const id = getInventoryId(candidate);
      return id ? [[id, candidate] as const] : [];
    }),
  );
  const seen = new Set<string>();
  const normalizations: InventoryNormalization[] = [];

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    const rawId = item.inventory_id ?? item.id;
    const id = typeof rawId === "string" ? rawId.toLowerCase() : "";
    const baseUnit = item.base_unit;
    const quantity = item.base_quantity_per_presentation;
    const candidate = candidatesById.get(id);
    if (
      !UUID_PATTERN.test(id) ||
      seen.has(id) ||
      !candidate ||
      (baseUnit !== "g" && baseUnit !== "ml" && baseUnit !== "pieza") ||
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      continue;
    }

    const normalization = buildNormalization(
      candidate,
      { quantity, unit: baseUnit },
      "minimax",
    );
    if (normalization) {
      seen.add(id);
      normalizations.push(normalization);
    }
  }

  return normalizations;
};

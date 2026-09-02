import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeInventoryCandidate,
  parsePresentationToBase,
  validateAiNormalizations,
} from "./normalization.ts";

test("normaliza presentaciones y rechaza respuestas inseguras", () => {
  assert.deepEqual(parsePresentationToBase("Caja con 12 pz de 1ltr"), {
    quantity: 12_000,
    unit: "ml",
  });
  assert.deepEqual(parsePresentationToBase("20 bolsas de 500 g"), {
    quantity: 10_000,
    unit: "g",
  });
  assert.deepEqual(parsePresentationToBase("Caja 6/750 ml"), {
    quantity: 4_500,
    unit: "ml",
  });
  assert.deepEqual(parsePresentationToBase("caja c/24 pzas"), {
    quantity: 24,
    unit: "pieza",
  });

  const candidate = {
    inventory_id: "08f5aee8-4cbd-47af-bb0c-e5aa3ba85955",
    presentation: "Caja con 12 pz de 1ltr",
    unit: "L",
    unit_price: 25.25,
    total_price: 303,
  };
  const normalized = normalizeInventoryCandidate(candidate);
  assert.equal(normalized?.base_quantity_per_presentation, 12_000);
  assert.equal(normalized?.base_unit_cost, 303 / 12_000);

  assert.deepEqual(
    validateAiNormalizations(
      {
        items: [
          {
            inventory_id: candidate.inventory_id,
            base_unit: "g",
            base_quantity_per_presentation: 2_000,
            base_unit_cost: 0.00001,
          },
          {
            inventory_id: "7d156136-e6f0-4584-8372-e085ca6a6a4a",
            base_unit: "ml",
            base_quantity_per_presentation: 9_999,
          },
          {
            inventory_id: candidate.inventory_id,
            base_unit: "kg",
            base_quantity_per_presentation: 2,
          },
        ],
      },
      [candidate],
    ),
    [
      {
        inventory_id: candidate.inventory_id,
        base_unit: "g",
        base_quantity_per_presentation: 2_000,
        base_unit_cost: 303 / 2_000,
        normalization_source: "minimax",
        normalization_model: "MiniMax-M3",
      },
    ],
  );
});

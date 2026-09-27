import test from "node:test";
import assert from "node:assert/strict";
import { clampearIndice } from "./clampearIndice.ts";

test("G. índice fuera de rango tras reducirse la lista (5→2, indice=3) → se corrige a 0", () => {
  assert.equal(clampearIndice(3, 2), 0);
});

test("índice dentro de rango → se mantiene igual (no resetea innecesariamente)", () => {
  assert.equal(clampearIndice(1, 2), 1);
});

test("lista vacía → 0", () => {
  assert.equal(clampearIndice(4, 0), 0);
});

test("índice exactamente en el límite (== longitud) → fuera de rango, se corrige", () => {
  assert.equal(clampearIndice(2, 2), 0);
});

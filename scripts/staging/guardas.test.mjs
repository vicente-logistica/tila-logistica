// Tests de las guardas de staging. Ejecutar: node --test scripts/staging/guardas.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { asegurarNoProduccion, enmascarar } from "./guardas.mjs";

const staging = { TILA_ENTORNO: "staging", TILA_STAGING_SUPABASE_REF: "abcdefgh1234" };
const PROD = "https://imbtepvdscdtpxkleihi.supabase.co";

test("sin TILA_ENTORNO → aborta", () => {
  assert.throws(() => asegurarNoProduccion("http://127.0.0.1:4545", { env: {} }), /TILA_ENTORNO/);
  assert.throws(() => asegurarNoProduccion("http://127.0.0.1:4545", { env: { TILA_ENTORNO: "production" } }), /TILA_ENTORNO/);
});
test("PRODUCCIÓN: aborta aunque TILA_ENTORNO sea staging y aunque el ref esté (mal) en la lista", () => {
  assert.throws(() => asegurarNoProduccion(PROD, { env: staging }), /PRODUCCIÓN/);
  assert.throws(() => asegurarNoProduccion(PROD, { env: { ...staging, TILA_STAGING_SUPABASE_REF: "imbtepvdscdtpxkleihi" } }), /PRODUCCIÓN/);
  assert.throws(() => asegurarNoProduccion("https://tila-logistica.vercel.app", { env: staging }), /PRODUCCIÓN/);
  assert.throws(() => asegurarNoProduccion("https://imbtepvdscdtpxkleihi.supabase.co/rest/v1", { env: { TILA_ENTORNO: "local" } }), /PRODUCCIÓN/);
});
test("proyecto Supabase NO declarado en la lista → aborta", () => {
  assert.throws(() => asegurarNoProduccion("https://otroproyecto.supabase.co", { env: staging }), /no está en TILA_STAGING_SUPABASE_REF/);
  assert.throws(() => asegurarNoProduccion("https://otroproyecto.supabase.co", { env: { TILA_ENTORNO: "staging" } }), /no está en TILA_STAGING_SUPABASE_REF/);
});
test("proyecto declarado explícitamente → permitido", () => {
  assert.deepEqual(asegurarNoProduccion("https://abcdefgh1234.supabase.co", { env: staging }), { host: "abcdefgh1234.supabase.co", local: false });
});
test("local (127.x / localhost) → permitido con TILA_ENTORNO local o staging", () => {
  assert.equal(asegurarNoProduccion("http://127.0.0.1:4545", { env: { TILA_ENTORNO: "local" } }).local, true);
  assert.equal(asegurarNoProduccion("http://localhost:54321", { env: staging }).local, true);
});
test("hosts que no son Supabase ni locales → aborta", () => {
  assert.throws(() => asegurarNoProduccion("https://example.com", { env: staging }), /no reconocido/);
  assert.throws(() => asegurarNoProduccion("https://abcdefgh1234.supabase.co.evil.example", { env: staging }), /no reconocido/);
});
test("URL inválida → aborta", () => { assert.throws(() => asegurarNoProduccion("no-es-url", { env: staging }), /inválida/); });
test("enmascarar no revela la clave", () => {
  const k = "eyJhbGciOiJIUzI1NiJ9.super-secreta-1234567890";
  assert.doesNotMatch(enmascarar(k), /super-secreta/);
  assert.equal(enmascarar(""), "(vacío)");
});

import { asegurarAppNoProduccion } from "./guardas.mjs";
test("app: producción abortada; local permitido; host no declarado abortado; host declarado permitido", () => {
  assert.throws(() => asegurarAppNoProduccion("https://tila-logistica.vercel.app", { env: staging }), /PRODUCCIÓN/);
  assert.throws(() => asegurarAppNoProduccion("https://preview.tila-logistica.vercel.app", { env: staging }), /PRODUCCIÓN/);
  assert.equal(asegurarAppNoProduccion("http://127.0.0.2:3133", { env: { TILA_ENTORNO: "local" } }).local, true);
  assert.throws(() => asegurarAppNoProduccion("https://tila-staging.vercel.app", { env: staging }), /TILA_STAGING_APP_HOSTS/);
  assert.equal(asegurarAppNoProduccion("https://tila-staging.vercel.app", { env: { ...staging, TILA_STAGING_APP_HOSTS: "tila-staging.vercel.app" } }).local, false);
  assert.throws(() => asegurarAppNoProduccion("http://localhost:3000", { env: {} }), /TILA_ENTORNO/);
});

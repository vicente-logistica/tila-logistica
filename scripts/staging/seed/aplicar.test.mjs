// Tests LOCALES de los errores de aplicar.mjs. Corre el script real contra 127.0.0.1 (puerto cerrado o servidor HTTP falso en este mismo proceso): sin Supabase, sin staging, sin producción, sin claves reales.
// Ejecutar: node --test scripts/staging/seed/aplicar.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "aplicar.mjs");
const CLAVE = "sb_secret_TEST0123456789abcdefABCDEF";
const envBase = (url) => ({ PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", TILA_ENTORNO: "local", STAGING_SUPABASE_URL: url, STAGING_SERVICE_ROLE_KEY: CLAVE });

// cwd = carpeta temporal: aplicar.mjs lee ".env.staging" del cwd y aquí NO debe existir.
const correr = (url, args = ["--aplicar"]) => new Promise((res) => {
  const p = spawn(process.execPath, [SCRIPT, ...args], { cwd: os.tmpdir(), env: envBase(url), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = ""; p.stdout.on("data", (d) => { stdout += d; }); p.stderr.on("data", (d) => { stderr += d; });
  const t = setTimeout(() => p.kill(), 60000); p.once("exit", (codigo) => { clearTimeout(t); res({ codigo, stdout, stderr }); });
});
const puertoCerrado = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const errores = (r) => r.stderr.split(/\r?\n/).filter((l) => l.startsWith("[error]"));

test("fallo de red (puerto cerrado): exit 1 y se muestran name, message y cause.code (ECONNREFUSED), sin volcar stack ni clave", async () => {
  const r = await correr(`http://127.0.0.1:${await puertoCerrado()}`); const e = errores(r).join("\n");
  assert.equal(r.codigo, 1, r.stderr);
  assert.match(e, /\[error\] name: \w+/); assert.match(e, /\[error\] message: \[storage documentacion-choferes\/.+\] /);
  assert.match(e, /\[error\] cause(\.cause)*\.code: ECONNREFUSED/, e); assert.match(e, /\[error\] cause(\.cause)*\.message: /);
  assert.match(r.stdout, /bucket documentacion-choferes: \(.*causa: ECONNREFUSED\)/, "el aviso de createBucket ya no oculta la causa");
  assert.ok(!/\n\s+at /.test(r.stderr), "sin stack trace"); assert.match(r.stderr, /El seed NO terminó/);
  assert.ok(!(r.stdout + r.stderr).includes(CLAVE), "la clave no aparece");
  assert.ok(!/✔ usuarios:/.test(r.stdout), "no llegó a escribir tablas");
});
test("una respuesta con la clave / Authorization / cookie en el cuerpo se imprime REDACTADA (mensaje y causas)", async () => {
  const srv = http.createServer((req, res) => { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ message: `clave rechazada ${CLAVE} Authorization: Bearer ${CLAVE}`, error: `cookie: sb-access-token=abc123secreto apikey=${CLAVE}` })); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const r = await correr(`http://127.0.0.1:${srv.address().port}`); const todo = r.stdout + "\n" + r.stderr;
    assert.equal(r.codigo, 1, todo); assert.match(r.stderr, /\[error\] message: \[storage /);
    assert.ok(!todo.includes(CLAVE), "clave redactada"); assert.ok(!todo.includes("abc123secreto"), "cookie redactada"); assert.ok(/\[REDACTADO\]/.test(todo));
    assert.ok(!/authorization:\s*bearer/i.test(todo), "sin Authorization visible");
  } finally { await new Promise((r) => srv.close(r)); }
});
test("dry-run (sin --aplicar) no toca la red y sigue saliendo con exit 0", async () => {
  const r = await correr(`http://127.0.0.1:${await puertoCerrado()}`, []); assert.equal(r.codigo, 0, r.stderr); assert.match(r.stdout, /DRY-RUN: no se escribió nada/); assert.equal(errores(r).length, 0);
});
test("auditoría estática: aplicar.mjs no desactiva TLS ni acepta certificados inválidos, y no imprime headers/stack", () => {
  const src = readFileSync(SCRIPT, "utf8");
  assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized|setGlobalDispatcher|--insecure/.test(src));
  assert.ok(!/console\.(log|error)\([^)]*(\.stack|\.details|\.hint|headers)/.test(src));
});

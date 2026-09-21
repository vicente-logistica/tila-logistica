# RESULTADO FINAL DE STAGING (ensamblado con el generador de `scripts/staging/finalizar-staging.mjs`; ver «Procedencia de cada fase»)

Generado: 2026-09-21T21:19:17.746Z · Proyecto de staging: `givvbdfieqobcpjuecgt.supabase.co` · Corrida: 3b6d15b4

> Informe ensamblado a partir de resultados reales. No contiene claves, cookies, contraseñas ni tokens. Producción no fue tocada.

## Procedencia de cada fase (léase primero)
Este informe se ensambló con el generador del orquestador a partir de resultados REALES obtenidos en tandas separadas; no proviene de una única corrida continua de `finalizar-staging.mjs`:
- **Fases 0–4 y 6** (preflight, verificación local/remota, seed dry-run y aplicado, secuencias): corrida original `3b6d15b4` (estado guardado). Las secuencias se validaron con el resultado del SQL 09 pegado por el usuario.
- **Fase 7 (V3)**: corrida original `3b6d15b4` (30 PASS, 0 FAIL, 1 SKIP no bloqueante). No se volvió a ejecutar en el cierre.
- **Fase 9 (Realtime)**: corrida aislada `108b1218` (21/09), ejecutada con el tester corregido (pausa única de 2 s tras SUBSCRIBED y antes de R1) directamente con `smoke/realtime.mjs`, exit 0 «VÁLIDA». **Reemplaza** al resultado INCONCLUSO de la corrida `3460101e` (R1 perdió el INSERT por una carrera tras el SUBSCRIBED; aislada, R1 llegó a los ~500 ms). La salida de esa corrida se transcribió a un archivo y se parseó con `parsearRealtime`.
- **Fases 8, 10 y 11**: cierre del 21/09 (levantado con el launcher, smoke por modo con `flujos.mjs` + `simular-gps.mjs`, limpieza con `limpiar-pruebas.mjs` y re-seed por upsert), ejecutadas con un driver auxiliar que reutiliza los mismos scripts, argumentos, entorno de hijos y parsers del orquestador (sin modificarlos). El orquestador completo no se usó porque `--continuar` habría repetido V3 y Realtime.

## Resumen por fase
| Fase | Estado | Detalle |
|---|---|---|
| 0 · Preflight | PASS | staging givvbdfieqobcpjuecgt.supabase.co; sin secretos en argumentos; entorno sin valores de producción |
| 1 · Verificación local | PASS | 19 chequeos; todo PASS |
| 2 · Verificación remota (solo lectura) | PASS | 23 chequeos; todo PASS |
| 3 · Seed dry-run | PASS | 9 tablas con las cantidades esperadas, 25 objetos de Storage, emails solo @tila-staging.invalid, aviso de secuencias presente, sin referencias a producción |
| 4 · Seed aplicado | PASS | seed aplicado y releído: 6 usuarios, 3 vehiculos, 26 documentacion_chofer, 7 cargas, 5 paradas_viaje, 8 mensajes_viaje, 2 billetera_chofer, 3 viaje_evidencias, 15 consentimientos_legales, 25 objetos de Storage, todos los emails @tila-staging.invalid |
| 6 · Secuencias | PASS | las 5 secuencias (paradas_viaje, viaje_evidencias, consentimientos_legales, cargas, vehiculos) figuran PASS y su último valor ≥ MAX(id) real leído por REST (paradas_viaje=5, viaje_evidencias=3, consentimientos_legales=15, cargas=107, vehiculos=5003). Evidencia: resultado del SQL 09 pegado por el usu |
| 7 · V3 | PASS | A1–A15 y B1–B16: 30 PASS, 0 FAIL, 1 SKIP no bloqueante(s) documentado(s) |
| 8 · App de staging | PASS | build de staging sin ref de producción; 3 instancias listas: legacy 127.0.0.1:3131, dual 127.0.0.2:3132, strict 127.0.0.3:3133; ninguna en 0.0.0.0 (relevada en el cierre del 21/09) |
| 9 · Realtime | PASS | 6 acciones clasificadas con control positivo VÁLIDO: R1 ANON NO RECIBE · R2 ANON NO RECIBE · R3 ANON NO RECIBE · R4 ANON NO RECIBE · R5 INCONCLUSO · R6 ANON RECIBE |
| 10 · Smoke LEGACY | PASS | flujos 37/37 PASS; GPS 7 puntos OK |
| 10 · Smoke DUAL | PASS | flujos 37/37 PASS; GPS 7 puntos OK |
| 10 · Smoke STRICT | PASS | flujos 37/37 PASS; GPS 7 puntos OK |
| 11 · Limpieza | PASS | dry-run: 6 resto(s) de pruebas, seed alterado; seed re-aplicado (upsert). Verificación final: 0 restos V3/Realtime/smoke y seed intacto (100/100); nunca TRUNCATE, DELETE sin filtro ni buckets vaciados |

## Entorno
Verificación local: **PASS** · remota (solo lectura): **PASS**. 19 chequeos; todo PASS

## Seed
Dry-run: **PASS** · aplicado y verificado: **PASS**. seed aplicado y releído: 6 usuarios, 3 vehiculos, 26 documentacion_chofer, 7 cargas, 5 paradas_viaje, 8 mensajes_viaje, 2 billetera_chofer, 3 viaje_evidencias, 15 consentimientos_legales, 25 objetos de Storage, todos los emails @tila-staging.invalid

## Secuencias
**PASS** — las 5 secuencias (paradas_viaje, viaje_evidencias, consentimientos_legales, cargas, vehiculos) figuran PASS y su último valor ≥ MAX(id) real leído por REST (paradas_viaje=5, viaje_evidencias=3, consentimientos_legales=15, cargas=107, vehiculos=5003). Evidencia: resultado del SQL 09 pegado por el usuario (no verificable directamente por PostgREST).

## V3 (A1–A15, B1–B16)
Estado: **PASS** · PASS 30 · FAIL 0 · SKIP no bloqueantes 1
- SKIP no bloqueante A12: semilla incompleta o ausente (tarifas): aplicar el seed ficticio ANTES de V3 (PLAN-V3-STAGING.md §4).

## Realtime
Estado: **PASS** · corrida 108b1218 · control positivo VÁLIDO
| Acción | anon | control positivo | Clasificación |
|---|---|---|---|
| R1 nueva carga | NO LLEGÓ | LLEGÓ | ANON NO RECIBE |
| R2 cambio de estado (aceptar) | NO LLEGÓ | LLEGÓ | ANON NO RECIBE |
| R3 mensaje de chat | NO LLEGÓ | LLEGÓ | ANON NO RECIBE |
| R4 posición GPS simulada | NO LLEGÓ | LLEGÓ | ANON NO RECIBE |
| R5 latido del chofer (ultima_senal_at) | NO LLEGÓ | NO LLEGÓ | INCONCLUSO |
| R6 DELETE de carga ficticia marcada | LLEGÓ | LLEGÓ | ANON RECIBE |

«ANON NO RECIBE» es un DATO medido, no un fallo; «INCONCLUSO» en una tabla no publicada no invalida la corrida.

## Smoke LEGACY (http://127.0.0.1:3131)
Estado: **PASS** · 37/37 verificaciones PASS · GPS: 7 puntos OK, 0 con error
Cobertura: publicación 2✔ · ofertas 1✔ · aceptación 1✔ · viaje activo 1✔ · GPS 2✔ · estados 7✔ · chat 7✔ · evidencias 1✔ · finalización 1✔ · billetera 3✔

## Smoke DUAL (http://127.0.0.2:3132)
Estado: **PASS** · 37/37 verificaciones PASS · GPS: 7 puntos OK, 0 con error
Cobertura: publicación 2✔ · ofertas 1✔ · aceptación 1✔ · viaje activo 1✔ · GPS 2✔ · estados 7✔ · chat 7✔ · evidencias 1✔ · finalización 1✔ · billetera 3✔

## Smoke STRICT (http://127.0.0.3:3133)
Estado: **PASS** · 37/37 verificaciones PASS · GPS: 7 puntos OK, 0 con error
Cobertura: publicación 2✔ · ofertas 1✔ · aceptación 1✔ · viaje activo 1✔ · GPS 2✔ · estados 7✔ · chat 7✔ · evidencias 1✔ · finalización 1✔ · billetera 3✔

## GPS y chat
- legacy: GPS 7 OK / 0 error · chat 7 verificaciones PASS
- dual: GPS 7 OK / 0 error · chat 7 verificaciones PASS
- strict: GPS 7 OK / 0 error · chat 7 verificaciones PASS

## Limpieza
**PASS** — dry-run: 6 resto(s) de pruebas, seed alterado; seed re-aplicado (upsert). Verificación final: 0 restos V3/Realtime/smoke y seed intacto (100/100); nunca TRUNCATE, DELETE sin filtro ni buckets vaciados

## Diferencias encontradas
Ninguna FAIL ni INCONCLUSO bloqueante en las fases ejecutadas.

## Observaciones no bloqueantes
- **R5 (latido → `usuarios`)**: INCONCLUSO no bloqueante. La acción se aplicó (UPDATE de anon, 1 fila) pero `usuarios` no está en la publicación `supabase_realtime`: ni el control ni anon reciben eventos. No es un fallo. (La membresía de la publicación se apoya en el SQL 07 y en la comparación estructural previa con producción; no se consultó `pg_publication_tables` en vivo.)
- **R6 (DELETE de `cargas`)**: `anon` RECIBE el evento aunque `cargas` tiene RLS sin policy SELECT. Es la semántica documentada de Realtime (las policies RLS no se aplican a los DELETE); con replica identity `default` el evento trae solo la PK (`marcador=n/d`). Consecuencia de seguridad a tener en cuenta: anon se entera del `id` de cada carga que se borra. Comportamiento observado, no modificado.
- **R1–R4**: `anon` NO recibe INSERT/UPDATE de `cargas` ni INSERT de `mensajes_viaje` (RLS activo sin policy SELECT); el control positivo los recibe.
- **Sonda de arranque del launcher**: en el PRIMER arranque de cada sesión el launcher apagó todo porque la sonda de solo lectura de una instancia dio HTTP 401 («la app no pudo leer el usuario del seed»): `dual` en dos arranques anteriores y `legacy` en el de este cierre. En todos los casos el segundo arranque pasó las tres sondas. No se investigó la causa ni se modificó código para ocultarlo; sigue como pendiente real.
- **Restauración del seed**: tras el smoke, `limpiar-pruebas` reportó el seed «alterado» (`cargas#103 lat/lng`, por el GPS simulado) y devolvió exit 3 (parcial); se restauró con `seed/aplicar.mjs --aplicar` (upsert) y la verificación final dio seed intacto 100/100 y 0 restos.
- **Pagos**: no se usó Mercado Pago ni ninguna pasarela (variables ausentes en staging).

## Qué quedó sin verificar
- El comportamiento de PRODUCCIÓN no se midió: Realtime (R1–R6) se midió solo en staging; V3 compara contra lo esperado según el relevamiento del 18–19/09, no contra una corrida en producción.
- Pagos: no se usó pasarela real ni sandbox de Mercado Pago (rutas de checkout/webhook sin probar de extremo a extremo).
- Google Maps / Directions, notificaciones, apps móviles (Android/iOS) y Vercel (Preview/Production) no formaron parte de estas pruebas.
- Carga, concurrencia sostenida, tiempos de respuesta y límites de Supabase bajo uso real.
- Las secuencias se comprobaron con el resultado del SQL 09 pegado por el usuario (cruzado con MAX(id) por REST); el orquestador no puede leer secuencias por PostgREST.

## Veredicto
**STAGING FUNCIONALMENTE EQUIVALENTE A PRODUCCIÓN EN LAS PRUEBAS DEFINIDAS**

(Alcance: solo las pruebas de este informe; ver «Qué quedó sin verificar».)

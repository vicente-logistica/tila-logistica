-- =====================================================================================================================
-- 09-secuencias-seed.sql · ALINEA LAS SECUENCIAS CON EL MAX(id) REAL DESPUÉS DE APLICAR EL SEED FICTICIO          (SOLO STAGING)
-- NO lo genera generar-esquema.mjs ni lo cubre verificar-sql-staging.mjs (son solo 01–08): es un paso POSTERIOR AL SEED, escrito a mano.
--
-- Por qué: el seed inserta ids EXPLÍCITOS (cargas 101–107, vehiculos 5001–5003, paradas_viaje 1–5, viaje_evidencias 1–3, consentimientos_legales 1–15) en tablas
-- cuyo id sale de una secuencia/identity. Un INSERT con id explícito no avanza la secuencia: quedaría en 1 y el primer INSERT sin id chocaría con el seed (23505).
--
-- Qué hace: para CADA tabla de `public` cuyo `id` tiene secuencia asociada (serial o identity; se descubren solas, sin lista escrita a mano), avanza la secuencia hasta
--   MAX(id) real de esa tabla SOLO si está por debajo. NUNCA retrocede una secuencia, no toca datos, es IDEMPOTENTE (correrlo dos veces = igual que una) y se puede repetir
--   después de reaplicar el seed o de correr pruebas. Las tablas con id uuid no tienen secuencia y no se tocan.
-- Cuándo: DESPUÉS de `seed/aplicar.mjs --aplicar`, ANTES de V3 / flujos / realtime. Se ejecuta a mano, en el SQL Editor de STAGING (igual que 01–08).
-- =====================================================================================================================
begin;
set local search_path to public, extensions;

-- ── GUARDA ANTI-PRODUCCIÓN (la misma de 05): producción tiene las backup_*_20260614; staging no ─────────────────────────────────────
do $guarda$
begin
  if to_regclass('public.backup_usuarios_20260614') is not null
     or to_regclass('public.backup_cargas_20260614') is not null then
    raise exception 'ABORTADO (09-secuencias-seed): existen tablas backup_*_20260614 => esto parece PRODUCCIÓN. Este archivo es SOLO para STAGING.';
  end if;
end
$guarda$;

-- ── Alinear: setval(secuencia, MAX(id) real, true) solo si MAX(id) > último valor ya entregado ────────────────────────────────────
do $alinear$
declare
  t      text;
  s      text;
  mx     bigint;
  ult    bigint;
  llamada boolean;
  efect  bigint;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'id'
    order by c.table_name
  loop
    s := pg_get_serial_sequence(format('public.%I', t), 'id');
    continue when s is null;                                   -- uuid u otra columna sin secuencia: nada que hacer
    execute format('select coalesce(max(id), 0) from public.%I', t) into mx;
    execute format('select last_value, is_called from %s', s) into ult, llamada;
    efect := case when llamada then ult else ult - 1 end;      -- último valor ya entregado (0 si la secuencia es nueva; incremento 1 en todas)
    if mx > efect then
      perform setval(s, mx, true);                             -- el próximo nextval() será MAX(id)+1
      raise notice '% : secuencia % avanzada de % a %', t, s, efect, mx;
    else
      raise notice '% : secuencia % ya está en % (MAX(id) = %): sin cambios', t, s, efect, mx;
    end if;
  end loop;
end
$alinear$;

commit;

-- ── VERIFICACIÓN (solo lectura): pegá el resultado. `estado` debe ser PASS en todas las filas ─────────────────────────────────────
select s.sequencename                                                            as secuencia,
       s.last_value                                                              as ultimo_valor,
       m.max_id,
       case when (s.last_value is not null and s.last_value >= coalesce(m.max_id, 0))
              or (s.last_value is null and coalesce(m.max_id, 0) = 0)
            then 'PASS' else 'FAIL' end                                          as estado
from pg_sequences s
cross join lateral (
  select ((xpath('/row/m/text()', query_to_xml(format('select max(id) as m from public.%I', regexp_replace(s.sequencename, '_id_seq$', '')), false, true, '')))[1])::text::bigint as max_id
) m
where s.schemaname = 'public'
order by s.sequencename;

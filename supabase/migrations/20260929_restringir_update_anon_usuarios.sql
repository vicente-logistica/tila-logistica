-- Cierra la escritura anónima sobre public.usuarios.
--
-- Problema: la política "anon_update_usuarios_permisivo" (to anon, using (true), with check
-- (true)) más `grant all ... to anon` permitían que cualquiera con la clave pública
-- (anon, incluida en el bundle del navegador) modificara CUALQUIER columna de CUALQUIER
-- usuario — incluido `rol` (p. ej. volverse admin).
--
-- Las únicas escrituras legítimas que usaban ese permiso eran del chofer sobre su propia
-- fila (online, navegador_preferido, bateria_nivel, bateria_cargando, ultima_senal_at).
-- Ahora pasan por PATCH /api/chofer/estado (service role, lista blanca de columnas, siempre
-- sobre la fila del propio usuario — app/lib/estadoChofer.ts).
--
-- ORDEN DE DESPLIEGUE OBLIGATORIO: primero desplegar el código que usa /api/chofer/estado,
-- DESPUÉS aplicar esta migración. Si se aplica antes, el estado online/batería del chofer
-- deja de guardarse.
--
-- No cambia: SELECT anon (anon_select_usuarios), INSERT anon (anon_insert_usuarios_no_admin,
-- que ya impide rol admin) ni ninguna otra tabla. El backend usa service_role y no se ve
-- afectado.
--
-- Rollback (sólo si hiciera falta volver atrás de emergencia):
--   grant update on table public.usuarios to anon, authenticated;
--   create policy "anon_update_usuarios_permisivo" on public.usuarios
--     as permissive for update to anon using (true) with check (true);

DROP POLICY IF EXISTS "anon_update_usuarios_permisivo" ON public.usuarios;

-- Sin política de UPDATE, RLS ya lo bloquea; además se quita el permiso en sí (defensa en
-- profundidad). DELETE/TRUNCATE tampoco tienen uso legítimo desde el navegador.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.usuarios FROM anon, authenticated;

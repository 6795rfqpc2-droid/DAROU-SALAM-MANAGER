-- Diagnostic uniquement : aucune modification de structure ou de données.
-- Exécuter dans le SQL Editor du projet Supabase actuel.
-- Exporter la cellule diagnostic (JSON). Aucune ligne client/vente n'est lue.
-- Les définitions de fonctions sont incluses : masquer tout secret qui y aurait
-- été codé en dur avant de partager le résultat.
WITH app_relations AS (
    SELECT c.oid, n.nspname AS schema_name, c.relname AS name,
           c.relkind, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
), app_functions AS (
    SELECT p.oid, n.nspname AS schema_name, p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS arguments,
           pg_get_function_result(p.oid) AS result_type,
           p.prosecdef AS security_definer, p.proconfig AS settings,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
)
SELECT jsonb_pretty(jsonb_build_object(
    'database_version', version(),
    'relations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'schema', r.schema_name, 'name', r.name, 'kind', r.relkind,
            'rls_enabled', r.relrowsecurity, 'rls_forced', r.relforcerowsecurity,
            'columns', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'name', a.attname,
                    'type', format_type(a.atttypid, a.atttypmod),
                    'not_null', a.attnotnull,
                    'identity', a.attidentity,
                    'generated', a.attgenerated,
                    'default', pg_get_expr(d.adbin, d.adrelid)
                ) ORDER BY a.attnum)
                FROM pg_attribute a
                LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
            ), '[]'::jsonb),
            'constraints', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'name', con.conname, 'type', con.contype,
                    'definition', pg_get_constraintdef(con.oid, true)
                ) ORDER BY con.conname)
                FROM pg_constraint con WHERE con.conrelid = r.oid
            ), '[]'::jsonb),
            'indexes', COALESCE((
                SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid)
                FROM pg_index i WHERE i.indrelid = r.oid
            ), '[]'::jsonb),
            'triggers', COALESCE((
                SELECT jsonb_agg(pg_get_triggerdef(t.oid, true) ORDER BY t.tgname)
                FROM pg_trigger t WHERE t.tgrelid = r.oid AND NOT t.tgisinternal
            ), '[]'::jsonb),
            'view_definition', CASE WHEN r.relkind IN ('v', 'm')
                THEN pg_get_viewdef(r.oid, true) ELSE NULL END
        ) ORDER BY r.name) FROM app_relations r
    ), '[]'::jsonb),
    'functions', COALESCE((
        SELECT jsonb_agg(to_jsonb(f) - 'oid' ORDER BY f.name, f.arguments)
        FROM app_functions f
    ), '[]'::jsonb),
    'policies', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.schemaname, p.tablename, p.policyname)
        FROM pg_policies p WHERE p.schemaname IN ('public', 'storage')
    ), '[]'::jsonb),
    'table_grants', COALESCE((
        SELECT jsonb_agg(to_jsonb(g) ORDER BY g.table_name, g.grantee, g.privilege_type)
        FROM information_schema.table_privileges g WHERE g.table_schema = 'public'
    ), '[]'::jsonb),
    'function_grants', COALESCE((
        SELECT jsonb_agg(to_jsonb(g) ORDER BY g.routine_name, g.grantee)
        FROM information_schema.routine_privileges g WHERE g.routine_schema = 'public'
    ), '[]'::jsonb)
)) AS diagnostic;

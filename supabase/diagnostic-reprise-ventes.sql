-- Lecture seule : état actuel, aucune modification.
SELECT jsonb_build_object(
 'tables', (SELECT jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,
  'colonnes',(SELECT jsonb_agg(jsonb_build_object('nom',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'not_null',a.attnotnull,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'contraintes',(SELECT jsonb_agg(jsonb_build_object('nom',conname,'definition',pg_get_constraintdef(oid),'validee',convalidated)) FROM pg_constraint WHERE conrelid=c.oid),
  'declencheurs',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(oid),'actif',tgenabled)) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)))
  FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relname IN ('ventes','vente_lignes','factures')),
 'fonctions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid)))
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public'
  AND p.proname IN ('create_sale_order','sales_api_version','issue_invoice','deduire_stock_apres_vente','supprimer_vente_admin')),
 'policies',(SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p WHERE schemaname='public' AND tablename IN ('ventes','vente_lignes','factures')),
 'droits',(SELECT jsonb_agg(to_jsonb(g)) FROM information_schema.role_table_grants g WHERE table_schema='public' AND table_name IN ('ventes','vente_lignes','factures'))
) AS diagnostic;

-- Exécuter EN ENTIER après migration-paiements-en-cours.sql.
-- Réexécutable : aucune ancienne valeur ni aucun solde n'est réécrit.
BEGIN;
SET LOCAL lock_timeout='10s';
DO $$ BEGIN
 IF to_regclass('public.sale_payment_entries') IS NULL OR to_regprocedure('public.payment_api_version()') IS NULL THEN
  RAISE EXCEPTION 'Installez d’abord la gestion des paiements en cours'; END IF;
END $$;
ALTER TABLE public.ventes ADD COLUMN IF NOT EXISTS cash_recorded_at timestamptz;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS cash_recorded_at timestamptz;
ALTER TABLE public.sale_payment_entries ADD COLUMN IF NOT EXISTS cash_recorded_at timestamptz;
ALTER TABLE public.sale_payment_entries ADD COLUMN IF NOT EXISTS recorded_by_name text;
ALTER TABLE public.versements ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE public.versements ADD COLUMN IF NOT EXISTS cash_cutoff_at timestamptz;
ALTER TABLE public.versements ADD COLUMN IF NOT EXISTS receipts_total numeric(14,2);
ALTER TABLE public.versements ADD COLUMN IF NOT EXISTS remitted_before numeric(14,2);
ALTER TABLE public.versements ADD COLUMN IF NOT EXISTS balance_before numeric(14,2);
ALTER TABLE public.versements ADD COLUMN IF NOT EXISTS balance_after numeric(14,2);
ALTER TABLE public.versements ADD COLUMN IF NOT EXISTS recorded_by_name text;
ALTER TABLE public.versements ADD COLUMN IF NOT EXISTS covered_sale_ids uuid[];
CREATE UNIQUE INDEX IF NOT EXISTS versements_request_unique ON public.versements(request_id) WHERE request_id IS NOT NULL;

-- Toutes les fonctions métier existantes appellent ce garde avant leurs verrous
-- de stock/vente. Garder ce même ordre évite les interblocages entre parcours.
CREATE OR REPLACE FUNCTION public.require_shop(p_shop_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public.can_access_shop(p_shop_id) THEN RAISE EXCEPTION 'Accès refusé à cette boutique'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_shop_id::text,73));
 END $$;

CREATE OR REPLACE FUNCTION public.shop_cash_receipts(p_shop_id uuid) RETURNS numeric
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT
 coalesce((SELECT sum(v.montant_total) FROM public.ventes v WHERE v.shop_id=p_shop_id AND v.cancelled_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM public.reservations r WHERE r.sale_id=v.id)
   AND NOT EXISTS(SELECT 1 FROM public.sale_payment_accounts a WHERE a.sale_id=v.id)),0)
 +coalesce((SELECT sum(e.amount) FROM public.sale_payment_entries e
   JOIN public.sale_payment_accounts a ON a.id=e.account_id AND a.shop_id=e.shop_id
   JOIN public.ventes v ON v.id=a.sale_id AND v.shop_id=a.shop_id
   WHERE e.shop_id=p_shop_id AND v.cancelled_at IS NULL),0)
 +coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.shop_id=p_shop_id),0)
 $$;

-- Les nouvelles écritures de caisse et remises d'une même boutique sont sérialisées.
-- L'heure de caisse est fixée APRÈS le verrou : une transaction commencée plus tôt
-- ne peut pas se glisser avant un repère de remise qu'elle n'a pas alimenté.
CREATE OR REPLACE FUNCTION public.stamp_cash_receipt() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(new.shop_id::text,73));
 IF TG_OP='INSERT' THEN
  new.cash_recorded_at:=clock_timestamp();
  IF TG_TABLE_NAME='sale_payment_entries' THEN
   SELECT nom_complet INTO new.recorded_by_name FROM public.profiles WHERE id=new.created_by;
  END IF;
 END IF;
 RETURN new;
 END $$;
DROP TRIGGER IF EXISTS cash_receipt_stamp ON public.ventes;
CREATE TRIGGER cash_receipt_stamp BEFORE INSERT OR UPDATE OF cancelled_at ON public.ventes
 FOR EACH ROW EXECUTE FUNCTION public.stamp_cash_receipt();
DROP TRIGGER IF EXISTS cash_receipt_stamp ON public.payments;
CREATE TRIGGER cash_receipt_stamp BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.stamp_cash_receipt();
DROP TRIGGER IF EXISTS cash_receipt_stamp ON public.sale_payment_entries;
CREATE TRIGGER cash_receipt_stamp BEFORE INSERT ON public.sale_payment_entries FOR EACH ROW EXECUTE FUNCTION public.stamp_cash_receipt();

CREATE OR REPLACE FUNCTION public.stamp_cash_remittance() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.require_shop(new.shop_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(new.shop_id::text,73));
 new.receipts_total:=public.shop_cash_receipts(new.shop_id);
 SELECT coalesce(sum(amount),0) INTO new.remitted_before FROM public.versements WHERE shop_id=new.shop_id;
 new.balance_before:=new.receipts_total-new.remitted_before;
 IF new.amount::text IN ('NaN','Infinity','-Infinity') OR new.amount<=0 OR new.amount>new.balance_before THEN
  RAISE EXCEPTION 'Montant invalide ou supérieur à l’argent réellement disponible : % F CFA',new.balance_before;
 END IF;
 new.balance_after:=new.balance_before-new.amount;
 new.cash_cutoff_at:=clock_timestamp();new.created_at:=new.cash_cutoff_at;
 new.created_by:=auth.uid();
 SELECT nom_complet INTO new.recorded_by_name FROM public.profiles WHERE id=new.created_by;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO new.covered_sale_ids
  FROM public.ventes WHERE shop_id=new.shop_id AND cancelled_at IS NULL;
 RETURN new;
 END $$;
DROP TRIGGER IF EXISTS cash_remittance_stamp ON public.versements;
CREATE TRIGGER cash_remittance_stamp BEFORE INSERT ON public.versements FOR EACH ROW EXECUTE FUNCTION public.stamp_cash_remittance();
CREATE OR REPLACE FUNCTION public.protect_cash_remittance() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 RAISE EXCEPTION 'Une remise à l’administratrice enregistrée ne peut pas être modifiée ni effacée'; END $$;
DROP TRIGGER IF EXISTS cash_remittance_immutable ON public.versements;
CREATE TRIGGER cash_remittance_immutable BEFORE UPDATE OR DELETE ON public.versements FOR EACH ROW EXECUTE FUNCTION public.protect_cash_remittance();

CREATE OR REPLACE FUNCTION public.record_cash_remittance(p_shop_id uuid,p_amount numeric,p_note text,p_request_id uuid)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE old public.versements; result bigint;
 BEGIN
 PERFORM public.require_shop(p_shop_id);
 IF p_request_id IS NULL OR p_amount IS NULL OR p_amount<>round(p_amount,2) THEN RAISE EXCEPTION 'Montant ou identifiant invalide'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,74));
 SELECT * INTO old FROM public.versements WHERE request_id=p_request_id;
 IF FOUND THEN
  IF old.shop_id<>p_shop_id OR old.created_by<>auth.uid() OR old.amount IS DISTINCT FROM p_amount OR old.note IS DISTINCT FROM p_note THEN
   RAISE EXCEPTION 'Identifiant déjà utilisé pour une autre remise'; END IF;
  RETURN old.id;
 END IF;
 INSERT INTO public.versements(shop_id,amount,note,created_by,request_id)
 VALUES(p_shop_id,p_amount,p_note,auth.uid(),p_request_id) RETURNING id INTO result;
 INSERT INTO public.audit_logs(shop_id,user_id,action,table_name,record_id,details)
 VALUES(p_shop_id,auth.uid(),'create','versements',result::text,jsonb_build_object('amount',p_amount));
 RETURN result;
 END $$;
-- L'ancienne signature reste disponible mais bénéficie du même contrôle de caisse.
CREATE OR REPLACE FUNCTION public.record_versement(p_shop_id uuid,p_amount numeric,p_note text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.record_cash_remittance(p_shop_id,p_amount,p_note,gen_random_uuid()); END $$;
CREATE OR REPLACE FUNCTION public.cash_management_version() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.shop_cash_receipts(uuid),public.stamp_cash_receipt(),public.stamp_cash_remittance(),public.protect_cash_remittance() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_cash_remittance(uuid,numeric,text,uuid),public.cash_management_version(),public.record_versement(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_cash_remittance(uuid,numeric,text,uuid),public.cash_management_version(),public.record_versement(uuid,numeric,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT public.cash_management_version() AS version_caisse,
 (SELECT count(*) FROM public.ventes) AS ventes_conservees,
 (SELECT count(*) FROM public.sale_payment_entries) AS paiements_conserves,
 (SELECT count(*) FROM public.versements) AS remises_conservees;

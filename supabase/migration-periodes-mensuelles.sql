-- Après migration-suivi-caisse.sql. Transaction réexécutable, aucune donnée historique réécrite.
BEGIN;
SET LOCAL lock_timeout='10s';
DO $$ BEGIN
 IF to_regprocedure('public.cash_management_version()') IS NULL THEN RAISE EXCEPTION 'Exécutez migration-suivi-caisse.sql avant cette migration'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.shop_activity_periods (
 shop_id uuid PRIMARY KEY REFERENCES public.shops(id),
 active_month date NOT NULL DEFAULT date_trunc('month',now() AT TIME ZONE 'Africa/Dakar')::date,
 CHECK(extract(day from active_month)=1)
);
CREATE TABLE IF NOT EXISTS public.monthly_closures (
 shop_id uuid NOT NULL REFERENCES public.shops(id), month date NOT NULL,
 closed_at timestamptz NOT NULL, closed_by uuid NOT NULL,
 snapshot jsonb NOT NULL, PRIMARY KEY(shop_id,month)
);
-- Première installation : reprendre le dernier mois réellement utilisé, sans
-- fermer implicitement septembre si l'installation intervient en octobre.
INSERT INTO public.shop_activity_periods(shop_id,active_month)
 SELECT s.id,coalesce((SELECT max(m) FROM (
  SELECT date_trunc('month',v.date_vente AT TIME ZONE 'Africa/Dakar')::date m FROM public.ventes v WHERE v.shop_id=s.id
  UNION ALL SELECT date_trunc('month',p.created_at AT TIME ZONE 'Africa/Dakar')::date FROM public.payments p WHERE p.shop_id=s.id
  UNION ALL SELECT date_trunc('month',e.created_at AT TIME ZONE 'Africa/Dakar')::date FROM public.sale_payment_entries e WHERE e.shop_id=s.id
  UNION ALL SELECT date_trunc('month',r.created_at AT TIME ZONE 'Africa/Dakar')::date FROM public.versements r WHERE r.shop_id=s.id
 ) dates),date_trunc('month',now() AT TIME ZONE 'Africa/Dakar')::date)
 FROM public.shops s ON CONFLICT DO NOTHING;
ALTER TABLE public.ventes ADD COLUMN IF NOT EXISTS activity_month date;
ALTER TABLE public.ventes ADD COLUMN IF NOT EXISTS sales_channel text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS activity_month date;
ALTER TABLE public.sale_payment_entries ADD COLUMN IF NOT EXISTS activity_month date;
ALTER TABLE public.versements ADD COLUMN IF NOT EXISTS activity_month date;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS activity_month date;
ALTER TABLE public.shop_activity_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_activity_periods,public.monthly_closures FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.shop_activity_periods,public.monthly_closures TO authenticated;
DROP POLICY IF EXISTS period_read ON public.shop_activity_periods;
CREATE POLICY period_read ON public.shop_activity_periods FOR SELECT TO authenticated USING(public.can_access_shop(shop_id));
DROP POLICY IF EXISTS closure_read ON public.monthly_closures;
CREATE POLICY closure_read ON public.monthly_closures FOR SELECT TO authenticated USING(public.can_access_shop(shop_id));
CREATE OR REPLACE FUNCTION public.stamp_activity_period() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.require_shop(new.shop_id);
 INSERT INTO public.shop_activity_periods(shop_id) VALUES(new.shop_id) ON CONFLICT DO NOTHING;
 SELECT active_month INTO new.activity_month FROM public.shop_activity_periods WHERE shop_id=new.shop_id;
 IF TG_TABLE_NAME='ventes' THEN
  new.sales_channel:=nullif(current_setting('app.sales_channel',true),'');
 END IF;
 RETURN new;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ventes','payments','sale_payment_entries','versements','reservations'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS activity_stamp ON public.%I',t);
 EXECUTE format('CREATE TRIGGER activity_stamp BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_activity_period()',t);
 END LOOP;
END $$;
-- Empêcher le déplacement d'une écriture existante vers un autre mois.
CREATE OR REPLACE FUNCTION public.protect_activity_period() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF new.activity_month IS DISTINCT FROM old.activity_month THEN RAISE EXCEPTION 'La période enregistrée est immuable'; END IF;
 RETURN new;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ventes','payments','sale_payment_entries','versements','reservations'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS activity_immutable ON public.%I',t);
 EXECUTE format('CREATE TRIGGER activity_immutable BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_activity_period()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.protect_closed_sale() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m date;
BEGIN
 PERFORM public.require_shop(old.shop_id);
 m:=coalesce(old.activity_month,date_trunc('month',old.date_vente AT TIME ZONE 'Africa/Dakar')::date);
 IF EXISTS(SELECT 1 FROM public.monthly_closures WHERE shop_id=old.shop_id AND month=m) THEN
  RAISE EXCEPTION 'Vente d’un mois clôturé : annulation ou modification interdite';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN old ELSE new END;
END $$;
DROP TRIGGER IF EXISTS closed_sale_guard ON public.ventes;
CREATE TRIGGER closed_sale_guard BEFORE UPDATE OR DELETE ON public.ventes FOR EACH ROW EXECUTE FUNCTION public.protect_closed_sale();
CREATE OR REPLACE FUNCTION public.close_activity_month(p_shop_id uuid,p_month date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE active date; snap jsonb; result jsonb; stamp timestamptz;
BEGIN
 PERFORM public.require_shop(p_shop_id);
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Clôture réservée à l’administratrice'; END IF;
 SELECT to_jsonb(c) INTO result FROM public.monthly_closures c WHERE shop_id=p_shop_id AND month=p_month;
 IF FOUND THEN RETURN result; END IF;
 SELECT active_month INTO active FROM public.shop_activity_periods WHERE shop_id=p_shop_id FOR UPDATE;
 IF active IS NULL OR p_month IS DISTINCT FROM active THEN RAISE EXCEPTION 'La période a changé. Actualisez le bilan avant de clôturer.'; END IF;
 stamp:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.reservations r JOIN public.sale_payment_accounts a ON a.sale_id=r.sale_id WHERE r.shop_id=p_shop_id) THEN
  RAISE EXCEPTION 'Contrôle requis : une vente est liée à la fois à une réservation et à un compte de paiement. Aucune clôture effectuée.';
 END IF;
 -- Photographie serveur : le navigateur ne fournit aucun montant.
 SELECT jsonb_build_object('version',1,'shop_name',(SELECT nom FROM public.shops WHERE id=p_shop_id),
 'products',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.produits x WHERE shop_id=p_shop_id),'[]'::jsonb),
 'sales',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.ventes x WHERE shop_id=p_shop_id),'[]'::jsonb),
 'reservations',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.reservations x WHERE shop_id=p_shop_id),'[]'::jsonb),
 'payments',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.payments x WHERE shop_id=p_shop_id),'[]'::jsonb),
 'versements',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.versements x WHERE shop_id=p_shop_id),'[]'::jsonb),
 'factures',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.factures x WHERE shop_id=p_shop_id),'[]'::jsonb),
 'paymentAccounts',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.sale_payment_accounts x WHERE shop_id=p_shop_id),'[]'::jsonb),
 'paymentEntries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.sale_payment_entries x WHERE shop_id=p_shop_id),'[]'::jsonb)) INTO snap;
 INSERT INTO public.monthly_closures VALUES(p_shop_id,active,stamp,auth.uid(),snap);
 UPDATE public.shop_activity_periods SET active_month=(active+interval '1 month')::date WHERE shop_id=p_shop_id;
 INSERT INTO public.audit_logs(shop_id,user_id,action,table_name,record_id,details)
 VALUES(p_shop_id,auth.uid(),'close','monthly_closures',active::text,jsonb_build_object('closed_at',stamp));
 SELECT to_jsonb(c) INTO result FROM public.monthly_closures c WHERE shop_id=p_shop_id AND month=active;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.create_period_sale(p_shop_id uuid,p_customer_id bigint,p_items jsonb,p_request_id uuid,p_payment jsonb,p_channel text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;
BEGIN
 PERFORM public.require_shop(p_shop_id);
 IF p_channel IS NOT NULL AND p_channel NOT IN ('whatsapp','tiktok','snapchat','instagram','facebook','boutique','autre') THEN RAISE EXCEPTION 'Canal inconnu'; END IF;
 PERFORM set_config('app.sales_channel',coalesce(p_channel,''),true);
 result:=public.create_sale_with_payment(p_shop_id,p_customer_id,p_items,p_request_id,p_payment);
 IF (SELECT sales_channel FROM public.ventes WHERE id=result) IS DISTINCT FROM p_channel THEN
  RAISE EXCEPTION 'Cet identifiant de vente est déjà utilisé avec une autre origine';
 END IF;
 PERFORM set_config('app.sales_channel','',true);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.period_api_version() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.stamp_activity_period(),public.protect_activity_period(),public.protect_closed_sale() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.close_activity_month(uuid,date),public.create_period_sale(uuid,bigint,jsonb,uuid,jsonb,text),public.period_api_version() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_activity_month(uuid,date),public.create_period_sale(uuid,bigint,jsonb,uuid,jsonb,text),public.period_api_version() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT shop_id,active_month FROM public.shop_activity_periods;

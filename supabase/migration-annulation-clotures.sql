-- Installer après migration-periodes-mensuelles.sql. Aucune vente/paiement modifié.
BEGIN;
SET LOCAL lock_timeout='10s';
CREATE TABLE IF NOT EXISTS public.cancelled_monthly_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES public.shops(id),
 month date NOT NULL, closed_at timestamptz NOT NULL, closed_by uuid NOT NULL,
 snapshot jsonb NOT NULL, cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 cancelled_by uuid NOT NULL, reason text NOT NULL,
 UNIQUE(shop_id,month,closed_at)
);
ALTER TABLE public.cancelled_monthly_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cancelled_monthly_closures FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cancelled_monthly_closures TO authenticated;
DROP POLICY IF EXISTS cancelled_closure_read ON public.cancelled_monthly_closures;
CREATE POLICY cancelled_closure_read ON public.cancelled_monthly_closures FOR SELECT TO authenticated USING(public.can_access_shop(shop_id));
CREATE OR REPLACE FUNCTION public.cancel_monthly_closure(p_shop_id uuid,p_month date,p_closed_at timestamptz,p_reason text)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.monthly_closures; active date;
BEGIN
 PERFORM public.require_shop(p_shop_id);
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administratrice uniquement'; END IF;
 SELECT active_month INTO active FROM public.shop_activity_periods WHERE shop_id=p_shop_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.cancelled_monthly_closures WHERE shop_id=p_shop_id AND month=p_month AND closed_at=p_closed_at) THEN RETURN active; END IF;
 IF p_reason IS NULL OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'Indiquez la raison de l’annulation'; END IF;
 SELECT * INTO c FROM public.monthly_closures WHERE shop_id=p_shop_id AND month=p_month FOR UPDATE;
 IF NOT FOUND OR c.closed_at IS DISTINCT FROM p_closed_at THEN RAISE EXCEPTION 'Clôture différente ou introuvable. Actualisez.'; END IF;
 IF EXISTS(SELECT 1 FROM public.monthly_closures WHERE shop_id=p_shop_id AND month>p_month)
 OR active IS DISTINCT FROM (p_month+interval '1 month')::date THEN
 RAISE EXCEPTION 'Annulez d’abord la clôture la plus récente (novembre avant octobre).'; END IF;
 INSERT INTO public.cancelled_monthly_closures(shop_id,month,closed_at,closed_by,snapshot,cancelled_by,reason)
 VALUES(c.shop_id,c.month,c.closed_at,c.closed_by,c.snapshot,auth.uid(),trim(p_reason));
 -- Seul le marqueur actif est retiré ; son contenu est conservé intégralement ci-dessus.
 DELETE FROM public.monthly_closures WHERE shop_id=p_shop_id AND month=p_month;
 UPDATE public.shop_activity_periods SET active_month=p_month WHERE shop_id=p_shop_id;
 INSERT INTO public.audit_logs(shop_id,user_id,action,table_name,record_id,details)
 VALUES(p_shop_id,auth.uid(),'cancel_closure','monthly_closures',p_month::text,jsonb_build_object('closed_at',p_closed_at,'reason',trim(p_reason)));
 RETURN p_month;
END $$;
CREATE OR REPLACE FUNCTION public.closure_cancellation_version() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.cancel_monthly_closure(uuid,date,timestamptz,text),public.closure_cancellation_version() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_monthly_closure(uuid,date,timestamptz,text),public.closure_cancellation_version() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
-- Contrôle en lecture : vérifier la boutique, les mois clôturés et le mois actif.
SELECT s.nom,p.active_month,c.month,c.closed_at FROM public.shops s
JOIN public.shop_activity_periods p ON p.shop_id=s.id
LEFT JOIN public.monthly_closures c ON c.shop_id=s.id ORDER BY s.nom,c.month;

-- Exécuter ce fichier ENTIER après la migration des unités (version 3).
-- Aucune ancienne vente, facture, réservation ni aucun stock n'est réécrit.
BEGIN;
SET LOCAL lock_timeout='10s';
DO $$ BEGIN
 IF to_regprocedure('public.create_sale_order(uuid,bigint,jsonb,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Installez d’abord les ventes multi-produits et les unités';
 END IF;
 IF public.sales_api_version()<3 THEN RAISE EXCEPTION 'La migration des unités (version 3) est requise'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.sale_payment_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shop_id uuid NOT NULL REFERENCES public.shops(id),
 sale_id uuid NOT NULL UNIQUE,
 customer_name text NOT NULL,
 customer_phone text NOT NULL DEFAULT '',
 total_amount numeric(12,2) NOT NULL CHECK(total_amount>=0),
 initial_method text NOT NULL CHECK(initial_method IN ('especes','wave','orange_money','virement','carte','autre')),
 initial_date date NOT NULL,
 next_due_date date,
 request_payload jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,shop_id),
 FOREIGN KEY(sale_id,shop_id) REFERENCES public.ventes(id,shop_id)
);
CREATE TABLE IF NOT EXISTS public.sale_payment_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shop_id uuid NOT NULL REFERENCES public.shops(id),
 account_id uuid NOT NULL,
 amount numeric(12,2) NOT NULL CHECK(amount>0),
 paid_on date NOT NULL,
 method text NOT NULL CHECK(method IN ('especes','wave','orange_money','virement','carte','autre')),
 receipt_number text NOT NULL UNIQUE,
 sequence integer NOT NULL CHECK(sequence>0),
 paid_after numeric(12,2) NOT NULL,
 remaining_after numeric(12,2) NOT NULL CHECK(remaining_after>=0),
 request_id uuid NOT NULL UNIQUE,
 request_payload jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,sequence),
 FOREIGN KEY(account_id,shop_id) REFERENCES public.sale_payment_accounts(id,shop_id)
);
CREATE INDEX IF NOT EXISTS sale_payment_accounts_shop_due ON public.sale_payment_accounts(shop_id,next_due_date);
CREATE INDEX IF NOT EXISTS sale_payment_entries_shop_account ON public.sale_payment_entries(shop_id,account_id);
ALTER TABLE public.sale_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payment_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_payment_accounts,public.sale_payment_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sale_payment_accounts,public.sale_payment_entries TO authenticated;
DROP POLICY IF EXISTS shop_read ON public.sale_payment_accounts;
CREATE POLICY shop_read ON public.sale_payment_accounts FOR SELECT TO authenticated USING(public.can_access_shop(shop_id));
DROP POLICY IF EXISTS shop_read ON public.sale_payment_entries;
CREATE POLICY shop_read ON public.sale_payment_entries FOR SELECT TO authenticated USING(public.can_access_shop(shop_id));
-- Une éventuelle policy permissive ajoutée séparément ne doit pas élargir la boutique.
DROP POLICY IF EXISTS shop_boundary ON public.sale_payment_accounts;
CREATE POLICY shop_boundary ON public.sale_payment_accounts AS RESTRICTIVE FOR ALL TO authenticated
 USING(public.can_access_shop(shop_id)) WITH CHECK(public.can_access_shop(shop_id));
DROP POLICY IF EXISTS shop_boundary ON public.sale_payment_entries;
CREATE POLICY shop_boundary ON public.sale_payment_entries AS RESTRICTIVE FOR ALL TO authenticated
 USING(public.can_access_shop(shop_id)) WITH CHECK(public.can_access_shop(shop_id));

CREATE OR REPLACE FUNCTION public.protect_sale_payment_history() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 RAISE EXCEPTION 'Un versement enregistré ne peut pas être remplacé ni supprimé';
 END $$;
DROP TRIGGER IF EXISTS immutable_payment ON public.sale_payment_entries;
CREATE TRIGGER immutable_payment BEFORE UPDATE OR DELETE ON public.sale_payment_entries
 FOR EACH ROW EXECUTE FUNCTION public.protect_sale_payment_history();

CREATE OR REPLACE FUNCTION public.add_sale_payment(p_shop_id uuid,p_account_id uuid,p_amount numeric,
 p_method text,p_paid_on date,p_next_due_date date,p_request_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE a public.sale_payment_accounts; old public.sale_payment_entries;
 paid numeric; seq integer; invoice_number text; result uuid; payload jsonb;
 BEGIN
 PERFORM public.require_shop(p_shop_id);
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identifiant de versement requis'; END IF;
 payload:=jsonb_build_object('account',p_account_id,'amount',p_amount,'method',p_method,'date',p_paid_on,'due',p_next_due_date);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
 SELECT * INTO old FROM public.sale_payment_entries WHERE request_id=p_request_id;
 IF FOUND THEN
  IF old.shop_id<>p_shop_id OR old.created_by<>auth.uid() OR old.request_payload IS DISTINCT FROM payload THEN
   RAISE EXCEPTION 'Identifiant déjà utilisé pour un autre versement'; END IF;
  RETURN old.id;
 END IF;
 SELECT * INTO a FROM public.sale_payment_accounts WHERE id=p_account_id AND shop_id=p_shop_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable dans cette boutique'; END IF;
 -- Le verrou de vente sérialise aussi un éventuel essai d'annulation.
 PERFORM 1 FROM public.ventes WHERE id=a.sale_id AND cancelled_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cette vente est annulée'; END IF;
 IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<=0 OR p_amount<>round(p_amount,2)
  OR p_method IS NULL OR p_method NOT IN ('especes','wave','orange_money','virement','carte','autre') THEN
  RAISE EXCEPTION 'Montant ou mode de paiement invalide'; END IF;
 IF p_paid_on IS NULL OR p_paid_on<a.initial_date OR p_paid_on>(now() AT TIME ZONE 'Africa/Dakar')::date
  OR p_paid_on<coalesce((SELECT max(paid_on) FROM public.sale_payment_entries WHERE account_id=a.id),a.initial_date)
  OR (p_next_due_date<p_paid_on AND p_next_due_date IS DISTINCT FROM a.next_due_date)
  THEN RAISE EXCEPTION 'Date de versement ou échéance invalide'; END IF;
 SELECT coalesce(sum(amount),0),coalesce(max(sequence),0)+1 INTO paid,seq FROM public.sale_payment_entries WHERE account_id=a.id;
 IF paid+p_amount>a.total_amount THEN RAISE EXCEPTION 'Le versement dépasse le reste à payer'; END IF;
 SELECT numero INTO invoice_number FROM public.factures WHERE sale_id=a.sale_id;
 INSERT INTO public.sale_payment_entries(shop_id,account_id,amount,paid_on,method,receipt_number,sequence,
  paid_after,remaining_after,request_id,request_payload,created_by)
 VALUES(p_shop_id,a.id,p_amount,p_paid_on,p_method,invoice_number||'-R'||lpad(seq::text,greatest(3,length(seq::text)),'0'),seq,
  paid+p_amount,a.total_amount-paid-p_amount,p_request_id,payload,auth.uid()) RETURNING id INTO result;
 UPDATE public.sale_payment_accounts SET next_due_date=CASE WHEN paid+p_amount=a.total_amount THEN null ELSE p_next_due_date END WHERE id=a.id;
 UPDATE public.factures SET paid_amount=paid+p_amount WHERE sale_id=a.sale_id;
 INSERT INTO public.audit_logs(shop_id,user_id,action,table_name,record_id,details)
 VALUES(p_shop_id,auth.uid(),'create','sale_payment_entries',result::text,jsonb_build_object('amount',p_amount,'account_id',a.id));
 RETURN result;
 END $$;

CREATE OR REPLACE FUNCTION public.create_sale_with_payment(p_shop_id uuid,p_customer_id bigint,p_items jsonb,
 p_request_id uuid,p_payment jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE v uuid; a public.sale_payment_accounts; f public.factures; c public.customers;
 payload jsonb; client_name text; phone text; mode text; amount numeric; payment_date date; due date;
 BEGIN
 PERFORM public.require_shop(p_shop_id);
 IF p_request_id IS NULL OR jsonb_typeof(p_payment) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Paiement requis'; END IF;
 payload:=jsonb_build_object('customer_id',p_customer_id,'items',p_items,'payment',p_payment);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT id INTO v FROM public.ventes WHERE request_id=p_request_id;
 IF FOUND THEN
  SELECT * INTO a FROM public.sale_payment_accounts WHERE sale_id=v;
  IF NOT FOUND OR a.shop_id<>p_shop_id OR a.created_by<>auth.uid() OR a.request_payload IS DISTINCT FROM payload THEN
   RAISE EXCEPTION 'Identifiant déjà utilisé pour une autre vente'; END IF;
  RETURN v;
 END IF;
 IF p_customer_id IS NOT NULL THEN
  SELECT * INTO c FROM public.customers WHERE id=p_customer_id AND shop_id=p_shop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente étrangère à cette boutique'; END IF;
 END IF;
 client_name:=coalesce(nullif(trim(p_payment->>'name'),''),c.nom,'Client comptant');
 phone:=coalesce(nullif(trim(p_payment->>'phone'),''),c.telephone,'');
 mode:=p_payment->>'mode';
 payment_date:=(p_payment->>'date')::date;
 due:=nullif(p_payment->>'due','')::date;
 IF p_payment->>'status' IS NULL OR p_payment->>'status' NOT IN ('full','partial')
  OR mode IS NULL OR mode NOT IN ('especes','wave','orange_money','virement','carte','autre')
  OR payment_date IS NULL OR payment_date>(now() AT TIME ZONE 'Africa/Dakar')::date OR due<payment_date THEN
  RAISE EXCEPTION 'Statut, mode ou date de paiement invalide'; END IF;
 IF p_payment->>'status'='partial' AND (client_name='Client comptant' OR length(regexp_replace(phone,'[^0-9]','','g'))<8) THEN
  RAISE EXCEPTION 'Le nom et le téléphone du client sont obligatoires pour un paiement en cours'; END IF;
 v:=public.create_sale_order(p_shop_id,p_customer_id,p_items,p_request_id);
 SELECT * INTO f FROM public.factures WHERE sale_id=v;
 amount:=CASE WHEN p_payment->>'status'='full' THEN f.total_amount ELSE (p_payment->>'paid')::numeric END;
 IF amount IS NULL OR amount::text IN ('NaN','Infinity','-Infinity') OR amount<0 OR amount<>round(amount,2)
  OR amount>f.total_amount OR (p_payment->>'status'='partial' AND amount>=f.total_amount) THEN
  RAISE EXCEPTION 'Montant initial invalide'; END IF;
 INSERT INTO public.sale_payment_accounts(shop_id,sale_id,customer_name,customer_phone,total_amount,initial_method,
  initial_date,next_due_date,request_payload,created_by)
 VALUES(p_shop_id,v,client_name,phone,f.total_amount,mode,payment_date,
  CASE WHEN amount=f.total_amount THEN null ELSE due END,payload,auth.uid()) RETURNING * INTO a;
 UPDATE public.factures SET customer_name=client_name,customer_phone=phone,paid_amount=0 WHERE sale_id=v;
 IF amount>0 THEN
  PERFORM public.add_sale_payment(p_shop_id,a.id,amount,mode,payment_date,due,p_request_id);
 END IF;
 RETURN v;
 END $$;

CREATE OR REPLACE FUNCTION public.guard_paid_sale_cancellation() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF old.cancelled_at IS NULL AND new.cancelled_at IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.sale_payment_accounts a JOIN public.sale_payment_entries e ON e.account_id=a.id WHERE a.sale_id=new.id
 ) THEN RAISE EXCEPTION 'Cette vente comporte des versements. Son annulation nécessite un traitement de remboursement ; historique conservé.'; END IF;
 RETURN new;
 END $$;
DROP TRIGGER IF EXISTS guard_paid_sale_cancellation ON public.ventes;
CREATE TRIGGER guard_paid_sale_cancellation BEFORE UPDATE OF cancelled_at ON public.ventes
 FOR EACH ROW EXECUTE FUNCTION public.guard_paid_sale_cancellation();

REVOKE ALL ON FUNCTION public.protect_sale_payment_history(),public.guard_paid_sale_cancellation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_sale_with_payment(uuid,bigint,jsonb,uuid,jsonb),
 public.add_sale_payment(uuid,uuid,numeric,text,date,date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_sale_with_payment(uuid,bigint,jsonb,uuid,jsonb),
 public.add_sale_payment(uuid,uuid,numeric,text,date,date,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.payment_api_version() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.payment_api_version() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payment_api_version() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT public.payment_api_version() AS version_paiements,
 (SELECT count(*) FROM public.sale_payment_accounts) AS dossiers_paiement,
 (SELECT count(*) FROM public.sale_payment_entries) AS versements_clients;

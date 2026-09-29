-- Vente au mètre : à exécuter EN ENTIER après la reprise multi-produits réussie.
-- Réexécutable. Aucun effacement, aucun mouvement de stock, aucune conversion
-- automatique des anciens produits en tissus. Leur unité reste « piece ».
BEGIN;
SET LOCAL lock_timeout='10s';
DO $unites$
DECLARE saved jsonb:='{}'; r record; content jsonb;
BEGIN
 IF to_regprocedure('public.create_sale_order(uuid,bigint,jsonb,uuid)') IS NULL
 OR to_regclass('public.vente_lignes') IS NULL THEN
  RAISE EXCEPTION 'La migration multi-produits doit être terminée avant cette migration';
 END IF;
 LOCK TABLE public.produits,public.ventes,public.vente_lignes,public.factures,
 public.reservations,public.payments,public.versements,public.customers,public.profiles,
 public.profile_shops,public.shops,public.invoice_counters,public.audit_logs IN ACCESS EXCLUSIVE MODE;
 FOR r IN SELECT unnest(ARRAY['produits','ventes','vente_lignes','factures','reservations','payments',
 'versements','customers','profiles','profile_shops','shops','invoice_counters','audit_logs']) AS name LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)-''unit'' ORDER BY (to_jsonb(t)-''unit'')::text),''[]''::jsonb) FROM public.%I t',r.name) INTO content;
  saved:=saved||jsonb_build_object(r.name,content);
 END LOOP;
 ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'piece' CHECK(unit IN ('piece','metre'));
 ALTER TABLE public.vente_lignes ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'piece' CHECK(unit IN ('piece','metre'));
 ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'piece' CHECK(unit IN ('piece','metre'));
 ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'piece' CHECK(unit IN ('piece','metre'));

 -- Conserve les montants stockés, sans supprimer/recréer une colonne. Les totaux
 -- seront ensuite imposés par des triggers BEFORE pour toutes les nouvelles écritures.
 -- PostgreSQL documente DROP EXPRESSION comme conservant les valeurs existantes.
 ALTER TABLE public.ventes ALTER COLUMN montant_total DROP EXPRESSION IF EXISTS;
 ALTER TABLE public.vente_lignes ALTER COLUMN total_amount DROP EXPRESSION IF EXISTS;
 ALTER TABLE public.reservations ALTER COLUMN total_amount DROP EXPRESSION IF EXISTS;
 ALTER TABLE public.reservations ALTER COLUMN remaining_amount DROP EXPRESSION IF EXISTS;
 ALTER TABLE public.produits ALTER COLUMN stock_quantite TYPE numeric USING stock_quantite::numeric;
 ALTER TABLE public.produits ALTER COLUMN reserved_quantity TYPE numeric USING reserved_quantity::numeric;
 ALTER TABLE public.ventes ALTER COLUMN quantite TYPE numeric USING quantite::numeric;
 ALTER TABLE public.vente_lignes ALTER COLUMN quantity TYPE numeric USING quantity::numeric;
 ALTER TABLE public.reservations ALTER COLUMN quantity TYPE numeric USING quantity::numeric;
 ALTER TABLE public.factures ALTER COLUMN quantity TYPE numeric USING quantity::numeric;

 CREATE OR REPLACE FUNCTION public.valid_measured_quantity(q numeric,u text,zero_ok boolean DEFAULT false)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(q IS NOT NULL AND q::text NOT IN ('NaN','Infinity','-Infinity')
  AND (q>0 OR (zero_ok AND q=0)) AND q=round(q,2)
  AND (u='metre' OR (u='piece' AND q=trunc(q))),false)
 $$;
 CREATE OR REPLACE FUNCTION public.check_product_unit() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF TG_OP='UPDATE' AND new.unit IS DISTINCT FROM old.unit THEN
   RAISE EXCEPTION 'L’unité d’un produit existant ne peut pas être changée : ses stocks et son historique doivent garder leur sens';
  END IF;
  IF NOT public.valid_measured_quantity(new.stock_quantite,new.unit,true)
   OR NOT public.valid_measured_quantity(new.reserved_quantity,new.unit,true) THEN
   RAISE EXCEPTION 'Stock invalide : entier pour une pièce, au plus deux décimales pour un mètre';
  END IF;
  RETURN new;
 END $$;

 DROP TRIGGER IF EXISTS measured_product ON public.produits;
 CREATE TRIGGER measured_product BEFORE INSERT OR UPDATE ON public.produits FOR EACH ROW EXECUTE FUNCTION public.check_product_unit();

 CREATE OR REPLACE FUNCTION public.measured_totals() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE u text; BEGIN
  IF TG_TABLE_NAME='ventes' THEN
   IF new.multi_produits THEN
    IF new.quantite<>1 THEN RAISE EXCEPTION 'Entête de commande invalide'; END IF;
   ELSE
    SELECT unit INTO u FROM public.produits WHERE id=new.produit_id AND shop_id=new.shop_id;
    IF NOT public.valid_measured_quantity(new.quantite,u) THEN RAISE EXCEPTION 'Quantité incompatible avec l’unité du produit'; END IF;
   END IF;
   new.montant_total:=round(new.quantite*new.prix_unitaire,2);
  ELSE
   SELECT unit INTO u FROM public.produits WHERE id=new.product_id AND shop_id=new.shop_id;
   IF NOT public.valid_measured_quantity(new.quantity,u) THEN RAISE EXCEPTION 'Quantité incompatible avec l’unité du produit'; END IF;
   IF TG_OP='INSERT' THEN new.unit:=u;
   ELSIF new.unit IS DISTINCT FROM old.unit THEN RAISE EXCEPTION 'Unité historique immuable'; END IF;
   new.total_amount:=round(new.quantity*new.unit_price,2);
   IF TG_TABLE_NAME='reservations' THEN new.remaining_amount:=new.total_amount-new.paid_amount; END IF;
  END IF;
  RETURN new;
 END $$;
 DROP TRIGGER IF EXISTS measured_totals ON public.ventes;
 CREATE TRIGGER measured_totals BEFORE INSERT OR UPDATE ON public.ventes FOR EACH ROW EXECUTE FUNCTION public.measured_totals();
 DROP TRIGGER IF EXISTS measured_totals ON public.vente_lignes;
 CREATE TRIGGER measured_totals BEFORE INSERT OR UPDATE ON public.vente_lignes FOR EACH ROW EXECUTE FUNCTION public.measured_totals();
 DROP TRIGGER IF EXISTS measured_totals ON public.reservations;
 CREATE TRIGGER measured_totals BEFORE INSERT OR UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.measured_totals();

 CREATE OR REPLACE FUNCTION public.create_sale_measured(p_shop_id uuid,p_product_id uuid,p_customer_id bigint,p_quantity numeric,p_unit_price numeric)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v uuid; BEGIN
  PERFORM public.require_shop(p_shop_id);
  IF p_unit_price IS NULL OR p_unit_price<0 OR p_unit_price::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Prix invalide'; END IF;
  INSERT INTO public.ventes(shop_id,produit_id,customer_id,quantite,prix_unitaire,mode_paiement,vendeuse_id)
  VALUES(p_shop_id,p_product_id,p_customer_id,p_quantity,p_unit_price,'especes',auth.uid()) RETURNING id INTO v;
  RETURN v;
 END $$;
 CREATE OR REPLACE FUNCTION public.restock_product_measured(p_shop_id uuid,p_product_id uuid,p_quantity numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE p public.produits; BEGIN
  PERFORM public.require_shop(p_shop_id);
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administratrice uniquement'; END IF;
  SELECT * INTO p FROM public.produits WHERE id=p_product_id AND shop_id=p_shop_id FOR UPDATE;
  IF NOT FOUND OR NOT public.valid_measured_quantity(p_quantity,p.unit) THEN RAISE EXCEPTION 'Quantité de réapprovisionnement invalide'; END IF;
  UPDATE public.produits SET stock_quantite=stock_quantite+p_quantity WHERE id=p.id;
 END $$;
 CREATE OR REPLACE FUNCTION public.create_reservation_measured(p_shop_id uuid,p_customer_id bigint,p_product_id uuid,p_quantity numeric,p_advance numeric,p_note text)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE p public.produits; r bigint; total numeric; BEGIN
  PERFORM public.require_shop(p_shop_id);
  SELECT * INTO p FROM public.produits WHERE id=p_product_id AND shop_id=p_shop_id AND actif FOR UPDATE;
  IF NOT FOUND OR NOT public.valid_measured_quantity(p_quantity,p.unit) OR p.stock_quantite-p.reserved_quantity<p_quantity THEN RAISE EXCEPTION 'Réservation ou stock disponible invalide'; END IF;
  total:=round(p.prix*p_quantity,2);
  IF p_advance IS NULL OR p_advance<0 OR p_advance>total OR p_advance::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Avance invalide'; END IF;
  INSERT INTO public.reservations(shop_id,customer_id,product_id,quantity,unit_price,paid_amount,status,note,created_by,unit)
  VALUES(p_shop_id,p_customer_id,p_product_id,p_quantity,p.prix,p_advance,CASE WHEN p_advance=total THEN 'paye' ELSE 'en_cours' END,p_note,auth.uid(),p.unit) RETURNING id INTO r;
  UPDATE public.produits SET reserved_quantity=reserved_quantity+p_quantity WHERE id=p.id;
  IF p_advance>0 THEN INSERT INTO public.payments(shop_id,reservation_id,amount,note,created_by)
   VALUES(p_shop_id,r,p_advance,'Avance',auth.uid()); END IF;
  RETURN r;
 END $$;
 -- Les anciennes signatures entières restent utilisables par les anciens écrans.
 CREATE OR REPLACE FUNCTION public.create_reservation(p_shop_id uuid,p_customer_id bigint,p_product_id uuid,p_quantity integer,p_advance numeric,p_note text)
 RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.create_reservation_measured(p_shop_id,p_customer_id,p_product_id,p_quantity::numeric,p_advance,p_note)
 $$;
 CREATE OR REPLACE FUNCTION public.mark_reservation_remis(p_shop_id uuid,p_reservation_id bigint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE r public.reservations; v uuid; BEGIN
  PERFORM public.require_shop(p_shop_id);
  SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id AND shop_id=p_shop_id FOR UPDATE;
  IF NOT FOUND OR r.status<>'paye' THEN RAISE EXCEPTION 'Réservation non payée ou déjà remise'; END IF;
  UPDATE public.produits SET reserved_quantity=reserved_quantity-r.quantity WHERE id=r.product_id AND shop_id=p_shop_id;
  v:=public.create_sale_measured(p_shop_id,r.product_id,r.customer_id,r.quantity,r.unit_price);
  UPDATE public.reservations SET status='remis',sale_id=v WHERE id=r.id;
 END $$;

-- Fonctions multi-produits et facturation compatibles, ci-dessous.

CREATE OR REPLACE FUNCTION public.issue_invoice() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE n bigint; y integer; s public.shops; p public.produits; c public.customers;
 BEGIN
 IF new.multi_produits THEN RETURN new; END IF;
 SELECT * INTO s FROM public.shops WHERE id=new.shop_id;
 SELECT * INTO p FROM public.produits WHERE id=new.produit_id;
 SELECT * INTO c FROM public.customers WHERE id=new.customer_id AND shop_id=new.shop_id;
 y:=extract(year FROM new.date_vente AT TIME ZONE 'Africa/Dakar');
 INSERT INTO public.invoice_counters VALUES(new.shop_id,y,1) ON CONFLICT(shop_id,year)
 DO UPDATE SET value=public.invoice_counters.value+1 RETURNING value INTO n;
 INSERT INTO public.vente_lignes(sale_id,shop_id,position,product_id,product_name,quantity,unit_price,purchase_price)
 VALUES(new.id,new.shop_id,1,p.id,p.nom_modele,new.quantite,new.prix_unitaire,p.purchase_price);
 INSERT INTO public.factures(shop_id,sale_id,numero,shop_name,product_name,customer_name,
 quantity,unit_price,total_amount,purchase_price,issued_at,items,customer_phone,customer_address,paid_amount,unit)
 VALUES(new.shop_id,new.id,s.code||'-'||y||'-'||lpad(n::text,greatest(6,length(n::text)),'0'),s.nom,p.nom_modele,
 coalesce(c.nom,'Client comptant'),new.quantite,new.prix_unitaire,new.montant_total,p.purchase_price,new.date_vente,
 jsonb_build_array(jsonb_build_object('product_id',p.id,'product_name',p.nom_modele,'quantity',new.quantite,
 'unit_price',new.prix_unitaire,'total_amount',new.montant_total,'purchase_price',p.purchase_price,'unit',p.unit)),c.telephone,c.adresse,new.montant_total,p.unit);
 RETURN new; END $$;

CREATE OR REPLACE FUNCTION public.create_sale_order(p_shop_id uuid,p_customer_id bigint,p_items jsonb,p_request_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE v uuid; old_sale public.ventes; s public.shops; c public.customers; p public.produits;
 item jsonb; qty numeric; price numeric; total numeric:=0; pos integer:=0; n bigint; y integer;
 snapshots jsonb:='[]'::jsonb; payload jsonb; created timestamptz:=now();
 BEGIN
 PERFORM public.require_shop(p_shop_id);
 IF p_request_id IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Commande invalide'; END IF;
 IF jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Ajoutez au moins un produit'; END IF;
 payload:=jsonb_build_object('customer_id',p_customer_id,'items',p_items);
 -- Deux clics/réessais de la même commande ne créent jamais deux ventes.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO old_sale FROM public.ventes WHERE request_id=p_request_id;
 IF FOUND THEN
  IF old_sale.shop_id<>p_shop_id OR old_sale.vendeuse_id<>auth.uid()
   OR old_sale.request_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Identifiant de commande déjà utilisé'; END IF;
  RETURN old_sale.id;
 END IF;
 IF p_customer_id IS NOT NULL THEN
  SELECT * INTO c FROM public.customers WHERE id=p_customer_id AND shop_id=p_shop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente étrangère à cette boutique'; END IF;
 END IF;
 -- Ordre stable des verrous pour les achats simultanés.
 PERFORM 1 FROM public.produits WHERE shop_id=p_shop_id AND id IN
  (SELECT (x->>'product_id')::uuid FROM jsonb_array_elements(p_items) x) ORDER BY id FOR UPDATE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number'
   OR jsonb_typeof(item->'unit_price') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Quantité ou prix invalide'; END IF;
  qty:=(item->>'quantity')::numeric; price:=(item->>'unit_price')::numeric;
  IF qty IS NULL OR qty<=0 OR price IS NULL OR price<0 OR price<>round(price,2) THEN RAISE EXCEPTION 'Quantité ou prix invalide'; END IF;
  SELECT * INTO p FROM public.produits WHERE id=(item->>'product_id')::uuid AND shop_id=p_shop_id AND actif;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produit indisponible dans cette boutique'; END IF;
  IF NOT public.valid_measured_quantity(qty,p.unit) THEN RAISE EXCEPTION 'Quantité incompatible avec l’unité du produit'; END IF;
  UPDATE public.produits SET stock_quantite=stock_quantite-qty,updated_at=now()
   WHERE id=p.id AND stock_quantite-reserved_quantity>=qty;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock insuffisant pour %',p.nom_modele; END IF;
  total:=total+round(qty*price,2);
  snapshots:=snapshots||jsonb_build_array(jsonb_build_object('product_id',p.id,'product_name',p.nom_modele,
   'quantity',qty,'unit_price',price,'total_amount',round(qty*price,2),'purchase_price',p.purchase_price,'unit',p.unit));
 END LOOP;
 INSERT INTO public.ventes(shop_id,produit_id,customer_id,quantite,prix_unitaire,mode_paiement,vendeuse_id,multi_produits,request_id,request_payload)
 VALUES(p_shop_id,null,p_customer_id,1,total,'especes',auth.uid(),true,p_request_id,payload) RETURNING id,date_vente INTO v,created;
 FOR item IN SELECT value FROM jsonb_array_elements(snapshots) LOOP
  pos:=pos+1;
  INSERT INTO public.vente_lignes(sale_id,shop_id,position,product_id,product_name,quantity,unit_price,purchase_price)
  VALUES(v,p_shop_id,pos,(item->>'product_id')::uuid,item->>'product_name',(item->>'quantity')::numeric,
   (item->>'unit_price')::numeric,(item->>'purchase_price')::numeric);
 END LOOP;
 SELECT * INTO s FROM public.shops WHERE id=p_shop_id;
 y:=extract(year FROM created AT TIME ZONE 'Africa/Dakar');
 INSERT INTO public.invoice_counters VALUES(p_shop_id,y,1) ON CONFLICT(shop_id,year)
 DO UPDATE SET value=public.invoice_counters.value+1 RETURNING value INTO n;
 INSERT INTO public.factures(shop_id,sale_id,numero,shop_name,product_name,customer_name,quantity,unit_price,
  total_amount,issued_at,items,customer_phone,customer_address,paid_amount)
 VALUES(p_shop_id,v,s.code||'-'||y||'-'||lpad(n::text,greatest(6,length(n::text)),'0'),s.nom,
  CASE WHEN pos=1 THEN snapshots->0->>'product_name' ELSE pos||' articles' END,
  coalesce(c.nom,'Client comptant'),1,total,total,created,snapshots,c.telephone,c.adresse,total);
 INSERT INTO public.audit_logs(shop_id,user_id,action,table_name,record_id,details)
 VALUES(p_shop_id,auth.uid(),'create','ventes',v::text,jsonb_build_object('total',total,'articles',pos));
 RETURN v;
 END $$;

CREATE OR REPLACE FUNCTION public.supprimer_vente_admin(p_shop_id uuid,p_vente_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v public.ventes; BEGIN
 PERFORM public.require_shop(p_shop_id);
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administratrice uniquement'; END IF;
 SELECT * INTO v FROM public.ventes WHERE id=p_vente_id AND shop_id=p_shop_id FOR UPDATE;
 IF NOT FOUND OR v.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Vente absente ou déjà annulée'; END IF;
 IF EXISTS(SELECT 1 FROM public.reservations WHERE sale_id=v.id) THEN RAISE EXCEPTION 'Une réservation remise ne peut pas être annulée comme vente comptant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vente_lignes WHERE sale_id=v.id) THEN RAISE EXCEPTION 'Lignes manquantes : annulation interrompue'; END IF;
 PERFORM 1 FROM public.produits WHERE shop_id=p_shop_id AND id IN
  (SELECT product_id FROM public.vente_lignes WHERE sale_id=v.id) ORDER BY id FOR UPDATE;
 UPDATE public.produits p SET stock_quantite=p.stock_quantite+l.qty,updated_at=now()
 FROM (SELECT product_id,sum(quantity) qty FROM public.vente_lignes WHERE sale_id=v.id GROUP BY product_id) l
 WHERE p.id=l.product_id AND p.shop_id=p_shop_id;
 UPDATE public.ventes SET cancelled_at=now() WHERE id=v.id;
 INSERT INTO public.audit_logs(shop_id,user_id,action,table_name,record_id)
 VALUES(p_shop_id,auth.uid(),'cancel','ventes',v.id::text);
 END $$;

 CREATE OR REPLACE FUNCTION public.sales_api_version() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 3 $$;
 REVOKE ALL ON FUNCTION public.create_sale_measured(uuid,uuid,bigint,numeric,numeric),
 public.restock_product_measured(uuid,uuid,numeric),public.create_reservation_measured(uuid,bigint,uuid,numeric,numeric,text),
 public.sales_api_version() FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.create_sale_measured(uuid,uuid,bigint,numeric,numeric),
 public.restock_product_measured(uuid,uuid,numeric),public.create_reservation_measured(uuid,bigint,uuid,numeric,numeric,text),
 public.sales_api_version() TO authenticated;
 REVOKE ALL ON FUNCTION public.measured_totals(),public.check_product_unit(),public.issue_invoice() FROM PUBLIC,anon,authenticated;
 REVOKE ALL ON FUNCTION public.create_sale_order(uuid,bigint,jsonb,uuid),public.supprimer_vente_admin(uuid,uuid) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.create_sale_order(uuid,bigint,jsonb,uuid),public.supprimer_vente_admin(uuid,uuid) TO authenticated;
 -- Les policies RLS et les droits des tables restent inchangés.
 FOR r IN SELECT key,value FROM jsonb_each(saved) LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)-''unit'' ORDER BY (to_jsonb(t)-''unit'')::text),''[]''::jsonb) FROM public.%I t',r.key) INTO content;
  IF content IS DISTINCT FROM r.value THEN RAISE EXCEPTION 'Conservation des données échouée pour % : migration annulée',r.key; END IF;
 END LOOP;
END $unites$;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT public.sales_api_version() AS version_ventes,
 (SELECT count(*) FROM public.produits) AS produits,
 (SELECT count(*) FROM public.ventes) AS ventes,
 (SELECT count(*) FROM public.factures) AS factures;

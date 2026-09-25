-- À exécuter séparément, UNE FOIS, après la migration multi-boutiques déjà installée.
-- Aucune table/vente/facture supprimée. Toute erreur annule la transaction entière.
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$ BEGIN
 IF to_regclass('public.vente_lignes') IS NOT NULL THEN
  RAISE EXCEPTION 'Les lignes de vente existent déjà : ne pas réexécuter cette migration';
 END IF;
 IF to_regprocedure('public.create_sale(uuid,uuid,bigint,integer,numeric)') IS NULL
 OR to_regprocedure('public.supprimer_vente_admin(uuid,uuid)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
   AND table_name='ventes' AND column_name='montant_total' AND is_generated='ALWAYS')
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
   AND table_name='customers' AND column_name='id' AND data_type='bigint') THEN
  RAISE EXCEPTION 'Schéma inattendu : demander un diagnostic avant toute modification';
 END IF;
END $$;
LOCK TABLE public.ventes, public.factures, public.produits IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE ventes_avant ON COMMIT DROP AS SELECT * FROM public.ventes;
CREATE TEMP TABLE factures_avant ON COMMIT DROP AS SELECT * FROM public.factures;
CREATE TEMP TABLE stocks_avant ON COMMIT DROP AS SELECT id,stock_quantite,reserved_quantity FROM public.produits;

-- Les anciennes colonnes et le total calculé restent intacts. Une commande utilise
-- quantite=1, prix_unitaire=total ; ses vrais articles se trouvent dans vente_lignes.
ALTER TABLE public.ventes ALTER COLUMN produit_id DROP NOT NULL;
ALTER TABLE public.ventes ADD COLUMN multi_produits boolean NOT NULL DEFAULT false,
 ADD COLUMN request_id uuid UNIQUE, ADD COLUMN request_payload jsonb,
 ADD CONSTRAINT vente_format CHECK (
  (NOT multi_produits AND produit_id IS NOT NULL) OR
  (multi_produits AND produit_id IS NULL AND quantite=1 AND request_id IS NOT NULL));
CREATE TABLE public.vente_lignes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_id uuid NOT NULL, shop_id uuid NOT NULL, position integer NOT NULL CHECK(position>0),
 product_id uuid NOT NULL, product_name text NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0), unit_price numeric(10,2) NOT NULL CHECK(unit_price>=0),
 total_amount numeric(12,2) GENERATED ALWAYS AS(quantity*unit_price) STORED,
 purchase_price numeric(12,2), UNIQUE(sale_id,position),
 FOREIGN KEY(sale_id,shop_id) REFERENCES public.ventes(id,shop_id),
 FOREIGN KEY(product_id,shop_id) REFERENCES public.produits(id,shop_id)
);
CREATE INDEX ON public.vente_lignes(shop_id);
ALTER TABLE public.vente_lignes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vente_lignes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.vente_lignes TO authenticated;
CREATE POLICY shop_read ON public.vente_lignes FOR SELECT TO authenticated USING(public.can_access_shop(shop_id));
CREATE TRIGGER immutable_shop BEFORE UPDATE ON public.vente_lignes FOR EACH ROW EXECUTE FUNCTION public.prevent_shop_move();
ALTER TABLE public.factures ADD COLUMN items jsonb,
 ADD COLUMN customer_phone text, ADD COLUMN customer_address text,
 ADD COLUMN paid_amount numeric(12,2) CHECK(paid_amount>=0 AND paid_amount<=total_amount);

-- Copie descriptive uniquement : ni nouveau débit de stock, ni nouvelle facture.
INSERT INTO public.vente_lignes(sale_id,shop_id,position,product_id,product_name,quantity,unit_price,purchase_price)
 SELECT v.id,v.shop_id,1,v.produit_id,coalesce(f.product_name,p.nom_modele),v.quantite,v.prix_unitaire,f.purchase_price
 FROM public.ventes v JOIN public.produits p ON p.id=v.produit_id
 LEFT JOIN public.factures f ON f.sale_id=v.id;
UPDATE public.factures f SET items=(SELECT jsonb_agg(jsonb_build_object(
 'product_id',l.product_id,'product_name',l.product_name,'quantity',l.quantity,
 'unit_price',l.unit_price,'total_amount',l.total_amount,'purchase_price',l.purchase_price) ORDER BY l.position)
 FROM public.vente_lignes l WHERE l.sale_id=f.sale_id);
-- Pas de téléphone/adresse historiques inventés ; anciennes factures inchangées.

CREATE OR REPLACE FUNCTION public.deduire_stock_apres_vente() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.require_shop(new.shop_id);
 IF new.multi_produits THEN RETURN new; END IF;
 UPDATE public.produits SET stock_quantite=stock_quantite-new.quantite,updated_at=now()
 WHERE id=new.produit_id AND shop_id=new.shop_id AND actif AND stock_quantite-reserved_quantity>=new.quantite;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock disponible insuffisant'; END IF;
 RETURN new; END $$;

-- Le chemin historique reste disponible (anciens navigateurs et réservations).
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
 quantity,unit_price,total_amount,purchase_price,issued_at,items,customer_phone,customer_address,paid_amount)
 VALUES(new.shop_id,new.id,s.code||'-'||y||'-'||lpad(n::text,greatest(6,length(n::text)),'0'),s.nom,p.nom_modele,
 coalesce(c.nom,'Client comptant'),new.quantite,new.prix_unitaire,new.montant_total,p.purchase_price,new.date_vente,
 jsonb_build_array(jsonb_build_object('product_id',p.id,'product_name',p.nom_modele,'quantity',new.quantite,
 'unit_price',new.prix_unitaire,'total_amount',new.montant_total,'purchase_price',p.purchase_price)),c.telephone,c.adresse,new.montant_total);
 RETURN new; END $$;

CREATE FUNCTION public.create_sale_order(p_shop_id uuid,p_customer_id bigint,p_items jsonb,p_request_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE v uuid; old_sale public.ventes; s public.shops; c public.customers; p public.produits;
 item jsonb; qty integer; price numeric; total numeric:=0; pos integer:=0; n bigint; y integer;
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
   OR jsonb_typeof(item->'unit_price') IS DISTINCT FROM 'number'
   OR (item->>'quantity')::numeric<>trunc((item->>'quantity')::numeric) THEN RAISE EXCEPTION 'Quantité ou prix invalide'; END IF;
  qty:=(item->>'quantity')::integer; price:=(item->>'unit_price')::numeric;
  IF qty IS NULL OR qty<=0 OR price IS NULL OR price<0 OR price<>round(price,2) THEN RAISE EXCEPTION 'Quantité ou prix invalide'; END IF;
  SELECT * INTO p FROM public.produits WHERE id=(item->>'product_id')::uuid AND shop_id=p_shop_id AND actif;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produit indisponible dans cette boutique'; END IF;
  UPDATE public.produits SET stock_quantite=stock_quantite-qty,updated_at=now()
   WHERE id=p.id AND stock_quantite-reserved_quantity>=qty;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock insuffisant pour %',p.nom_modele; END IF;
  total:=total+qty*price;
  snapshots:=snapshots||jsonb_build_array(jsonb_build_object('product_id',p.id,'product_name',p.nom_modele,
   'quantity',qty,'unit_price',price,'total_amount',qty*price,'purchase_price',p.purchase_price));
 END LOOP;
 INSERT INTO public.ventes(shop_id,produit_id,customer_id,quantite,prix_unitaire,mode_paiement,vendeuse_id,multi_produits,request_id,request_payload)
 VALUES(p_shop_id,null,p_customer_id,1,total,'especes',auth.uid(),true,p_request_id,payload) RETURNING id,date_vente INTO v,created;
 FOR item IN SELECT value FROM jsonb_array_elements(snapshots) LOOP
  pos:=pos+1;
  INSERT INTO public.vente_lignes(sale_id,shop_id,position,product_id,product_name,quantity,unit_price,purchase_price)
  VALUES(v,p_shop_id,pos,(item->>'product_id')::uuid,item->>'product_name',(item->>'quantity')::integer,
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
 FROM (SELECT product_id,sum(quantity)::integer qty FROM public.vente_lignes WHERE sale_id=v.id GROUP BY product_id) l
 WHERE p.id=l.product_id AND p.shop_id=p_shop_id;
 UPDATE public.ventes SET cancelled_at=now() WHERE id=v.id;
 INSERT INTO public.audit_logs(shop_id,user_id,action,table_name,record_id)
 VALUES(p_shop_id,auth.uid(),'cancel','ventes',v.id::text);
 END $$;
CREATE FUNCTION public.sales_api_version() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 2 $$;
REVOKE ALL ON FUNCTION public.create_sale_order(uuid,bigint,jsonb,uuid),public.sales_api_version() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_sale_order(uuid,bigint,jsonb,uuid),public.sales_api_version() TO authenticated;

-- Vérifications : toutes les valeurs historiques et tous les stocks sont préservés.
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ventes)<>(SELECT count(*) FROM ventes_avant)
 OR EXISTS(SELECT 1 FROM ventes_avant a JOIN public.ventes v USING(id)
  WHERE to_jsonb(a) IS DISTINCT FROM (to_jsonb(v)-ARRAY['multi_produits','request_id','request_payload']))
 OR (SELECT count(*) FROM public.factures)<>(SELECT count(*) FROM factures_avant)
 OR EXISTS(SELECT 1 FROM factures_avant a JOIN public.factures f USING(id)
  WHERE to_jsonb(a) IS DISTINCT FROM (to_jsonb(f)-ARRAY['items','customer_phone','customer_address','paid_amount']))
 OR EXISTS(SELECT * FROM stocks_avant EXCEPT SELECT id,stock_quantite,reserved_quantity FROM public.produits)
 THEN RAISE EXCEPTION 'Contrôle de conservation échoué'; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT public.sales_api_version() AS version_ventes,
 (SELECT count(*) FROM public.ventes) AS ventes,
 (SELECT count(*) FROM public.vente_lignes) AS lignes,
 (SELECT count(*) FROM public.factures) AS factures;

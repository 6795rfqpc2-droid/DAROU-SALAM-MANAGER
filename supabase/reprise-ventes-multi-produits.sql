-- REPRISE IDEMPOTENTE : utiliser ce fichier après une installation partielle.
-- Aucune suppression de données. Aucun débit/restock pendant la reprise.
-- Exécuter tout le fichier. Les contradictions arrêtent et annulent le bloc entier.
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $reprise$
DECLARE
 sales_before jsonb; invoices_before jsonb; lines_before jsonb; protected_before jsonb;
 sales_added text[]; invoices_added text[]; r record; spec record; def text;
 actual_type text; generated text; n integer;
BEGIN
 -- Contrôle explicite des prérequis multi-boutiques, sans présumer l'état de reprise.
 FOR r IN SELECT unnest(ARRAY['ventes','factures','produits','customers','shops','profiles',
 'profile_shops','reservations','payments','versements','invoice_counters','audit_logs']) AS name LOOP
  IF to_regclass('public.'||r.name) IS NULL THEN RAISE EXCEPTION 'Table préalable absente : public.%',r.name; END IF;
 END LOOP;
 IF to_regprocedure('public.require_shop(uuid)') IS NULL
 OR to_regprocedure('public.can_access_shop(uuid)') IS NULL
 OR to_regprocedure('public.is_admin()') IS NULL
 OR to_regprocedure('public.prevent_shop_move()') IS NULL
 OR to_regprocedure('public.create_sale(uuid,uuid,bigint,integer,numeric)') IS NULL THEN
  RAISE EXCEPTION 'Fonctions multi-boutiques préalables absentes : diagnostic nécessaire';
 END IF;
 LOCK TABLE public.ventes,public.factures,public.produits,public.customers,public.shops,
 public.profiles,public.profile_shops,public.reservations,public.payments,public.versements,
 public.invoice_counters,public.audit_logs IN SHARE ROW EXCLUSIVE MODE;
 SELECT coalesce(array_agg(x),'{}'::text[]) INTO sales_added
 FROM unnest(ARRAY['multi_produits','request_id','request_payload']) x WHERE NOT EXISTS
 (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ventes' AND column_name=x);
 SELECT coalesce(array_agg(x),'{}'::text[]) INTO invoices_added
 FROM unnest(ARRAY['customer_phone','customer_address','paid_amount']) x WHERE NOT EXISTS
 (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='factures' AND column_name=x);
 SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') INTO sales_before FROM public.ventes v;
 SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY id),'[]') INTO invoices_before FROM public.factures f;
 protected_before:='{}';
 FOR r IN SELECT unnest(ARRAY['produits','customers','shops','profiles','profile_shops',
 'reservations','payments','versements','invoice_counters','audit_logs']) AS name LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM public.%I t',r.name) INTO def;
  protected_before:=protected_before||jsonb_build_object(r.name,def::jsonb);
 END LOOP;

 ALTER TABLE public.ventes ADD COLUMN IF NOT EXISTS multi_produits boolean NOT NULL DEFAULT false;
 ALTER TABLE public.ventes ADD COLUMN IF NOT EXISTS request_id uuid;
 ALTER TABLE public.ventes ADD COLUMN IF NOT EXISTS request_payload jsonb;
 ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS items jsonb;
 ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS customer_phone text;
 ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS customer_address text;
 ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2);
 CREATE TABLE IF NOT EXISTS public.vente_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sale_id uuid NOT NULL,shop_id uuid NOT NULL,
  position integer NOT NULL CHECK(position>0),product_id uuid NOT NULL,product_name text NOT NULL,
  quantity integer NOT NULL CHECK(quantity>0),unit_price numeric(10,2) NOT NULL CHECK(unit_price>=0),
  total_amount numeric(12,2) GENERATED ALWAYS AS(quantity*unit_price) STORED,purchase_price numeric(12,2),
  UNIQUE(sale_id,position),
  FOREIGN KEY(sale_id,shop_id) REFERENCES public.ventes(id,shop_id),
  FOREIGN KEY(product_id,shop_id) REFERENCES public.produits(id,shop_id)
 );
 LOCK TABLE public.vente_lignes IN SHARE ROW EXCLUSIVE MODE;
 -- Si une structure externe diffère, ne pas convertir les valeurs à l'aveugle.
 FOR spec IN SELECT * FROM (VALUES
 ('ventes','id','uuid'),('ventes','shop_id','uuid'),('ventes','produit_id','uuid'),
 ('ventes','quantite','integer'),('ventes','prix_unitaire','numeric(10,2)'),('ventes','montant_total','numeric(10,2)'),
 ('ventes','multi_produits','boolean'),('ventes','request_id','uuid'),('ventes','request_payload','jsonb'),
 ('customers','id','bigint'),('produits','id','uuid'),('produits','stock_quantite','integer'),
 ('factures','items','jsonb'),('factures','customer_phone','text'),('factures','customer_address','text'),('factures','paid_amount','numeric(12,2)'),
 ('vente_lignes','id','uuid'),('vente_lignes','sale_id','uuid'),('vente_lignes','shop_id','uuid'),
 ('vente_lignes','position','integer'),('vente_lignes','product_id','uuid'),('vente_lignes','product_name','text'),
 ('vente_lignes','quantity','integer'),('vente_lignes','unit_price','numeric(10,2)'),
 ('vente_lignes','total_amount','numeric(12,2)'),('vente_lignes','purchase_price','numeric(12,2)')
 ) AS x(tbl,col,typ) LOOP
  SELECT format_type(a.atttypid,a.atttypmod) INTO actual_type FROM pg_attribute a
   WHERE a.attrelid=to_regclass('public.'||spec.tbl) AND a.attname=spec.col AND NOT a.attisdropped;
  IF actual_type IS DISTINCT FROM spec.typ THEN RAISE EXCEPTION 'Structure inattendue %.% : type %, attendu % ; aucune donnée modifiée',spec.tbl,spec.col,actual_type,spec.typ; END IF;
 END LOOP;
 SELECT a.attgenerated INTO generated FROM pg_attribute a WHERE a.attrelid='public.ventes'::regclass AND a.attname='montant_total';
 IF generated IS DISTINCT FROM 's' THEN RAISE EXCEPTION 'Le total des ventes doit être une colonne calculée'; END IF;
 SELECT a.attgenerated INTO generated FROM pg_attribute a WHERE a.attrelid='public.vente_lignes'::regclass AND a.attname='total_amount';
 IF generated IS DISTINCT FROM 's' THEN RAISE EXCEPTION 'Le total des lignes doit être une colonne calculée'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]') INTO lines_before FROM public.vente_lignes l;
 ALTER TABLE public.ventes ALTER COLUMN produit_id DROP NOT NULL;
 ALTER TABLE public.ventes ALTER COLUMN multi_produits SET DEFAULT false;
 ALTER TABLE public.ventes ALTER COLUMN multi_produits SET NOT NULL;
 FOR r IN SELECT unnest(ARRAY['id','sale_id','shop_id','position','product_id','product_name','quantity','unit_price']) AS name LOOP
  EXECUTE format('ALTER TABLE public.vente_lignes ALTER COLUMN %I SET NOT NULL',r.name);
 END LOOP;
 ALTER TABLE public.vente_lignes ALTER COLUMN id SET DEFAULT gen_random_uuid();

 -- Contraintes du schéma d'origine : créer celles qui manquent, valider celles présentes.
 FOR spec IN SELECT * FROM (VALUES
 ('ventes','ventes_request_id_key','UNIQUE (request_id)'),
 ('ventes','vente_format','CHECK (((NOT multi_produits) AND (produit_id IS NOT NULL)) OR (multi_produits AND (produit_id IS NULL) AND (quantite = 1) AND (request_id IS NOT NULL)))'),
 ('factures','factures_paid_amount_check','CHECK ((paid_amount >= 0) AND (paid_amount <= total_amount))'),
 ('vente_lignes','vente_lignes_pkey','PRIMARY KEY (id)'),
 ('vente_lignes','vente_lignes_sale_id_position_key','UNIQUE (sale_id, position)'),
 ('vente_lignes','vente_lignes_position_check','CHECK (position > 0)'),
 ('vente_lignes','vente_lignes_quantity_check','CHECK (quantity > 0)'),
 ('vente_lignes','vente_lignes_unit_price_check','CHECK (unit_price >= 0)'),
 ('vente_lignes','vente_lignes_sale_id_shop_id_fkey','FOREIGN KEY (sale_id, shop_id) REFERENCES public.ventes(id, shop_id)'),
 ('vente_lignes','vente_lignes_product_id_shop_id_fkey','FOREIGN KEY (product_id, shop_id) REFERENCES public.produits(id, shop_id)')
 ) AS x(tbl,name,definition) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.'||spec.tbl) AND conname=spec.name) THEN
   EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',spec.tbl,spec.name,spec.definition);
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.'||spec.tbl)
   AND conname=spec.name AND contype IN ('c','f') AND NOT convalidated) THEN
   EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',spec.tbl,spec.name);
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
  WHERE i.indrelid='public.vente_lignes'::regclass AND i.indisvalid AND a.attname='shop_id') THEN
  CREATE INDEX vente_lignes_shop_id_reprise_idx ON public.vente_lignes(shop_id);
 END IF;
 -- Ne jamais déclencher un débit de stock via une ligne descriptive de reprise.
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.vente_lignes'::regclass AND NOT tgisinternal
  AND tgfoid<>'public.prevent_shop_move()'::regprocedure) THEN
  RAISE EXCEPTION 'Déclencheur inconnu sur vente_lignes : contrôle nécessaire avant reprise';
 END IF;

 -- Les lignes déjà présentes sont intouchables. Les anciennes ventes mono-article
 -- sans ligne peuvent être reconstituées exactement depuis leurs colonnes d'origine.
 INSERT INTO public.vente_lignes(sale_id,shop_id,position,product_id,product_name,quantity,unit_price,purchase_price)
 SELECT v.id,v.shop_id,1,v.produit_id,coalesce(f.product_name,p.nom_modele),v.quantite,v.prix_unitaire,f.purchase_price
 FROM public.ventes v JOIN public.produits p ON p.id=v.produit_id AND p.shop_id=v.shop_id
 LEFT JOIN public.factures f ON f.sale_id=v.id
 WHERE NOT v.multi_produits AND NOT EXISTS(SELECT 1 FROM public.vente_lignes l WHERE l.sale_id=v.id);

 -- Pour une commande multi-produits incomplète, seule sa facture figée peut fournir
 -- les articles manquants. Aucun nom/coût historique n'est déduit du catalogue actuel.
 FOR r IN SELECT v.id,v.shop_id,v.montant_total,f.items FROM public.ventes v
  JOIN public.factures f ON f.sale_id=v.id WHERE v.multi_produits LOOP
  IF r.items IS NOT NULL AND r.items<>'[]'::jsonb THEN
   IF jsonb_typeof(r.items)<>'array' THEN RAISE EXCEPTION 'Facture de la vente % : articles invalides',r.id; END IF;
   IF (SELECT sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric) FROM jsonb_array_elements(r.items) x)
     IS DISTINCT FROM r.montant_total THEN RAISE EXCEPTION 'Facture de la vente % : total contradictoire',r.id; END IF;
   INSERT INTO public.vente_lignes(sale_id,shop_id,position,product_id,product_name,quantity,unit_price,purchase_price)
   SELECT r.id,r.shop_id,x.ord::integer,(x.item->>'product_id')::uuid,x.item->>'product_name',
    (x.item->>'quantity')::integer,(x.item->>'unit_price')::numeric,(x.item->>'purchase_price')::numeric
   FROM jsonb_array_elements(r.items) WITH ORDINALITY AS x(item,ord)
   WHERE NOT EXISTS(SELECT 1 FROM public.vente_lignes l WHERE l.sale_id=r.id AND l.position=x.ord);
  END IF;
 END LOOP;
 -- Refuser une reconstruction ambiguë au lieu de deviner les articles/stocks.
 IF EXISTS(SELECT 1 FROM public.ventes v WHERE NOT EXISTS(SELECT 1 FROM public.factures f WHERE f.sale_id=v.id)
  OR NOT EXISTS(SELECT 1 FROM public.vente_lignes l WHERE l.sale_id=v.id)
  OR v.montant_total IS DISTINCT FROM (SELECT sum(l.total_amount) FROM public.vente_lignes l WHERE l.sale_id=v.id)) THEN
  RAISE EXCEPTION 'Vente sans facture/lignes fiables ou total contradictoire : aucune modification conservée';
 END IF;
 IF EXISTS(SELECT 1 FROM public.ventes v JOIN public.vente_lignes l ON l.sale_id=v.id WHERE NOT v.multi_produits
  AND (l.position<>1 OR l.product_id<>v.produit_id OR l.quantity<>v.quantite OR l.unit_price<>v.prix_unitaire OR l.shop_id<>v.shop_id)) THEN
  RAISE EXCEPTION 'Lignes existantes incompatibles avec une ancienne vente : aucune modification conservée';
 END IF;
 UPDATE public.factures f SET items=(SELECT jsonb_agg(jsonb_build_object(
  'product_id',l.product_id,'product_name',l.product_name,'quantity',l.quantity,'unit_price',l.unit_price,
  'total_amount',l.total_amount,'purchase_price',l.purchase_price) ORDER BY l.position)
  FROM public.vente_lignes l WHERE l.sale_id=f.sale_id)
 WHERE f.items IS NULL OR f.items='[]'::jsonb;
 FOR r IN SELECT * FROM public.factures LOOP
  IF jsonb_typeof(r.items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Facture % : articles invalides',r.numero; END IF;
  IF r.total_amount IS DISTINCT FROM (SELECT montant_total FROM public.ventes WHERE id=r.sale_id AND shop_id=r.shop_id)
   OR jsonb_array_length(r.items)<>(SELECT count(*) FROM public.vente_lignes WHERE sale_id=r.sale_id)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.items) WITH ORDINALITY x(item,ord)
    FULL JOIN (SELECT * FROM public.vente_lignes WHERE sale_id=r.sale_id) l ON l.position=x.ord
    WHERE l.id IS NULL OR x.item IS NULL OR l.shop_id<>r.shop_id
     OR (x.item->>'product_id')::uuid IS DISTINCT FROM l.product_id
     OR (x.item->>'product_name') IS DISTINCT FROM l.product_name
     OR (x.item->>'quantity')::numeric IS DISTINCT FROM l.quantity
     OR (x.item->>'unit_price')::numeric IS DISTINCT FROM l.unit_price
     OR (x.item->>'total_amount')::numeric IS DISTINCT FROM l.total_amount
     OR (x.item->>'purchase_price')::numeric IS DISTINCT FROM l.purchase_price) THEN
   RAISE EXCEPTION 'Facture % et lignes contradictoires : données conservées, diagnostic nécessaire',r.numero;
  END IF;
 END LOOP;

 -- Sur cette seule nouvelle table, une policy permissive oubliée élargirait l'accès.
 ALTER TABLE public.vente_lignes ENABLE ROW LEVEL SECURITY;
 FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='vente_lignes' LOOP
  EXECUTE format('DROP POLICY %I ON public.vente_lignes',r.policyname);
 END LOOP;
 REVOKE ALL ON public.vente_lignes FROM PUBLIC,anon,authenticated;
 FOR r IN SELECT attname FROM pg_attribute WHERE attrelid='public.vente_lignes'::regclass AND attnum>0 AND NOT attisdropped LOOP
  EXECUTE format('REVOKE ALL (%I) ON public.vente_lignes FROM PUBLIC,anon,authenticated',r.attname);
 END LOOP;
 GRANT SELECT ON public.vente_lignes TO authenticated;
 CREATE POLICY shop_read ON public.vente_lignes FOR SELECT TO authenticated USING(public.can_access_shop(shop_id));
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.vente_lignes'::regclass AND tgname='immutable_shop' AND NOT tgisinternal) THEN
  CREATE TRIGGER immutable_shop BEFORE UPDATE ON public.vente_lignes FOR EACH ROW EXECUTE FUNCTION public.prevent_shop_move();
 END IF;
 ALTER TABLE public.vente_lignes ENABLE TRIGGER immutable_shop;

-- FONCTIONS_REPRISE

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

CREATE OR REPLACE FUNCTION public.create_sale_order(p_shop_id uuid,p_customer_id bigint,p_items jsonb,p_request_id uuid)
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
CREATE OR REPLACE FUNCTION public.sales_api_version() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 2 $$;
REVOKE ALL ON FUNCTION public.create_sale_order(uuid,bigint,jsonb,uuid),public.sales_api_version() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_sale_order(uuid,bigint,jsonb,uuid),public.sales_api_version() TO authenticated;

 -- Les fonctions remplacées n'exécutent aucun mouvement pendant l'installation.
 REVOKE ALL ON FUNCTION public.supprimer_vente_admin(uuid,uuid) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.supprimer_vente_admin(uuid,uuid) TO authenticated;
 REVOKE ALL ON FUNCTION public.deduire_stock_apres_vente(),public.issue_invoice() FROM PUBLIC,anon,authenticated;
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='public' AND p.proname IN ('supprimer_vente','supprimer_vente_admin') AND p.pronargs=1 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
 FOR spec IN SELECT * FROM (VALUES
  ('trg_deduire_stock','public.deduire_stock_apres_vente()'),
  ('invoice_after_sale','public.issue_invoice()')) AS x(name,fn) LOOP
  SELECT count(*) INTO n FROM pg_trigger WHERE tgrelid='public.ventes'::regclass AND NOT tgisinternal AND tgfoid=to_regprocedure(spec.fn);
  IF n=0 THEN
   EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON public.ventes FOR EACH ROW EXECUTE FUNCTION %s',spec.name,spec.fn);
  ELSIF n<>1 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.ventes'::regclass AND NOT tgisinternal
   AND tgfoid=to_regprocedure(spec.fn) AND tgtype<>5) THEN
   RAISE EXCEPTION 'Déclencheurs de vente inattendus pour % : reprise arrêtée',spec.fn;
  END IF;
  SELECT tgname INTO def FROM pg_trigger WHERE tgrelid='public.ventes'::regclass AND NOT tgisinternal AND tgfoid=to_regprocedure(spec.fn);
  EXECUTE format('ALTER TABLE public.ventes ENABLE TRIGGER %I',def);
 END LOOP;
 ALTER TABLE public.ventes ENABLE ROW LEVEL SECURITY;
 ALTER TABLE public.factures ENABLE ROW LEVEL SECURITY;
 REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.ventes,public.factures FROM PUBLIC,anon,authenticated;

 -- Contrôles de conservation : toutes les lignes déjà présentes restent identiques.
 IF sales_before IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(v)-sales_added ORDER BY id),'[]') FROM public.ventes v) THEN
  RAISE EXCEPTION 'Conservation des ventes échouée';
 END IF;
 IF jsonb_array_length(invoices_before)<>(SELECT count(*) FROM public.factures)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(invoices_before) old
  LEFT JOIN public.factures f ON f.id=(old->>'id')::uuid
  WHERE f.id IS NULL OR (old-'items') IS DISTINCT FROM (to_jsonb(f)-invoices_added-'items')
   OR (old->'items' IS NOT NULL AND old->'items'<>'null'::jsonb AND old->'items'<>'[]'::jsonb
    AND old->'items' IS DISTINCT FROM f.items)) THEN RAISE EXCEPTION 'Conservation des factures échouée'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(lines_before) old LEFT JOIN public.vente_lignes l ON l.id=(old->>'id')::uuid
  WHERE l.id IS NULL OR old IS DISTINCT FROM to_jsonb(l)) THEN RAISE EXCEPTION 'Conservation des lignes existantes échouée'; END IF;
 FOR r IN SELECT key,value FROM jsonb_each(protected_before) LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM public.%I t',r.key) INTO def;
  IF r.value IS DISTINCT FROM def::jsonb THEN RAISE EXCEPTION 'Conservation de public.% échouée',r.key; END IF;
 END LOOP;
END $reprise$;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT public.sales_api_version() AS version_ventes,
 (SELECT count(*) FROM public.ventes) AS ventes,
 (SELECT count(*) FROM public.vente_lignes) AS lignes,
 (SELECT count(*) FROM public.factures) AS factures,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.vente_lignes'::regclass) AS rls_lignes;

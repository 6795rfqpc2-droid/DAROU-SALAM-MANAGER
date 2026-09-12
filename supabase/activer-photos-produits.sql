-- À exécuter dans SQL Editor. Aucune modification des produits ou des boutiques.
-- Bucket privé : lecture limitée aux boutiques attribuées, envoi réservé aux admins.
BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('product-photos','product-photos',false,5242880,
 ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT(id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='product-photos' AND public) THEN
  RAISE EXCEPTION 'Ce bucket existe déjà en mode public : vérifier sa configuration avant de continuer';
 END IF;
END $$;

DROP POLICY IF EXISTS ds_product_photos_insert ON storage.objects;
CREATE POLICY ds_product_photos_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
 bucket_id='product-photos'
 AND public.is_admin()
 AND split_part(name,'/',2)=auth.uid()::text
 AND EXISTS(SELECT 1 FROM public.shops s
   WHERE s.id::text=split_part(name,'/',1) AND public.can_access_shop(s.id))
);
DROP POLICY IF EXISTS ds_product_photos_read ON storage.objects;
CREATE POLICY ds_product_photos_read ON storage.objects
FOR SELECT TO authenticated USING (
 bucket_id='product-photos'
 AND EXISTS(SELECT 1 FROM public.shops s
   WHERE s.id::text=split_part(name,'/',1) AND public.can_access_shop(s.id))
);
COMMIT;
SELECT id,name,public,file_size_limit FROM storage.buckets WHERE id='product-photos';

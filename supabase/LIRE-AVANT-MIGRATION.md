# Installation multi-boutiques

La migration n’a pas été exécutée sur votre projet Supabase. Les tests utilisent une base PostgreSQL locale reconstruite à partir du diagnostic fourni.

## Mise en service

1. Pendant l’installation, fermer les sessions de vente et conserver une sauvegarde récente de la base.
2. Dans SQL Editor du projet `uofuxxzloqweiykhemlj`, exécuter **tout** le fichier `migration-multi-boutiques.sql`. Le script est transactionnel et s’arrête si les tables ne correspondent plus au diagnostic. Ne pas le découper. Il s’exécute une seule fois.
3. Une fois la transaction réussie, publier ensemble `index.html`, `style.css`, `script.js`, `shops.js` et `shops-core.js` sur l’hébergement actuel. La nouvelle interface exige cette migration ; l’ancienne interface n’est pas compatible avec les nouvelles signatures SQL.
4. Se reconnecter comme administratrice. Vérifier les données anciennes dans Khady, puis les boutiques Adama et Amary (catégories initiales, aucun produit ni vente copiés).
5. Dans Personnel, cocher les boutiques autorisées et enregistrer. Le personnel existant garde seulement Khady ; un nouveau personnel n’a aucun accès avant affectation. L’administratrice accède aux trois boutiques et à l’option Toutes les boutiques.
6. Vérifier avec un compte personnel l’accès autorisé et le refus des autres boutiques. Les règles de sécurité s’appliquent même si le navigateur est manipulé.

La fonction distante `create-staff` n’était pas incluse dans le diagnostic. Une implémentation vérifiant la session et le rôle administrateur actif est fournie dans `functions/create-staff/index.ts`. Déployer cette version si la fonction existante ne fait pas ces vérifications. Aucune clé privée ne doit être ajoutée aux fichiers du site.

## Conservation et règles de calcul

- Les anciennes lignes catégories, produits, clients et ventes sont rattachées à Khady. Aucun identifiant métier n’est remplacé. Les nombres de lignes sont contrôlés dans la transaction.
- Les cinq tables du diagnostic ne contenaient ni factures, ni réservations, ni paiements, ni versements. Ces modules sont créés vides, sauf les archives de factures reconstituées à partir des ventes anciennes. Les noms avant d’éventuels renommages passés ne peuvent pas être retrouvés dans ce diagnostic.
- Les factures enregistrent leur numéro, le nom de la boutique, du produit et du client ainsi que le coût d’achat au moment de la vente. Les changements ultérieurs ne réécrivent pas les factures. Les archives anciennes sont identifiées par `KHF-ARCHIVE-…` et leur coût d’achat reste inconnu.
- Annuler une vente comptant restitue le stock et conserve la vente et la facture. Une vente issue d’une réservation remise ne peut pas être annulée par cette action. Une réservation ayant reçu un paiement ne peut pas être annulée sans traitement explicite de son remboursement ; ce parcours de remboursement n’est pas fourni dans cette version.
- Une vente est comptabilisée lors de la vente comptant ou de la remise d’une réservation payée. Les encaissements cumulent les ventes comptant et les paiements des réservations, sans doubler les réservations remises.
- Un versement correspond à une remise à l’administratrice, distincte du paiement client. Le reste à verser est « encaissements − versements ». Un solde négatif reste visible.
- Le bénéfice estimé utilise les coûts figés dans les factures et ne déduit pas les charges. Il est signalé comme indéterminé quand un coût historique manque.
- Le bilan mensuel filtre les flux par mois (dates UTC, identiques à Dakar). Il indique le stock **actuel**, pas un inventaire historique de clôture. Les annulations sont prises en compte selon l’état actuel des ventes. Le solde du mois exclut le report antérieur. Il ne constitue pas un arrêté comptable figé.
- Le changement de boutique recharge le document : les formulaires en cours sont abandonnés et les anciennes réponses réseau ne peuvent pas remplir la nouvelle boutique.
- La pagination récupère toutes les lignes accessibles, au-delà de la limite habituelle de l’API. Sur une base volumineuse, prévoir ultérieurement des agrégations SQL et une pagination d’affichage. Les lectures des différentes tables ne constituent pas un instantané transactionnel unique pendant les écritures d’autres utilisateurs.
- Pour les photos, exécuter séparément `activer-photos-produits.sql` si le bucket est absent. Il crée `product-photos` en mode privé (JPG, PNG, WebP, GIF ; maximum 5 Mo). Le site utilise des chemins boutique/utilisateur/fichier et génère des liens temporaires d’une heure à chaque actualisation. Les administrateurs actifs envoient les photos ; la lecture dépend des boutiques attribuées. Aucune modification des lignes produit n’est effectuée par ce script. Référence : [contrôle des accès Supabase Storage](https://supabase.com/docs/guides/storage/security/access-control).

## Vérifications reproductibles

`npm ci` puis `npm test` exécutent les tests de calcul, d’interface et de migration/RLS avec des données fictives. `npm run check` vérifie la syntaxe JavaScript.

`tests/browser-check.cjs` utilise Playwright et Edge en mode invisible, intercepte toutes les requêtes et vérifie les changements de boutique, le mobile et les documents. La variable `PLAYWRIGHT_PACKAGE` peut pointer vers l’installation locale de Playwright. Les captures et les PDF de test restent dans `test-results/`, exclu de Git.

Références de sécurité : [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) et [fonctions PostgreSQL Supabase](https://supabase.com/docs/guides/database/functions).

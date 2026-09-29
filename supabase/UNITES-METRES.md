# Activer la vente de tissus au mètre

Cette mise à jour complète la migration multi-produits déjà appliquée. Elle ne crée aucune vente et ne fait aucun mouvement de stock.

## Dans Supabase

1. Ouvrir **SQL Editor → New query** dans le projet de DAROU SALAM MANAGER.
2. Copier **tout** le contenu de `supabase/migration-unites-metres.sql`, du début à la fin, puis cliquer sur **Run**. Éviter les saisies de ventes pendant cette opération : les tables sont brièvement verrouillées.
3. Le résultat doit afficher **version_ventes = 3**, accompagné des nombres de produits, ventes et factures conservés.
4. Actualiser le site, puis sélectionner **Boutique Adama Faye**.

Ne pas réexécuter `migration-multi-boutiques.sql`, `migration-ventes-multi-produits.sql` ni `reprise-ventes-multi-produits.sql` pour cette activation. Le nouveau fichier est autonome après la reprise multi-produits réussie. Il est réexécutable, y compris après l'enregistrement de ventes au mètre.

Si Supabase signale une erreur, conserver le message exact. Le script applique les changements dans une transaction : toute erreur avant la validation annule cette tentative. Il n'est jamais nécessaire de vider une table.

## Utilisation

- **Ajouter un produit** dans Adama : l'unité proposée est **Mètre**. Saisir les mètres disponibles (par exemple 50), le prix d'achat par mètre et le prix de vente par mètre.
- **Pièce** reste disponible, et reste le choix proposé dans les autres boutiques.
- Les quantités au mètre acceptent la virgule ou le point, avec deux décimales au maximum : 1,5 ; 2,25 ; 3,5. Une pièce conserve une quantité entière.
- Une même vente peut réunir plusieurs tissus et des produits à la pièce. Chaque ligne conserve son unité et son prix. La facture unique affiche les métrages, prix par mètre et sous-totaux.
- Une vente de 3,5 m à 2 500 F/m produit un total de 8 750 F et ramène un stock de 50 m à 46,5 m. L'annulation administrative restaure les 3,5 m, une seule fois.
- Les réservations, réapprovisionnements et statistiques prennent en charge les mètres. Les statistiques affichent séparément mètres et pièces.

Les produits déjà enregistrés gardent l'unité **Pièce** ainsi que tous leurs stocks, prix, ventes et factures. L'unité d'un produit existant est verrouillée pour ne pas changer le sens de son historique. Pour un nouveau tissu, choisir **Mètre** à sa création ; aucune ancienne référence n'est automatiquement convertie.

## Protection des données et vérifications

La migration ajoute l'unité et rend les quantités décimales. Elle compare les données de toutes les tables métier avant et après, hors nouvelle colonne d'unité, et annule l'opération si une valeur historique a changé. Les montants historiques sont conservés ; des déclencheurs calculent les montants des futures écritures. Les politiques RLS existantes restent en place et les nouvelles fonctions vérifient l'accès à la boutique. Le réapprovisionnement et l'annulation restent réservés à l'administratrice.

Les tests locaux PostgreSQL couvrent la réexécution, la conservation de l'historique, les commandes mixtes, le stock, l'annulation, les réservations, les pièces entières et les accès interdits. Le parcours navigateur couvre la création d'un tissu, la saisie « 3,5 », la vente, la facture sur téléphone, le téléchargement PDF et la restauration du stock. Ils ne remplacent pas la confirmation d'exécution dans votre base Supabase.

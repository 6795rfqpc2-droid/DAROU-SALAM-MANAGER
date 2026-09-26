# Activer les commandes multi-produits

## Si une première tentative a déjà créé des éléments

Utiliser **`reprise-ventes-multi-produits.sql`**, et non le fichier d'installation
initiale. Copier tout le fichier dans une nouvelle requête Supabase, puis Run.
Le résultat attendu est `version_ventes = 2` et `rls_lignes = true`.
Ce fichier peut être réexécuté sans dupliquer les ventes, factures ou lignes.

`diagnostic-reprise-ventes.sql` est une lecture seule facultative pour transmettre
l'état exact des colonnes, fonctions, contraintes, déclencheurs, policies et droits
de la base. La présence de la table `vente_lignes` seule ne prouve pas que toutes
les fonctions et sécurités sont installées.

La reprise ajoute les colonnes absentes, complète les contraintes connues, réinstalle
les fonctions compatibles et les permissions requises. Elle conserve les identifiants
et valeurs de toutes les lignes déjà présentes. Elle n'exécute aucune vente et aucun
mouvement de stock. Les anciennes ventes sans ligne reçoivent leur description ;
les commandes multi-produits incomplètes ne peuvent être complétées qu'à partir de
leur facture déjà enregistrée. Seul un tableau d'articles de facture vide ou absent
peut être complété. Les autres informations de facture restent intactes.

Le RLS de `vente_lignes` est activé et ses policies remplacées par la lecture limitée
aux boutiques autorisées. Les écritures directes du navigateur sont interdites ;
elles passent par les fonctions contrôlées. Les policies des autres tables ne sont
pas remplacées. Les anciennes fonctions d'annulation non sécurisées restent interdites.

La reprise compare avant/après les ventes, factures et lignes existantes, produits,
stocks, clientes, réservations, paiements, boutiques, utilisateurs, affectations,
compteurs et journal. Si un type est inattendu, si les articles se contredisent ou
si une commande ne peut pas être reconstruite avec certitude, **tout le bloc est
annulé** et un diagnostic est demandé. Ne supprimer aucune donnée pour contourner
ce contrôle. Les tests utilisent une base locale fictive, pas la base Supabase réelle.

## Ce qui change

Une commande crée une seule ligne principale dans `ventes`, plusieurs articles dans
`vente_lignes` et une seule facture dans `factures`. Le total de `ventes` reste
compatible avec les statistiques et les bilans. Pour les nouvelles commandes, les
quantités et prix détaillés se lisent dans `vente_lignes`, pas dans les colonnes
historiques `ventes.quantite` et `ventes.prix_unitaire` (1 × total).

Les anciennes ventes gardent leurs identifiants, dates, montants et factures.
La migration ajoute leurs lignes descriptives sans modifier le stock. Elle ne
supprime aucune table ni donnée. Les annulations conservent la vente et sa facture,
avec la mention « Annulée », et remettent tous les articles en stock une seule fois.

Le contrôle avant/après utilise désormais des variables JSON dans un seul bloc
`DO $migration$`. Il ne dépend d'aucune table temporaire ou table de sauvegarde
préexistante. Le bloc complet est atomique même lorsqu'il est envoyé comme une
seule instruction SQL ; le fichier conserve également sa transaction explicite.

## À faire dans Supabase

1. Ouvrir le projet utilisé par DAROU SALAM MANAGER, puis **SQL Editor → New query**.
2. Copier **tout le contenu de `migration-ventes-multi-produits.sql`**, dans ce même dossier.
3. Cliquer **Run** une seule fois. Le fichier commence par `BEGIN` et termine par
   `COMMIT` puis un contrôle : exécuter l'ensemble, pas une sélection partielle.
4. Le résultat doit afficher `version_ventes = 2`, puis les nombres de ventes,
   lignes et factures. À l'installation, les nombres de ventes et factures restent
   inchangés ; chaque ancienne vente obtient une ligne descriptive.
5. Actualiser le site avec **Ctrl + F5**. Dans **Nouvelle vente**, le bouton
   **+ Ajouter un produit** devient disponible.

**Ne pas exécuter `migration-multi-boutiques.sql` : elle a déjà été installée.**
Si Supabase signale une erreur, la transaction ne doit pas être poursuivie morceau
par morceau. Conserver le message complet pour diagnostic. Si elle indique que
les lignes existent déjà, ne pas la relancer : vérifier `SELECT public.sales_api_version();`.

## Compatibilité et fonctionnement

- Le site vérifie la version de l'API. Avant l'installation SQL, la vente à un seul
  article continue d'utiliser l'ancienne fonction. Après installation, les commandes
  utilisent `create_sale_order` ; les anciens navigateurs et les réservations peuvent
  toujours utiliser `create_sale`.
- Les accès restent limités aux boutiques autorisées. Seule l'administratrice peut
  annuler. Une réservation déjà remise garde ses règles existantes d'annulation.
- Chaque ligne conserve le nom et le coût d'achat du produit au moment de la vente.
  Les coordonnées de la cliente et le nom de la boutique sont figés sur la facture.
  Aucun téléphone historique n'est inventé pour les anciennes factures.
- Le stock réservé reste protégé. Plusieurs lignes du même produit cumulent leurs
  quantités ; une insuffisance sur la dernière ligne annule toute l'opération.
- Un identifiant de commande protège les réessais de la même soumission contre la
  double création. Ne pas ressaisir une vente si l'interface confirme son enregistrement
  mais signale un échec de rafraîchissement : utiliser Actualiser.
- Les ventes restent réglées intégralement. Les acomptes et paiements progressifs
  conservent le parcours Réservations. La facture affiche le payé et le solde ; cette
  évolution n'ajoute pas un nouveau système de crédit multi-produits.
- Les totaux utilisent les types monétaires existants. Le total d'une commande doit
  tenir dans `numeric(10,2)`, soit au plus 99 999 999,99 F CFA.
- Le PDF est généré sur l'appareil, sans service tiers. Il contient un tableau,
  des totaux et une pagination. Le partage natif permet de choisir WhatsApp si le
  téléphone le propose ; sinon le PDF est téléchargé pour être joint manuellement.
  Aucun message n'est envoyé automatiquement.

## Vérifications réalisées en local

`npm test` teste la conservation, les permissions, les anciennes RPC, les réservations,
les nouvelles commandes et les calculs. `node tests/orders-browser.cjs` teste le
navigateur connecté à une base PostgreSQL PGlite éphémère : mono/multi-produits,
stocks, facture, PDF, impression, mobile, partage et annulation. Ce test exige
Playwright et Edge, avec `PLAYWRIGHT_PACKAGE` si Playwright n'est pas local.

La base Supabase de production n'est pas modifiée par ces tests. Son état courant
n'a pas été inspecté directement : le schéma enregistré et la migration déjà installée
servent de référence. Le fichier SQL comporte des prérequis et vérifie la conservation
des valeurs historiques et des stocks avant de valider la transaction.

# Suivi des encaissements et des remises à l'administratrice

## Activation Supabase

Prérequis : les migrations multi-produits, mètres et paiements en cours ont été appliquées. Le fichier à exécuter est **uniquement `supabase/migration-suivi-caisse.sql`**, en entier, dans **SQL Editor → New query → Run**. Le contrôle final doit afficher **version_caisse = 1** et les nombres de ventes, paiements et remises conservés.

Le script est transactionnel et réexécutable. Il ne supprime et ne réécrit aucune ancienne ligne. Les nouvelles colonnes restent nulles sur les archives ; aucune remise ni aucun encaissement historique n'est inventé. Les anciennes signatures restent utilisables et les règles d'accès par boutique sont conservées. Ne pas relancer les anciennes migrations.

## Calcul retenu

Conformément au choix de la propriétaire, le montant à remettre comprend **tout l'argent réellement reçu** : règlements des nouvelles ventes, versements sur anciennes factures et paiements des réservations, moins toutes les remises déjà enregistrées. La partie non payée d'une vente est une créance, jamais de l'argent disponible à remettre.

Exemple : vente de 15 000 F, avance de 5 000 F → chiffre d'affaires 15 000 F, encaissement 5 000 F, créance 10 000 F. Un paiement ultérieur de 4 000 F augmente les encaissements et ramène la créance à 6 000 F, sans créer de vente ni toucher le stock.

Une remise complète ferme le solde encaissé à ce moment et laisse zéro à remettre. Une remise partielle laisse son reliquat visible. Les reçus futurs, même liés à une ancienne facture, reconstituent le solde. Un montant supérieur au solde disponible est refusé.

Les dates des paiements servent aux statistiques quotidiennes et mensuelles. L'heure d'enregistrement sert au positionnement dans l'historique : un paiement saisi aujourd'hui pour une date passée reste visible comme une saisie postérieure au dernier repère de caisse.

## Colonnes ajoutées

- `ventes.cash_recorded_at` : heure d'enregistrement de caisse des nouvelles ventes.
- `payments.cash_recorded_at` : heure d'enregistrement des nouveaux paiements de réservation.
- `sale_payment_entries.cash_recorded_at`, `recorded_by_name` : heure et nom de l'auteur des nouveaux versements clients. L'ancien reste est calculé à partir de `remaining_after + amount`, sans modifier les archives.
- `versements.request_id`, `cash_cutoff_at`, `receipts_total`, `remitted_before`, `balance_before`, `balance_after`, `recorded_by_name`, `covered_sale_ids` : identifiant anti-doublon et photographie du solde et des ventes connues lors d'une remise.

Aucune nouvelle table n'est créée. Les nouvelles fonctions sont `shop_cash_receipts`, `stamp_cash_receipt`, `stamp_cash_remittance`, `protect_cash_remittance`, `record_cash_remittance` et `cash_management_version`. Les fonctions internes ne sont pas accessibles directement aux clients. `require_shop` conserve son contrôle d'accès et sérialise les opérations d'une boutique pour éviter les conflits entre encaissement et remise.

## Interface et documents

- **Paiements en cours** démarre sur les factures dont le solde est positif. Les factures soldées restent consultables dans **Payés — historique** ou **Toutes les factures — archives comprises**.
- L'historique des versements indique client, facture, montant, date de paiement, date et heure d'enregistrement, mode, ancien reste, nouveau reste et auteur. Les anciens noms inconnus ne sont pas inventés : l'identifiant de l'auteur reste affiché.
- L'historique des ventes mélange visuellement des événements clairement étiquetés : ventes, règlements de dettes, paiements de réservation et repères bordeaux de remise. Un règlement de dette n'entre pas dans le nombre de ventes.
- Les repères des nouvelles remises précisent si tous les encaissements antérieurs ont été remis ou si un reliquat subsiste. Les anciennes remises sont signalées comme historiques : leur périmètre exact n'avait pas été enregistré.
- Les statistiques quotidiennes et le bilan mensuel séparent chiffre d'affaires, ventes, encaissements initiaux, recouvrements de dettes, réservations, total encaissé, remises et solde de caisse avec reports antérieurs.
- Espèces, Wave et Orange Money sont présentés séparément. Un mode historique inconnu reste « Non renseigné », plutôt que d'être attribué arbitrairement aux espèces.
- Les créances et stocks affichés sont actuels. La marge est estimée avant charges ; aucune table de dépenses n'existe dans la structure examinée, donc aucun bénéfice net n'est inventé.
- Factures : **DAROU SALAM BUSINESS**, une seule facture multi-produits, et les statuts **Payé / Paiement partiel / À payer**.

## Logo et publication

Le logo fourni ensuite par la propriétaire est conservé sans modification dans `assets/darou-salam-logo.png`. Il est configuré dans `brand.js`, affiché en conservant ses proportions et intégré aux PDF. Le build copie automatiquement le fichier dans le site publié.

## Tests

Les tests locaux couvrent la conservation des archives, la migration réexécutée, les trois flux, 15 000 / 5 000 / 4 000 / 6 000 F, les remises partielles et complètes, les quatre nouvelles ventes totalisant 52 000 F, les remises successives, les doubles clics, les modes de paiement et les droits. Les tests d'interface vérifient la disparition des soldes réglés de la vue en cours, la conservation des archives, les statuts de facture et l'ordre des repères. Les PDF sont générés et contrôlés visuellement.

La base Supabase réelle n'a pas été modifiée par ces tests. Le lancement du navigateur de test est bloqué par les permissions de cette session ; ce parcours reste à vérifier dans un navigateur autorisé.

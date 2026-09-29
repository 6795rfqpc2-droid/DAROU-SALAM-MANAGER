# Activer les paiements en cours

## Ce qu'il faut exécuter dans Supabase

La mise à jour des tissus au mètre doit déjà être installée (version des ventes 3). Dans le projet Supabase de DAROU SALAM MANAGER :

1. Ouvrir **SQL Editor → New query**.
2. Copier **tout** le fichier `supabase/migration-paiements-en-cours.sql`, depuis `BEGIN` jusqu'au contrôle final inclus, puis cliquer sur **Run**.
3. Le résultat doit afficher **version_paiements = 1**. Les deux compteurs valent zéro à la première installation, avant toute nouvelle vente.
4. Actualiser le site, puis sélectionner une boutique.

Ne pas réexécuter les anciennes migrations. Ce nouveau fichier est réexécutable : il ne copie aucune ancienne vente et ne crée aucun versement fictif. Il utilise une transaction. Si une erreur survient avant la validation, les changements de cette tentative sont annulés ; conserver le message exact pour diagnostic, sans vider de table.

## Nouvelles tables et colonnes

Aucune colonne n'est ajoutée aux tables existantes. Deux tables sont créées :

- `sale_payment_accounts` : `id`, `shop_id`, `sale_id`, `customer_name`, `customer_phone`, `total_amount`, `initial_method`, `initial_date`, `next_due_date`, `request_payload`, `created_by`, `created_at`.
- `sale_payment_entries` : `id`, `shop_id`, `account_id`, `amount`, `paid_on`, `method`, `receipt_number`, `sequence`, `paid_after`, `remaining_after`, `request_id`, `request_payload`, `created_by`, `created_at`.

Chaque dossier est rattaché à une vente et à sa boutique. Chaque versement possède un numéro de reçu unique, sa date, son mode et une copie des totaux immédiatement après ce versement. Les identifiants de requête empêchent un double clic ou un réessai identique de doubler la vente ou le paiement.

Les fonctions `create_sale_with_payment`, `add_sale_payment` et `payment_api_version` sont ajoutées. Les RLS des nouvelles tables limitent les lectures aux boutiques autorisées. Les écritures passent exclusivement par les fonctions qui contrôlent l'utilisateur, la boutique, les montants et les dates. Les règles des anciennes tables restent en place.

## Utilisation

Dans **Ajouter une vente**, choisir **Payé intégralement** ou **Paiement partiel / En cours**. En cas de paiement partiel, le nom et le téléphone sont obligatoires. Un montant initial de zéro est accepté ; aucun reçu de zéro franc n'est créé. Choisir le mode, la date réelle du premier versement et, si souhaité, la prochaine échéance. Un client existant peut être sélectionné ; sinon les coordonnées sont conservées dans le dossier et la facture sans modifier le carnet de clients existant.

Dans **Paiements en cours**, les nouvelles ventes suivies apparaissent avec leurs montants et leur statut. Les filtres permettent d'afficher tous les dossiers, ceux restant à régler (y compris les retards), les retards seuls ou les dossiers payés. Une échéance dépassée est en retard ; une échéance comprise entre aujourd'hui et les sept prochains jours est signalée comme proche. Le calcul utilise la date au Sénégal.

**Ajouter un versement** conserve chaque versement précédent. Le montant ne peut pas dépasser le solde et la date ne peut pas précéder le dernier versement ni être future. **Marquer comme payé** préremplit le solde dans le même formulaire : il faut enregistrer ce dernier versement, avec sa date et son mode. Il n'y a pas de modification artificielle du statut.

Chaque versement donne accès à son reçu PDF, à l'impression et au partage. Les anciens reçus conservent leurs totaux d'origine. La facture affiche le total actuellement payé et le reste à payer. Le nom **Darou Salam Business** figure sur les documents, accompagné de la boutique de la vente.

**Rappeler le client** prépare un message modifiable. Un numéro sénégalais de neuf chiffres reçoit l'indicatif +221 ; les autres numéros doivent être vérifiés au format international. Le bouton ouvre WhatsApp avec le texte préparé. Le vendeur doit encore l'envoyer dans WhatsApp : aucun envoi automatique n'est effectué.

## Compatibilité et limites explicites

- Les anciennes ventes, factures, stocks et réservations ne sont pas transformés pendant la migration. Les ventes historiques restent dans l'historique et la liste des factures ; aucun paiement partiel ancien n'est inventé.
- Les réservations et leurs paiements restent indépendants. Les versements à l'administratrice restent dans leur section actuelle.
- Les produits à la pièce, les tissus au mètre et les commandes multi-produits utilisent toujours le même moteur de stock. Un versement ultérieur ne touche jamais le stock.
- Le chiffre d'affaires compte la vente entière ; les encaissements ne comptent que les sommes réellement versées, dans le mois de leur versement, sans compter deux fois le total de vente.
- La vue globale reste réservée à l'administratrice. Pour ajouter un versement depuis cette vue, sélectionner d'abord la boutique concernée.
- Une nouvelle vente suivie qui comporte déjà des versements ne peut pas être annulée par l'ancien bouton de suppression : le message explique qu'un remboursement doit être traité. Cette mise à jour n'invente aucun remboursement et ne supprime aucun encaissement. Une vente sans versement reste annulable, avec restauration du stock. Les anciennes ventes non suivies gardent leur fonctionnement existant.

## Vérifications locales

Les tests contrôlent la réexécution de la migration et la conservation des anciennes données, les avances, plusieurs versements, les reçus figés, les doubles clics, le refus des surpaiements, les droits par boutique et les comptes désactivés. Le parcours navigateur teste une vente de 10 000 F, une avance de 2 000 F, puis 3 000 F et 5 000 F jusqu'au solde, ainsi que les PDF, l'impression, le téléphone et le rappel WhatsApp préparé sans envoi.

La migration n'est pas exécutée automatiquement dans la base réelle : son activation est l'étape manuelle ci-dessus.

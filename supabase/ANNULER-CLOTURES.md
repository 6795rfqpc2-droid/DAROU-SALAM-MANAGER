# Annulation des clôtures et tableau de bord mensuel

## Activation

1. Exécuter EN ENTIER `supabase/migration-annulation-clotures.sql` dans Supabase SQL Editor. Ne pas relancer les anciennes migrations. Le script exige les tables des périodes déjà installées. Il n'annule aucune clôture automatiquement et ne modifie aucune vente, réservation, paiement, facture ou produit. Il termine par un état des périodes/boutiques à vérifier.
2. Envoyer les modifications du site sur GitHub pour que Netlify les publie.
3. Dans le site, choisir la bonne boutique et ouvrir Bilan mensuel avec le compte administratrice.
4. À côté de **Novembre 2026**, cliquer **Annuler la clôture**, confirmer et indiquer « Clôture effectuée par erreur ».
5. Faire ensuite la même chose pour **Octobre 2026**. Le mois actif reviendra à octobre.

Attention : aucune opération déjà enregistrée n'est déplacée vers octobre. Si des ventes ont été enregistrées dans la période décembre, elles restent en décembre, même après la réouverture d'octobre. Le sélecteur permet de les retrouver. Un changement de période d'une vente exigerait un diagnostic distinct ; cette modification ne le fait pas.

## Conservation et sécurité

Nouvelle table `cancelled_monthly_closures` : conserve intégralement la photographie de la clôture annulée, sa boutique, son mois, son auteur, la date et le motif de l'annulation. Le marqueur de clôture active est retiré seulement après cet archivage, dans la même transaction. Il n'y a donc pas de perte de l'ancien bilan. Les traces apparaissent dans « Clôtures annulées — traces conservées ».

La fonction `cancel_monthly_closure` impose les droits administratrice, l'accès à la boutique, le verrou de la boutique, la date exacte de la clôture affichée et l'ordre inverse des clôtures. Les doubles appels sont sans effet supplémentaire ; un ancien appel répété ne peut pas annuler une nouvelle clôture du même mois. Les rôles navigateur n'ont pas de droit d'écriture directe sur les archives. RLS par boutique. Audit de chaque annulation.

## Tableau de bord

Sélecteur mensuel distinct du choix de mois du bilan. À l'arrivée/changement de boutique et après changement de période active, le tableau choisit la période active de la boutique. Pour les opérations nouvelles, le mois d'activité reste la référence : cela préserve la règle demandée précédemment d'une vente du 30 septembre affectée à octobre après clôture. Les anciennes opérations sans période utilisent leur date enregistrée. Aucune date n'est réécrite.

Chiffre d'affaires, nombre de ventes, marge, encaissements, remises, unités vendues et réservations sont limités au mois sélectionné. Les règlements reçus sur d'anciennes factures comptent seulement comme encaissements du mois de réception, sans nouvelle vente.

Les créances mensuelles concernent les ventes/réservations créées dans ce mois, déduction faite des paiements enregistrés jusqu'à cette période. Elles ne reprennent plus toutes les anciennes dettes dans le nouveau mois. Pour un mois clôturé, les chiffres viennent du snapshot ; pour un mois non clôturé, ils sont recalculés avec les données disponibles. Les annulations de réservations historiques sans snapshot ne peuvent pas être reconstituées à une date passée : les bilans non figés restent provisoires.

Les widgets historiques cumulant toutes les périodes sont masqués sur le tableau de bord. Le stock physique n'est pas remis à zéro : il reste disponible dans Stock et son état figé est conservé dans les bilans clôturés.

## Vérification

Tests locaux avec PostgreSQL isolé : refus d'annuler octobre avant novembre, annulation des deux mois, conservation exacte des tables métier (y compris une vente créée en décembre), autres boutiques inchangées, reprise de migration, réessai idempotent et ancienne demande répétée après une nouvelle clôture, refus personnel et anonyme. Tests de calcul mensuel : nouveau mois à zéro, anciennes créances exclues, règlement ultérieur sans nouvelle vente. Tests d'interface et de navigation.

Aucune écriture de production n'a été effectuée par l'assistant. L'annulation de vos clôtures réelles reste à valider via les boutons après activation et publication.

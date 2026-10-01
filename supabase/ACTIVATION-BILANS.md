# Activation des périodes mensuelles et mise à jour téléphone

Les fichiers locaux sont prêts. Aucun SQL n'a été exécuté sur votre Supabase de production et aucun nouveau déploiement Netlify n'a été effectué pendant cette intervention.

## Ce qui explique l'ancienne version sur téléphone

Vérification HTTP du site public le 30 septembre : finance.js répondait 404 ; index.html et sales-orders.js différaient des fichiers locaux. Les headers Netlify demandaient déjà la revalidation. La cause confirmée est donc le déploiement ancien, pas une preuve de cache défectueux du téléphone. Aucun service worker ni PWA n'est enregistré par le code du projet ; le cache privé de l'iPhone n'a pas été inspecté.

Le build ajoute maintenant une empreinte de contenu aux URLs JS/CSS, un version.json et des headers de revalidation (aussi présents dans _headers pour un dépôt manuel). Dans un onglet déjà ouvert, une notification propose de charger la nouvelle version sans effacer une saisie en cours. Aucun vidage manuel du cache n'est prévu. Une simple réouverture/actualisation peut être nécessaire pour quitter l'ancienne version qui ne contient pas encore ce mécanisme.

## 1. Supabase

Dans SQL Editor, exécuter entièrement et dans cet ordre :

1. supabase/migration-suivi-caisse.sql (réexécutable ; nécessite la migration paiements en cours déjà installée).
2. supabase/migration-periodes-mensuelles.sql (réexécutable).

Ne pas réexécuter les anciennes migrations multi-boutiques, ventes ou mètres.

La seconde migration affiche le mois actif pour chaque boutique. À la première installation, elle reprend le dernier mois des ventes, paiements ou remises existants ; sans activité, elle utilise le mois du serveur en Afrique/Dakar. Elle ne modifie pas les anciennes dates ni les montants ni les stocks. Les anciennes lignes gardent activity_month NULL et sont regroupées par leur date historique.

Ajouts :
- shop_activity_periods : mois actif par boutique.
- monthly_closures : photographie des données, boutique, mois, auteur et heure de clôture.
- activity_month sur ventes, reservations, payments, sale_payment_entries et versements.
- sales_channel sur ventes.
- Fonctions de clôture, création de vente avec canal, attribution et protection de période.

RLS limité aux boutiques autorisées ; les tables de périodes et bilans sont en lecture seule pour le navigateur. La clôture est une fonction réservée à l'administratrice. Les fonctions métier existantes restent disponibles. Une double confirmation réseau du même mois retourne la même clôture, sans avancer de deux mois.

## 2. Netlify

Le dossier dist contient le site à publier, sans SQL, tests ou exports privés.

- Déploiement manuel : dans le projet Netlify EXISTANT darousalamanager, section Deploys, déposer le dossier dist ou le ZIP darou-salam-netlify.zip. Ne pas créer un autre site.
- Déploiement Git : enregistrer/pousser les fichiers du projet, puis lancer le build « node prepare-site.cjs », dossier publié « dist ».

La session présente n'a pas de droit d'écriture sur .git et n'est pas connectée à votre compte Netlify. La publication reste donc à effectuer. Après publication, vérifier que /version.json répond et que le menu Bilan mensuel affiche la période active. Ordinateur et téléphone doivent ouvrir la même URL HTTPS et la même boutique ; le fichier local de l'ordinateur n'est pas la production.

## Utilisation

Ouvrir Bilan mensuel, choisir la boutique et son mois actif. Après vérification des opérations, cliquer Clôturer le mois puis confirmer. La clôture ne force pas un paiement : des créances peuvent subsister et restent visibles dans le bilan figé. Le mois suivant devient immédiatement actif, même si la date civile n'a pas changé. Il reste actif jusqu'à sa clôture manuelle.

Une vente créée après la clôture de septembre reçoit octobre. Un versement reçu en octobre pour une vente de septembre reste un encaissement d'octobre, sans créer de vente ou modifier le bilan de septembre. Les réservations peuvent continuer à recevoir des paiements et être remises ; chaque nouvelle écriture est affectée à la période active. Les ventes clôturées ne peuvent plus être annulées/modifiées via les fonctions habituelles. Il n'y a pas de réouverture prévue.

L'historique permet de rouvrir les photographies enregistrées à partir de cette migration et de retélécharger leurs PDF. Les mois antérieurs non clôturés restent des bilans provisoires calculés avec les données disponibles, pas des archives reconstituées artificiellement.

Le PDF utilise le logo, les ventes, produits et unités, encaissements, moyens de paiement, créances, réservations, remises, stocks et canaux enregistrés. Les coûts manquants sont signalés. Aucune table de dépenses n'a été identifiée : le rapport indique une marge avant charges et ne prétend pas calculer un bénéfice net. Les canaux et moyens de paiement historiques inconnus restent « Non renseigné ». Les anciennes ventes sans compte de paiement ni réservation suivent la convention préexistante de vente comptant ; une clôture ne certifie pas à elle seule la qualité des saisies historiques.

Le partage propose la feuille native lorsque disponible ; sinon, télécharger le PDF et le joindre à WhatsApp/e-mail. Rien n'est envoyé automatiquement. Aucun export Excel existant n'a été supprimé.

## Vérifications et limites

Tests PostgreSQL local : migration répétée, clôture idempotente, attribution au mois suivant à date civile inchangée, conservation du stock et des snapshots, règlement ultérieur, accès anonyme refusé, autres boutiques inchangées. Tests de calcul, navigation et PDF. Aucun essai écrit dans les données réelles.

Contrôle visuel dans le navigateur intégré en largeur ordinateur et 390 px : bilan et facture avec logo, navigation et bouton Afficher accessibles. Correction du défilement initial de la facture mobile qui cachait son logo. Génération PDF vérifiée et pages rendues visuellement. Le téléchargement via l'automatisation du navigateur intégré n'a pas été confirmé (attente expirée) ; le téléchargement et partage natifs iPhone/WhatsApp restent à vérifier après déploiement. Le lancement du navigateur autonome de test a été refusé par les permissions de l'environnement.

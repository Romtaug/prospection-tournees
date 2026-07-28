# Prospection tournees B2B

Base de prospection des entreprises francaises dont les equipes se deplacent
chaque jour vers une liste d'adresses : techniciens, inspecteurs, livreurs.
Ce sont les acheteurs potentiels de l'optimiseur de tournees.

Meme architecture que le pipeline sante : la base se construit toute seule
(workflow mensuel), l'enrichissement tourne chaque nuit avec reprise
automatique, tout se pilote depuis l'onglet Actions de GitHub.

## Cibles (34 codes NAF, 9 types)

| Type (`--types`) | Codes NAF | Qui c'est |
|---|---|---|
| reseaux | 42.21Z, 42.22Z, 43.21A, 43.21B, 61.10Z, 61.20Z, 61.90Z | Construction de reseaux, installateurs electriques (locaux et voie publique), operateurs telecom |
| cvc | 43.22A, 43.22B, 43.29A | Plomberie-chauffage, climatisation, isolation |
| maintenance | 43.29B, 33.12Z, 33.13Z, 33.14Z, 33.20B, 33.20D | Ascenseurs, SAV machines et equipements |
| securite | 80.10Z, 80.20Z | Gardiennage avec rondes mobiles, alarmes-telesurveillance |
| controle | 71.20B | Bureaux de controle, inspection, diagnostiqueurs immobiliers |
| proprete | 81.10Z, 81.21Z, 81.22Z, 81.29A, 81.29B, 81.30Z | Facility management, nettoyage, 3D, paysagistes |
| environnement | 37.00Z, 38.11Z, 38.12Z | Assainissement-curage, collecte de dechets |
| livraison | 53.20Z, 49.41B, 96.01A | Coursiers, messagerie locale, fret de proximite, blanchisserie de gros (tournees B2B) |
| depannage | 95.11Z, 95.21Z, 95.22Z | Depannage a domicile : informatique, electronique, electromenager |

Filtre effectifs (unite legale) : 10 a 499 salaries partout, 6 a 499 pour la
livraison. Etablissements actifs uniquement (`etat_administratif=A`). France
entiere. Tout se regle dans `config.yml` (codes NAF, tranches, departements,
scoring). A savoir : les entreprises dont l'effectif n'est pas renseigne a
l'INSEE (tranche NN, frequent chez les jeunes societes) sont ecartees par ce
filtre, c'est voulu.

Les volumes exacts par type s'affichent dans le log du premier run de
"Build base tournees" (decompte imprime en fin de collecte).

## Contrat API verifie contre le code source officiel

Verification faite sur le depot github.com/annuaire-entreprises-data-gouv-fr/search-api :
- les parametres `activite_principale`, `tranche_effectif_salarie` (filtre au
  niveau UNITE LEGALE, exactement ce qu'on veut) et `etat_administratif`
  (valeurs A/C) sont des alias officiels de l'API ;
- `per_page` max = 25 (le collecteur est pile dessus), plafond de 10 000
  resultats par recherche (`page * per_page`), d'ou le decoupage automatique
  par NAF des departements volumineux ;
- les 34 codes NAF et les 7 tranches d'effectifs de `config.yml` sont tous
  valides contre les listes officielles embarquees dans l'API (un code invalide
  ferait echouer la requete en erreur 422) ;
- l'API ne renvoie PAS de libelle d'activite dans sa reponse de recherche : le
  libelle est donc rempli localement depuis le code NAF (`NAF_LABELS` dans
  `common.py`, libelles officiels de la nomenclature).

## Donnees produites (56 colonnes)

11 colonnes de base (siren, siret, nom, type, naf, libelle, commune,
departement, telephone, source...) + 45 colonnes d'enrichissement :

- Structure : effectif, categorie (PME/ETI/GE), nature juridique, date de
  creation, anciennete, nb d'etablissements ET nb d'etablissements OUVERTS
  (les multi-agences = plusieurs deploiements vendables).
- Finances INPI : CA, CA n-1, resultat net, annee d'exercice.
- Contact : adresse, CP, ville, latitude/longitude, telephone, TVA intra
  (calcul officiel), domaine, email generique du site, statut MX verifie,
  autres emails, flag email perso.
- Dirigeants : principal + fonction + 4 autres.
- Labels officiels (RGE, Qualiopi, ESS, societe a mission...) + convention
  collective (IDCC).
- 8 liens prets a cliquer par ligne : page LinkedIn trouvee sur le site +
  lien de recherche LinkedIn, Pappers, Annuaire des Entreprises (data.gouv),
  societe.com, Pages Jaunes, Google Maps (GPS ou recherche), recherche Google,
  et Trustpilot (des qu'un domaine est trouve).
- Signaux BODACC (procedures collectives, ventes...) en option.
- Score 0-100 + tier A/B/C + raisons detaillees.

## Fichiers

- `config.yml` : cibles NAF, profils d'effectifs, parametres d'enrichissement, scoring.
- `sirene_api.py` : collecte via l'API publique recherche-entreprises.api.gouv.fr (aucune cle).
- `enrich.py` : enrichissement complet avec reprise automatique.
- `export_crm.py` : genere le CRM de prospection (CSV) avec colonnes de suivi.
- `common.py` : helpers partages.
- `.github/workflows/refresh.yml` : reconstruction de la base le 1er du mois.
- `.github/workflows/enrich.yml` : enrichissement chaque nuit a 01:00 UTC, avancement sauvegarde sur la branche `enrichi`.
- `.github/workflows/crm.yml` : generation du CRM chaque lundi 06:30 UTC (et a la demande).

## Demarrage

1. Settings > Actions > General > Workflow permissions > "Read and write permissions".
2. Onglet Actions > "Build base tournees" > Run workflow. La base arrive dans `data/base_tournees.csv` (et en artefact), avec le decompte par type dans le log.
3. Rien d'autre a faire : "Enrichissement base tournees" tourne chaque nuit et s'arrete tout seul quand tout est traite.
4. Quand tu veux un fichier de travail : Actions > "CRM prospection" > Run workflow. Il se regenere aussi tout seul chaque lundi.

## Recuperer les donnees

- Base brute : `data/base_tournees.csv` sur la branche `main`.
- Base enrichie : artefact `base_tournees_enrichi` du dernier run d'enrichissement, ou `data/base_tournees_enrichi.csv.gz` sur la branche `enrichi`.

## Le CRM (tout en CSV)

`export_crm.py` transforme la base enrichie en fichier de travail commercial,
dans `crm/`. Aucun Excel : que du CSV, lisible sur GitHub, versionne ligne par
ligne, ouvrable dans Excel ou LibreOffice sans rien installer.

Ce qu'il fait :

- ajoute 5 colonnes de suivi : `statut`, `date_contact`, `canal`, `date_relance`, `notes` ;
- remet les colonnes dans un ordre utile (nom, tier, score, suivi, contact,
  liens, firmographie, identifiants) au lieu de l'ordre technique ;
- trie par score decroissant, puis par nombre d'agences ouvertes ;
- **CONSERVE le suivi deja saisi** : le script relit le CRM existant et
  reapplique statut, dates, canal et notes par SIREN. Tu peux le relancer apres
  chaque enrichissement sans perdre une seule annotation ;
- ecrit aussi un fichier par metier (`--par-type`), plus pratique a consulter
  que le fichier complet.

Valeurs attendues (respecte-les pour que le resume reste juste) :

| Colonne | Valeurs |
|---|---|
| statut | a contacter, contacte, relance, interesse, rdv, client, refuse, injoignable, hors cible |
| canal | email, telephone, linkedin, courrier, visite |
| date_contact, date_relance, date_vente | AAAA-MM-JJ |
| notes | texte libre |
| produit | POC, Deploiement, Modification |
| montant_vendu, montant_encaisse | nombre, en euros |
| paye | Oui, Non |
| statut_livraison | a faire, en cours, livre |
| commission | **calculee, ne pas remplir a la main** |

La commission est recalculee a chaque export : 40 % du montant encaisse, et 0 %
sur les lignes dont le produit est une modification (c'est du developpement, pas
de la vente).

## Le cockpit closer

Un fichier HTML autonome (`cockpit.html`) sert de poste de travail commercial :
il ouvre le CSV du CRM **en ecriture directe** (API File System Access, Chrome
et Edge), affiche la fiche de chaque prospect avec ses 8 liens de qualification,
le script d'appel adapte a son metier, un calculateur de ROI a utiliser pendant
l'appel, le brief commercial complet et un tableau de bord. Chaque statut change
dans la liste est ecrit dans le fichier immediatement.

Ce fichier n'est PAS dans ce depot : il contient la grille de prix, les taux de
commission et le brief interne. Il vit dans un depot prive separe ou simplement
sur le poste du commercial.

Utilisation :

    python export_crm.py                                   # tout, dans crm/crm_tournees.csv
    python export_crm.py --par-type                        # + un fichier par metier
    python export_crm.py --types controle livraison        # les deux verticaux prioritaires
    python export_crm.py --tier A --dep 69 38 01 42 73 74  # tier A en Auvergne-Rhone-Alpes

Depuis GitHub : Actions > "CRM prospection" > Run workflow, avec les memes
filtres en champs de saisie. Le resume (volumes, taux d'email, tiers, pipeline
par statut) s'affiche dans le log et est sauvegarde dans `crm/resume.txt`.

A savoir : le fichier complet fait une quinzaine de Mo, donc GitHub refusera de
l'afficher dans le navigateur (limite d'apercu). Les fichiers par metier, eux,
s'ouvrent directement en ligne. Pour le fichier complet, passe par
"Download raw file" ou par l'artefact `crm_tournees` du dernier run.

## Exploitation

Prioriser les campagnes avec les filtres du workflow d'enrichissement ou en
local, par exemple les deux verticaux prioritaires :

    python enrich.py --types controle livraison --limit 5000

Puis generer le CRM correspondant :

    python export_crm.py --types controle livraison --par-type

Le score (0-100) et le tier (A/B/C) classent les lignes pour l'emailing :
tier A = email verifie + finances saines + taille ideale. Les multi-agences
(au moins 2 etablissements ouverts) recoivent un bonus de score
(`poids_multi_etab`, raison "multi-agences") : modele Axione, un deploiement
vendu par agence. La colonne `nb_etablissements_ouverts` permet en plus de les
trier directement dans Excel.

## Pistes v2 identifiees (registres officiels, verifies)

Deux registres publics permettraient d'aller encore plus loin. Ils sont
verifies et joignables par SIRET/SIREN, mais demandent chacun un script
d'ingestion teste sur le vrai fichier (a construire avec le fichier en main) :

- Registre national des transporteurs de marchandises (ministere des
  Transports, listes par departement + packages CSV miroir data.gouv) :
  donne par entreprise le NOMBRE DE COPIES CONFORMES DE LICENCE, soit le
  nombre de vehicules en circulation, plus le nom du gestionnaire de
  transport et les dates de validite. C'est LE qualifiant du vertical
  livraison (une societe a 15 copies = 15 vehicules = vraie douleur de
  tournees). Radiations et suspensions = signal negatif utile.
- Annuaire des diagnostiqueurs immobiliers certifies (data.gouv) : les
  diagnostiqueurs nominatifs avec leurs certifications, pour affiner le
  vertical controle. Le COFRAC publie aussi la liste des organismes
  d'inspection accredites (bureaux de controle).

Ecartes volontairement apres examen : 49.41A (fret longue distance, point a
point), 52.21Z (melange remorquage avec parkings et peages), 77.32Z (location
de materiel), 71.12A (geometres, missions longues). Le rattrapage des
entreprises a effectif non renseigne (tranche NN) via le filtre
categorie_entreprise=PME a aussi ete ecarte : la categorie PME de l'INSEE
inclut les micro-entreprises, la base serait inondee de structures
unipersonnelles impossibles a filtrer ensuite.

## Limites connues

- Depuis les IP GitHub, l'API et les sites repondent lentement (environ 1 000
  lignes fichees par run de 6 h) et le scraping email plafonne a ~5 % de taux
  de decouverte, contre 30 a 60 % en local. La grosse passe se fait donc
  idealement une fois en local : `python enrich.py --workers 16`.
- La colonne `finess` de la base est un heritage du pipeline d'origine et
  reste vide : elle est conservee pour garder `enrich.py` strictement identique.

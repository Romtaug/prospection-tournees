# -*- coding: utf-8 -*-
"""Helpers partages du pipeline de prospection tournees."""
import re
import unicodedata
import yaml

USER_AGENT = "prospection-tournees/1.0 (base tournees B2B; +voir mentions legales)"

# Colonnes de la base (toutes les sources s'alignent dessus).
# NB : la colonne "finess" est heritee du pipeline d'origine et reste vide ici ;
# elle est conservee pour garder enrich.py strictement identique.
BASE_COLS = ["siren", "siret", "finess", "nom", "type", "naf", "libelle",
             "commune", "departement", "telephone", "source"]

# Colonnes ajoutees par l'enrichissement contacts.
ENRICH_COLS = ["domain", "email", "email_source", "email_status", "linkedin"]


# Libelles NAF officiels (extraits de la nomenclature embarquee dans l'API
# recherche-entreprises). L'API ne renvoie PAS le libelle dans sa reponse de
# recherche : on le remplit donc localement depuis le code NAF.
NAF_LABELS = {
    "33.12Z": "Reparation de machines et equipements mecaniques",
    "33.13Z": "Reparation de materiels electroniques et optiques",
    "33.14Z": "Reparation d'equipements electriques",
    "33.20B": "Installation de machines et equipements mecaniques",
    "33.20D": "Installation d'equipements electriques, de materiels electroniques et optiques ou d'autres materiels",
    "37.00Z": "Collecte et traitement des eaux usees",
    "38.11Z": "Collecte des dechets non dangereux",
    "38.12Z": "Collecte des dechets dangereux",
    "42.21Z": "Construction de reseaux pour fluides",
    "42.22Z": "Construction de reseaux electriques et de telecommunications",
    "43.21A": "Travaux d'installation electrique dans tous locaux",
    "43.21B": "Travaux d'installation electrique sur la voie publique",
    "43.22A": "Travaux d'installation d'eau et de gaz en tous locaux",
    "43.22B": "Travaux d'installation d'equipements thermiques et de climatisation",
    "43.29A": "Travaux d'isolation",
    "43.29B": "Autres travaux d'installation n.c.a.",
    "49.41B": "Transports routiers de fret de proximite",
    "53.20Z": "Autres activites de poste et de courrier",
    "61.10Z": "Telecommunications filaires",
    "61.20Z": "Telecommunications sans fil",
    "61.90Z": "Autres activites de telecommunication",
    "71.20B": "Analyses, essais et inspections techniques",
    "80.10Z": "Activites de securite privee",
    "80.20Z": "Activites liees aux systemes de securite",
    "81.10Z": "Activites combinees de soutien lie aux batiments",
    "81.21Z": "Nettoyage courant des batiments",
    "81.22Z": "Autres activites de nettoyage des batiments et nettoyage industriel",
    "81.29A": "Desinfection, desinsectisation, deratisation",
    "81.29B": "Autres activites de nettoyage n.c.a.",
    "81.30Z": "Services d'amenagement paysager",
    "95.11Z": "Reparation d'ordinateurs et d'equipements peripheriques",
    "95.21Z": "Reparation de produits electroniques grand public",
    "95.22Z": "Reparation d'appareils electromenagers et d'equipements pour la maison et le jardin",
    "96.01A": "Blanchisserie-teinturerie de gros",
}


def naf_label(code):
    """Libelle officiel d'un code NAF ('43.21A' ou '4321A'), '' si inconnu."""
    if not code:
        return ""
    c = str(code).upper().replace(".", "")
    if len(c) >= 5:
        c = f"{c[:2]}.{c[2:5]}"
    return NAF_LABELS.get(c, "")

def load_config(path="config.yml"):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def naf_type_map(cfg):
    """{NAF_sans_point_majuscule: type}. Ex: {'7120B': 'controle'}."""
    m = {}
    for typ, codes in (cfg.get("naf") or {}).items():
        for code in codes:
            m[code.replace(".", "").upper()] = typ
    return m


def effectif_groups(cfg):
    """Regroupe les NAF par profil de tranches d'effectif salarie (INSEE).

    Lit config.yml :
      effectifs:
        defaut: ["11", ...]          # tranches appliquees a tous les types
        par_type:
          livraison: ["03", ...]     # exceptions par type

    Renvoie une liste triee de tuples (tranches, nafs) ou `tranches` est un
    tuple de codes tranche ("03", "11", ...) et `nafs` la liste des codes NAF
    qui partagent ce profil. Un tuple de tranches vide = aucun filtre effectif.
    """
    eff = cfg.get("effectifs") or {}
    defaut = tuple(str(t).zfill(2) for t in (eff.get("defaut") or []))
    par_type = eff.get("par_type") or {}
    groups = {}
    for typ, codes in (cfg.get("naf") or {}).items():
        if typ in par_type:
            tr = tuple(str(t).zfill(2) for t in (par_type[typ] or []))
        else:
            tr = defaut
        groups.setdefault(tr, []).extend(codes)
    return sorted(groups.items())


def all_departements():
    """Tous les departements FR (metropole hors '20' -> 2A/2B, + DROM)."""
    deps = [f"{i:02d}" for i in range(1, 96) if i != 20]
    deps += ["2A", "2B", "971", "972", "973", "974", "976"]
    return deps


def strip_acc(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower().strip()


_LEGAL = (" sasu", " sas", " sarl", " eurl", " sa", " sci", " scm", " selarl",
          " selas", " snc", " scop", " association", " asso", " groupe", " ste", " societe")


def slugify(name):
    """Nom d'entreprise -> radical de domaine plausible (forme juridique retiree)."""
    s = strip_acc(name)
    for suf in _LEGAL:
        if s.endswith(suf):
            s = s[: -len(suf)].strip()
    return re.sub(r"[^a-z0-9]+", "", s)


def norm_phone(s):
    """Normalise un numero FR au format '0X XX XX XX XX', sinon ''."""
    if not s:
        return ""
    d = re.sub(r"\D", "", str(s))
    if d.startswith("0033"):
        d = "0" + d[4:]
    elif d.startswith("33") and len(d) == 11:
        d = "0" + d[2:]
    if len(d) == 10 and d[0] == "0":
        return " ".join([d[0:2], d[2:4], d[4:6], d[6:8], d[8:10]])
    return ""


def clean_siret(raw):
    d = "".join(c for c in str(raw or "") if c.isdigit())
    return d if len(d) == 14 else ""


def siren_of(siret, fallback=""):
    s = clean_siret(siret)
    if s:
        return s[:9]
    d = "".join(c for c in str(fallback or "") if c.isdigit())
    return d[:9] if len(d) >= 9 else ""

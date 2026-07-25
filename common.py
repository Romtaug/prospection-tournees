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

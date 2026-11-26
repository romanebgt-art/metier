r"""Notre robot : chaque jour, récupère les offres marketing de trois canaux officiels
et les range au format de la page « Nos offres » (même colonnes que nos relevés à la main).

    Adzuna              API officielle (developer.adzuna.com), recherche « marketing », France entière
                        + autour de Clermont-Ferrand. Usage autorisé : recherche personnelle et universitaire,
                        source citée (« The Adzuna API ») sur la page.
    La bonne alternance API de l'État (api.apprentissage.beta.gouv.fr), offres en alternance
                        des codes ROME marketing et digital. Gratuite, usage non lucratif.
    France Travail      API Offres d'emploi v2 (francetravail.io), recherche par mot-clé « marketing »
                        (le robot du prof, lui, cherche par code ROME : les deux se complètent).

Usage :
    python scripts/nos_canaux.py                 # les trois canaux (ceux dont la clé est fournie)
    python scripts/nos_canaux.py --canal adzuna  # un seul canal, pour essayer
    python scripts/nos_canaux.py --verifier      # teste seulement les connexions

Ce que ça écrit :
    data/auto/offres_finales_<date>.csv   offres retenues (colonnes de data/offres_finales/)
    data/auto/offres_ecartees_<date>.csv  offres écartées, avec leur raison (colonnes de data/offres_ecartees/)
    nos-offres/dates.json                 dates de nos relevés à la main (lues dans data/offres_finales/)
    nos-offres/dates_auto.json            les derniers jours collectés par le robot (ceux que la page charge)

Clés (fichier .env en local, secrets du dépôt sur GitHub) :
    ADZUNA_APP_ID, ADZUNA_APP_KEY, LBA_API_KEY, FT_CLIENT_ID, FT_CLIENT_SECRET
Un canal sans clé est sauté, sans faire échouer les autres.
"""
import argparse
import csv
import json
import os
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv

RACINE = Path(__file__).resolve().parent.parent
load_dotenv(RACINE / ".env")
AUTO = RACINE / "data" / "auto"
JOURS_AFFICHES = 7          # la page charge les 7 derniers jours du robot (les fichiers plus anciens restent dans data/auto)
DELAI = 30

# Codes ROME marketing et digital (groupes « Marketing » et « Digital » du prof, scripts/extraire.py).
ROMES_MARKETING = ["M1718", "M1716", "M1705", "M1703", "M1620", "M1706", "M1430", "M1711",
                   "E1113", "D1438", "E1101", "E1124", "E1405", "M1886", "M1426", "M1719", "E1406"]

# Même esprit que la règle de la page (VRAI_MKT dans nos-offres/app.js), un peu élargie aux
# intitulés anglais et aux métiers voisins qu'on gardait à la main (growth, CRM, trade, contenu…).
VRAI_MKT = re.compile(
    r"marketing|communication|community|digital|num[ée]rique|chef de produit|product manager|"
    r"e-?commerce|\bweb\b|social media|r[ée]seaux sociaux|marque|brand|relations? publiques|"
    r"\bseo\b|\bsea\b|influen|growth|\bcrm\b|trade|merchandising|acquisition|contenu|content|"
    r"m[ée]dia|[ée]v[ée]nementiel|attach[ée]e? de presse|traffic manager|"
    r"[ée]tudes? (de )?march[ée]|chef de projet (web|digital|marketing)", re.I)
STAGE = re.compile(r"\bstage\b|stagiaire|\bintern(ship)?\b", re.I)
ALTERNANCE = re.compile(r"alternan|apprenti|contrat pro", re.I)

COLONNES_RET = ["canal", "fichier_source", "date_collecte", "page_ou_recherche", "intitule", "entreprise",
                "lieu", "contrat", "lien_master", "teletravail", "salaire_min", "salaire_max",
                "salaire_periode", "salaire_texte", "secteur", "note", "lien"]
COLONNES_ECA = ["fichier_source", "canal", "date_collecte", "intitule", "entreprise", "lieu", "contrat",
                "lien_master", "raison_ecart", "lien"]


def offre(canal, recherche, intitule, entreprise, lieu, contrat, lien, smin=None, smax=None,
          periode="", stexte="", secteur="", teletravail="", note=""):
    return {"canal": canal, "page_ou_recherche": recherche, "intitule": (intitule or "").strip(),
            "entreprise": (entreprise or "").strip(), "lieu": (lieu or "").strip(), "contrat": contrat,
            "teletravail": teletravail, "salaire_min": smin, "salaire_max": smax, "salaire_periode": periode,
            "salaire_texte": stexte, "secteur": secteur, "note": note, "lien": lien or ""}


def contrat_par_intitule(texte):
    if STAGE.search(texte or ""):
        return "Stage"
    if ALTERNANCE.search(texte or ""):
        return "Alternance"
    return None


def lieu_ville_cp(ville, cp):
    """« Clermont-Ferrand, 63000 » : la page lit la ville avant la virgule et le Puy-de-Dôme dans le code postal."""
    ville, cp = (ville or "").strip(), (cp or "").strip()
    return f"{ville}, {cp}" if ville and cp else ville or cp


# ---------------------------------------------------------------- Adzuna
ADZUNA_URL = "https://api.adzuna.com/v1/api/jobs/fr/search/{page}"
ADZUNA_RECHERCHES = [   # (libellé, paramètres, nombre de pages de 50)
    ("API Adzuna : « marketing », France", {"what": "marketing"}, 10),
    ("API Adzuna : « marketing », Clermont-Ferrand + 30 km", {"what": "marketing", "where": "Clermont-Ferrand", "distance": 30}, 2),
]
ADZUNA_CONTRAT = {"permanent": "CDI", "contract": "CDD"}


def adzuna(verifier=False):
    cid, cle = os.getenv("ADZUNA_APP_ID"), os.getenv("ADZUNA_APP_KEY")
    if not cid or not cle:
        return None
    sortie = []
    for libelle, params, pages in ADZUNA_RECHERCHES:
        for p in range(1, (1 if verifier else pages) + 1):
            r = requests.get(ADZUNA_URL.format(page=p), timeout=DELAI, params=dict(
                params, app_id=cid, app_key=cle, results_per_page=50, max_days_old=31))
            r.raise_for_status()
            lot = r.json().get("results", [])
            for o in lot:
                titre = o.get("title", "")
                texte = f"{titre} {o.get('description', '')}"
                contrat = contrat_par_intitule(titre) or ADZUNA_CONTRAT.get(o.get("contract_type")) \
                    or ("CDI" if re.search(r"\bCDI\b", texte) else "CDD" if re.search(r"\bCDD\b", texte) else
                        "Alternance" if ALTERNANCE.search(texte) else "Stage" if STAGE.search(texte) else "non précisé")
                # Adzuna estime parfois le salaire (salary_is_predicted = 1) : ce n'est pas un salaire affiché.
                affiche = str(o.get("salary_is_predicted", "0")) == "0" and o.get("salary_min")
                smin, smax = (o.get("salary_min"), o.get("salary_max")) if affiche else (None, None)
                periode = ""
                if smin:
                    periode = "mois" if contrat == "Stage" and smin < 4000 else "an"
                    if periode == "an" and smin < 4000:   # montant mensuel saisi comme annuel
                        smin, smax = smin * 12, (smax or smin) * 12
                loc = o.get("location") or {}     # « Clermont-Ferrand, Puy-de-Dôme » : la ville avant la virgule
                sortie.append(offre("Adzuna", libelle, titre, (o.get("company") or {}).get("display_name"),
                                    loc.get("display_name", ""), contrat, o.get("redirect_url"), smin, smax, periode,
                                    secteur=(o.get("category") or {}).get("label", "")))
            if len(lot) < 50:
                break
            time.sleep(1)
    return sortie


# ---------------------------------------------------------------- La bonne alternance
LBA_URL = "https://api.apprentissage.beta.gouv.fr/api/job/v1/search"


def lba(verifier=False):
    cle = os.getenv("LBA_API_KEY")
    if not cle:
        return None
    sortie, vus = [], set()
    for code in (ROMES_MARKETING[:1] if verifier else ROMES_MARKETING):
        r = requests.get(LBA_URL, params={"romes": code}, timeout=DELAI,
                         headers={"Authorization": f"Bearer {cle}"})
        r.raise_for_status()
        for o in r.json().get("jobs", []):
            ident = (o.get("identifier") or {}).get("id")
            if ident in vus:             # une offre peut avoir plusieurs codes ROME
                continue
            vus.add(ident)
            of, wp, ct = o.get("offer") or {}, o.get("workplace") or {}, o.get("contract") or {}
            adresse = ((wp.get("location") or {}).get("address") or "")
            m = re.search(r"\b(\d{5})\s+(.+)$", adresse)
            lieu = lieu_ville_cp(m.group(2), m.group(1)) if m else adresse
            partenaire = (o.get("identifier") or {}).get("partner_label") or ""
            types = ct.get("type") or []
            sortie.append(offre("La bonne alternance", f"API La bonne alternance : ROME {code}",
                                of.get("title"), wp.get("brand") or wp.get("name") or wp.get("legal_name"),
                                lieu, "Alternance", (o.get("apply") or {}).get("url"),
                                teletravail=ct.get("remote") or "",
                                note=" / ".join(x for x in [", ".join(types) if isinstance(types, list) else str(types),
                                                             f"source : {partenaire}" if partenaire else ""] if x)))
        time.sleep(1.1)                  # limite : 60 appels par minute
    return sortie


# ---------------------------------------------------------------- France Travail
FT_TOKEN = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire"
FT_SEARCH = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search"
FT_SALAIRE = re.compile(r"^(annuel|mensuel|horaire)\s+de\s+(\d+(?:[.,]\d+)?)\s*euros(?:\s*à\s*(\d+(?:[.,]\d+)?)\s*euros)?", re.I)
FT_CONTRAT = {"CDI": "CDI", "DDI": "CDI", "CDD": "CDD", "MIS": "Intérim", "SAI": "Saisonnier", "LIB": "Indépendant (non salarié)"}


def ft_salaire(lib, contrat):
    m = FT_SALAIRE.match((lib or "").strip())
    if not m:
        return None, None, ""
    vals = [float(x.replace(",", ".")) for x in (m.group(2), m.group(3)) if x]
    unite = m.group(1).lower()
    if contrat == "Stage" and unite == "mensuel":
        return min(vals), max(vals), "mois"
    vals = [v * {"annuel": 1, "mensuel": 12, "horaire": 1607}[unite] for v in vals]
    vals = [v for v in vals if 4000 <= v <= 250000]
    return (round(min(vals)), round(max(vals)), "an") if vals else (None, None, "")


def france_travail(verifier=False):
    cid, secret = os.getenv("FT_CLIENT_ID"), os.getenv("FT_CLIENT_SECRET")
    if not cid or not secret or cid.startswith("PAR_votre"):
        return None
    r = requests.post(FT_TOKEN, timeout=DELAI, data={"grant_type": "client_credentials", "client_id": cid,
                      "client_secret": secret, "scope": "api_offresdemploiv2 o2dsoffre"})
    r.raise_for_status()
    jeton = r.json()["access_token"]
    sortie, debut, maximum = [], 0, (150 if verifier else 1150)   # l'API ne donne pas plus de 1 150 offres par requête
    while debut < maximum:
        r = requests.get(FT_SEARCH, timeout=DELAI, headers={"Authorization": f"Bearer {jeton}"},
                         params={"motsCles": "marketing", "range": f"{debut}-{min(debut + 149, maximum - 1)}"})
        if r.status_code == 204:
            break
        if r.status_code not in (200, 206):
            raise RuntimeError(f"France Travail {r.status_code} : {r.text[:200]}")
        lot = r.json().get("resultats", [])
        for o in lot:
            nat = (o.get("natureContrat") or "").lower()
            contrat = "Alternance" if ("apprentissage" in nat or "professionnalisation" in nat) else \
                "Indépendant (non salarié)" if "non salari" in nat else \
                contrat_par_intitule(o.get("intitule")) or FT_CONTRAT.get(o.get("typeContrat")) or "non précisé"
            smin, smax, periode = ft_salaire((o.get("salaire") or {}).get("libelle"), contrat)
            lt = o.get("lieuTravail") or {}
            ville = re.sub(r"^\s*(\d{2}|2A|2B)\s*-\s*", "", lt.get("libelle") or "")
            sortie.append(offre("France Travail", "API France Travail : mot-clé « marketing »", o.get("intitule"),
                                (o.get("entreprise") or {}).get("nom"), lieu_ville_cp(ville, lt.get("codePostal")),
                                contrat, (o.get("origineOffre") or {}).get("urlOrigine")
                                or f"https://candidat.francetravail.fr/offres/recherche/detail/{o.get('id')}",
                                smin, smax, periode, stexte=(o.get("salaire") or {}).get("libelle") or "",
                                secteur=o.get("secteurActiviteLibelle") or ""))
        if len(lot) < 150:
            break
        debut += 150
        time.sleep(0.3)
    return sortie


CANAUX = {"adzuna": adzuna, "lba": lba, "francetravail": france_travail}


# ---------------------------------------------------------------- nettoyage, comme à la main
def trier(offres):
    """Applique nos règles d'écart (cf. « Méthode et limites ») : renvoie (retenues, écartées)."""
    retenues, ecartees, vues = [], [], set()
    for o in offres:
        raisons = []
        cle = (o["canal"], o["intitule"].lower(), o["entreprise"].lower(), o["lieu"].lower())
        if cle in vues or (o["lien"] and (o["canal"], o["lien"]) in vues):
            raisons.append("doublon")
        vues.update({cle, (o["canal"], o["lien"])})
        if o["contrat"] == "non précisé":
            raisons.append("contrat non précisé dans l'annonce")
        if "non salarié" in o["contrat"]:
            raisons.append("non salarié")
        if not VRAI_MKT.search(o["intitule"]):
            raisons.append("sans lien avec un master Marketing Vente")
        o["lien_master"] = "hors champ" if "sans lien avec un master Marketing Vente" in raisons else "marketing"
        if raisons:
            o["raison_ecart"] = "doublon" if "doublon" in raisons else " + ".join(raisons)
            ecartees.append(o)
        else:
            retenues.append(o)
    return retenues, ecartees


def ecrire(chemin, colonnes, lignes):
    with chemin.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=colonnes, extrasaction="ignore")
        w.writeheader()
        for l in lignes:
            w.writerow({k: ("" if l.get(k) is None else (round(l[k]) if isinstance(l.get(k), float) else l[k])) for k in colonnes})


def lire(chemin):
    with chemin.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def mettre_a_jour_dates():
    """dates.json = nos relevés à la main ; dates_auto.json = les derniers jours du robot."""
    manuelles = sorted(p.stem.replace("offres_finales_", "") for p in (RACINE / "data" / "offres_finales").glob("offres_finales_*.csv"))
    auto = sorted(p.stem.replace("offres_finales_", "") for p in AUTO.glob("offres_finales_*.csv"))[-JOURS_AFFICHES:]
    (RACINE / "nos-offres" / "dates.json").write_text(json.dumps(manuelles) + "\n", encoding="utf-8")
    (RACINE / "nos-offres" / "dates_auto.json").write_text(json.dumps(auto) + "\n", encoding="utf-8")
    return manuelles, auto


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--canal", choices=list(CANAUX), help="un seul canal, pour essayer")
    ap.add_argument("--verifier", action="store_true", help="teste seulement les connexions (rien n'est écrit)")
    args = ap.parse_args()

    aujourdhui = f"{date.today():%Y-%m-%d}"
    AUTO.mkdir(parents=True, exist_ok=True)
    nouvelles, reussis, echecs = [], [], []
    for nom in ([args.canal] if args.canal else CANAUX):
        try:
            lot = CANAUX[nom](verifier=args.verifier)
        except Exception as e:                       # un canal en panne ne bloque pas les autres
            echecs.append(nom)
            print(f"{nom:14s} ÉCHEC : {e}")
            continue
        if lot is None:
            print(f"{nom:14s} sauté : clé absente (voir .env.example)")
            continue
        reussis.append(nom)
        print(f"{nom:14s} {len(lot):5d} offres")
        nouvelles += lot
    if args.verifier:
        sys.exit(1 if echecs or not reussis else 0)
    if not reussis:
        sys.exit("Aucun canal n'a répondu : rien n'est écrit.")

    for o in nouvelles:
        o["date_collecte"] = aujourdhui
        o["fichier_source"] = f"robot_{aujourdhui}"
    # Relancé le même jour : on remplace les canaux relancés, on garde les autres.
    canaux_relances = {o["canal"] for o in nouvelles}
    f_ret, f_eca = AUTO / f"offres_finales_{aujourdhui}.csv", AUTO / f"offres_ecartees_{aujourdhui}.csv"
    anciennes = []
    if f_ret.exists():
        anciennes = [o for o in lire(f_ret) + lire(f_eca) if o["canal"] not in canaux_relances]
    retenues, ecartees = trier([dict(o, raison_ecart="") for o in anciennes] + nouvelles)
    ecrire(f_ret, COLONNES_RET, retenues)
    ecrire(f_eca, COLONNES_ECA, ecartees)
    _, auto = mettre_a_jour_dates()

    for c in sorted({o["canal"] for o in retenues + ecartees}):
        r = sum(o["canal"] == c for o in retenues)
        e = sum(o["canal"] == c for o in ecartees)
        print(f"  {c:22s} {r + e:5d} relevées, {r:5d} retenues, {e:5d} écartées")
    print(f"\n{aujourdhui} : {len(retenues)} offres retenues, {len(ecartees)} écartées. Jours affichés : {', '.join(auto)}")
    if echecs:
        sys.exit(f"Canal(aux) en échec : {', '.join(echecs)} (les autres sont enregistrés).")


if __name__ == "__main__":
    main()

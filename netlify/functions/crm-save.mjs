/**
 * crm-save - enregistre le suivi commercial du CRM dans GitHub.
 *
 * Pourquoi un fichier de suivi separe : le CRM complet pese plusieurs mega-octets,
 * bien au-dela de ce qu'une fonction peut recevoir. Le CRM n'envoie donc que
 * les lignes qu'il a modifiees, et cette fonction les fusionne par SIREN dans
 * crm/suivi.csv, un fichier de quelques kilo-octets.
 *
 * Deux avantages :
 *  - l'envoi reste minuscule, quel que soit le volume de la base ;
 *  - deux commerciaux peuvent enregistrer en meme temps sans s'ecraser, puisque
 *    la fusion se fait toujours dans la derniere version du fichier.
 *
 * Le jeton GitHub reste dans les variables d'environnement Netlify : il ne
 * transite jamais par le navigateur.
 *
 * Variables d'environnement (Netlify > Site configuration > Environment variables) :
 *   GITHUB_TOKEN   jeton fine-grained, Contents Read and write sur le depot
 *   GITHUB_REPO    ex. Romtaug/prospection-tournees
 *   GITHUB_BRANCH  optionnel, main par defaut
 *   CRM_CODE       le code d'acces distribue aux commerciaux
 *
 * Requete : POST { code, updates: [ { siren, statut, notes, ... } ] }
 * Reponse : { ok:true, lignes, total } ou { ok:false, error }
 */

const FICHIER = "crm/suivi.csv";
const COLS = ["siren", "nom", "statut", "date_contact", "canal", "date_relance", "notes",
              "produit", "montant_vendu", "date_vente", "paye",
              "montant_encaisse", "commission", "statut_livraison", "maj_le"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const rep = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: CORS });

/* --- CSV minimal mais correct : gere les guillemets et les virgules --- */
function parseCSV(txt) {
  txt = txt.replace(/^\uFEFF/, "");
  const lignes = [];
  let champ = "", ligne = [], q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"') { if (txt[i + 1] === '"') { champ += '"'; i++; } else q = false; }
      else champ += c;
    } else if (c === '"') q = true;
    else if (c === ",") { ligne.push(champ); champ = ""; }
    else if (c === "\n") { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ""; }
    else if (c !== "\r") champ += c;
  }
  if (champ !== "" || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  if (!lignes.length) return [];
  const entetes = lignes[0].map(h => h.trim());
  return lignes.slice(1).filter(l => l.some(v => String(v).trim() !== ""))
    .map(l => { const o = {}; entetes.forEach((h, i) => o[h] = (l[i] ?? "").trim()); return o; });
}
function versCSV(rows) {
  const q = v => { v = v == null ? "" : String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return COLS.join(",") + "\n" + rows.map(r => COLS.map(c => q(r[c])).join(",")).join("\n") + "\n";
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return rep({ ok: false, error: "Methode non autorisee" }, 405);

  const TOKEN = process.env.GITHUB_TOKEN;
  const REPO = process.env.GITHUB_REPO;
  const BRANCH = process.env.GITHUB_BRANCH || "main";
  const CODE = process.env.CRM_CODE;
  if (!TOKEN || !REPO || !CODE) {
    return rep({ ok: false, error: "Configuration incomplete cote serveur : verifie GITHUB_TOKEN, "
      + "GITHUB_REPO et CRM_CODE dans les variables d'environnement Netlify, puis redeploie." }, 500);
  }

  let body;
  try { body = await req.json(); }
  catch { return rep({ ok: false, error: "Requete illisible" }, 400); }

  // --- code d'acces, comparaison a duree constante ---
  const f = String(body.code || "");
  let ecart = f.length === CODE.length ? 0 : 1;
  for (let i = 0; i < Math.max(f.length, CODE.length); i++) {
    ecart |= (f.charCodeAt(i) || 0) ^ (CODE.charCodeAt(i) || 0);
  }
  if (ecart !== 0) {
    await new Promise(r => setTimeout(r, 400));
    return rep({ ok: false, error: "Code d'acces invalide" }, 403);
  }

  const maj = Array.isArray(body.updates) ? body.updates : null;
  if (!maj || !maj.length) return rep({ ok: false, error: "Aucune modification a enregistrer" }, 400);
  if (maj.length > 5000) return rep({ ok: false, error: "Trop de modifications en une fois (5000 max)" }, 413);

  const head = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "crm-tournees",
  };
  const api = `https://api.github.com/repos/${REPO}/contents/${FICHIER}`;

  try {
    // --- etat actuel du fichier de suivi ---
    let sha = null, existant = [];
    const g = await fetch(`${api}?ref=${encodeURIComponent(BRANCH)}`, { headers: head });
    if (g.ok) {
      const j = await g.json();
      sha = j.sha;
      if (j.content) existant = parseCSV(Buffer.from(j.content, "base64").toString("utf8"));
    } else if (g.status !== 404) {
      return rep({ ok: false, error: `Lecture du suivi impossible (HTTP ${g.status})` }, 502);
    }

    // --- fusion par SIREN : les nouvelles valeurs remplacent les anciennes ---
    const parSiren = new Map();
    for (const r of existant) {
      const s = String(r.siren || "").trim();
      if (s) parSiren.set(s, r);
    }
    const horodatage = new Date().toISOString().slice(0, 16).replace("T", " ");
    let ecrites = 0;
    for (const u of maj) {
      const s = String(u.siren || "").replace(/\D/g, "");
      if (s.length !== 9) continue;
      const avant = parSiren.get(s) || {};
      const apres = { ...avant, siren: s, maj_le: horodatage };
      for (const c of COLS) {
        if (c === "siren" || c === "maj_le") continue;
        if (Object.prototype.hasOwnProperty.call(u, c)) apres[c] = String(u[c] ?? "").slice(0, 2000);
      }
      parSiren.set(s, apres);
      ecrites++;
    }
    if (!ecrites) return rep({ ok: false, error: "Aucun SIREN valide dans les modifications" }, 400);

    const rows = [...parSiren.values()].sort((a, b) =>
      String(b.maj_le || "").localeCompare(String(a.maj_le || "")));

    // --- ecriture ---
    const put = await fetch(api, {
      method: "PUT",
      headers: head,
      body: JSON.stringify({
        message: `Suivi CRM : ${ecrites} ligne(s) mise(s) a jour depuis le CRM`,
        content: Buffer.from("\uFEFF" + versCSV(rows), "utf8").toString("base64"),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
    if (put.status === 409 || put.status === 422) {
      return rep({ ok: false, error: "Quelqu'un a enregistre au meme instant. Reclique sur Enregistrer." }, 409);
    }
    if (!put.ok) {
      const j = await put.json().catch(() => ({}));
      return rep({ ok: false, error: `GitHub a refuse (HTTP ${put.status}) ${j.message || ""}`.trim() }, 502);
    }
    return rep({ ok: true, lignes: ecrites, total: rows.length, fichier: FICHIER });
  } catch (e) {
    return rep({ ok: false, error: `Erreur reseau : ${e.message}` }, 502);
  }
};

export const config = { path: "/api/crm-save" };

/**
 * crm-save - porte d'ecriture du CRM dans GitHub.
 *
 * Le cockpit ne detient aucun jeton : il envoie le CSV et un code d'acces.
 * Cette fonction verifie le code, puis ecrit dans le depot avec le jeton
 * range dans les variables d'environnement Netlify, invisible du navigateur.
 *
 * Variables d'environnement a definir dans Netlify
 * (Site configuration > Environment variables) :
 *   GITHUB_TOKEN   jeton fine-grained, Contents Read and write sur le depot
 *   GITHUB_REPO    ex. Romtaug/prospection-tournees
 *   GITHUB_BRANCH  optionnel, main par defaut
 *   CRM_CODE       le code d'acces distribue aux commerciaux
 *
 * Requete : POST { code, path, content, sha?, message? }
 * Reponse : { ok:true, sha } ou { ok:false, error, conflict? }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const rep = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: CORS });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return rep({ ok: false, error: "Methode non autorisee" }, 405);

  const TOKEN = process.env.GITHUB_TOKEN;
  const REPO = process.env.GITHUB_REPO;
  const BRANCH = process.env.GITHUB_BRANCH || "main";
  const CODE = process.env.CRM_CODE;
  if (!TOKEN || !REPO || !CODE) {
    return rep({ ok: false, error: "Configuration incomplete cote serveur (GITHUB_TOKEN, GITHUB_REPO, CRM_CODE)." }, 500);
  }

  let body;
  try { body = await req.json(); }
  catch { return rep({ ok: false, error: "Requete illisible" }, 400); }

  // --- code d'acces, compare a longueur constante ---
  const fourni = String(body.code || "");
  let ecart = fourni.length === CODE.length ? 0 : 1;
  for (let i = 0; i < Math.max(fourni.length, CODE.length); i++) {
    ecart |= (fourni.charCodeAt(i) || 0) ^ (CODE.charCodeAt(i) || 0);
  }
  if (ecart !== 0) {
    await new Promise(r => setTimeout(r, 400));      // ralentit les essais repetes
    return rep({ ok: false, error: "Code d'acces invalide" }, 403);
  }

  // --- le chemin est restreint au dossier du CRM ---
  const path = String(body.path || "").replace(/^\/+/, "");
  if (!/^crm\/[A-Za-z0-9_.-]+\.csv$/.test(path) || path.includes("..")) {
    return rep({ ok: false, error: "Chemin refuse : seuls les fichiers crm/*.csv sont modifiables." }, 400);
  }
  const content = String(body.content ?? "");
  if (!content.trim()) return rep({ ok: false, error: "Contenu vide" }, 400);
  if (content.length > 25e6) return rep({ ok: false, error: "Fichier trop volumineux (25 Mo max)" }, 413);

  const api = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const head = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "cockpit-tournees",
  };

  try {
    // sha courant : fourni par le client, sinon relu ici
    let sha = body.sha || null;
    if (!sha) {
      const g = await fetch(`${api}?ref=${encodeURIComponent(BRANCH)}`, { headers: head });
      if (g.ok) sha = (await g.json()).sha;
      else if (g.status !== 404) return rep({ ok: false, error: `Lecture impossible (HTTP ${g.status})` }, 502);
    }

    const put = await fetch(api, {
      method: "PUT",
      headers: head,
      body: JSON.stringify({
        message: String(body.message || "CRM : mise a jour depuis le cockpit").slice(0, 200),
        content: Buffer.from("\uFEFF" + content, "utf8").toString("base64"),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });

    if (put.status === 409 || put.status === 422) {
      return rep({ ok: false, conflict: true,
        error: "Le fichier a change sur GitHub depuis ton chargement. Recharge avant d'enregistrer." }, 409);
    }
    if (!put.ok) {
      const j = await put.json().catch(() => ({}));
      return rep({ ok: false, error: `GitHub a refuse (HTTP ${put.status}) ${j.message || ""}`.trim() }, 502);
    }
    const j = await put.json();
    return rep({ ok: true, sha: j.content?.sha || null, path });
  } catch (e) {
    return rep({ ok: false, error: `Erreur reseau : ${e.message}` }, 502);
  }
};

export const config = { path: "/api/crm-save" };

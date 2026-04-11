/**
 * Génère data/department-centres.json (lat/lon/zoom par code département INSEE).
 * Source : recherche Nominatim (OpenStreetMap) — respecter l’usage (délai entre requêtes).
 * Usage : node scripts/build-department-centres.mjs
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const OUT = path.resolve("data/department-centres.json");
const UA = "PrenomClash/1.0 (https://github.com/TopTopTop-Top/prenom ; cartes départementales)";

/** Même table que build-game-data.mjs (noms officiels). */
const DEPARTEMENTS = {
  "01": "Ain",
  "02": "Aisne",
  "03": "Allier",
  "04": "Alpes-de-Haute-Provence",
  "05": "Hautes-Alpes",
  "06": "Alpes-Maritimes",
  "07": "Ardèche",
  "08": "Ardennes",
  "09": "Ariège",
  10: "Aube",
  11: "Aude",
  12: "Aveyron",
  13: "Bouches-du-Rhône",
  14: "Calvados",
  15: "Cantal",
  16: "Charente",
  "17": "Charente-Maritime",
  18: "Cher",
  19: "Corrèze",
  20: "Corse",
  21: "Côte-d'Or",
  22: "Côtes-d'Armor",
  23: "Creuse",
  24: "Dordogne",
  25: "Doubs",
  26: "Drôme",
  27: "Eure",
  28: "Eure-et-Loir",
  29: "Finistère",
  30: "Gard",
  31: "Haute-Garonne",
  32: "Gers",
  33: "Gironde",
  34: "Hérault",
  35: "Ille-et-Vilaine",
  36: "Indre",
  37: "Indre-et-Loire",
  38: "Isère",
  39: "Jura",
  40: "Landes",
  41: "Loir-et-Cher",
  42: "Loire",
  43: "Haute-Loire",
  44: "Loire-Atlantique",
  45: "Loiret",
  46: "Lot",
  47: "Lot-et-Garonne",
  48: "Lozère",
  49: "Maine-et-Loire",
  50: "Manche",
  51: "Marne",
  52: "Haute-Marne",
  53: "Mayenne",
  54: "Meurthe-et-Moselle",
  55: "Meuse",
  56: "Morbihan",
  57: "Moselle",
  58: "Nièvre",
  59: "Nord",
  60: "Oise",
  61: "Orne",
  62: "Pas-de-Calais",
  63: "Puy-de-Dôme",
  64: "Pyrénées-Atlantiques",
  65: "Hautes-Pyrénées",
  66: "Pyrénées-Orientales",
  67: "Bas-Rhin",
  68: "Haut-Rhin",
  69: "Rhône",
  70: "Haute-Saône",
  71: "Saône-et-Loire",
  72: "Sarthe",
  73: "Savoie",
  74: "Haute-Savoie",
  75: "Paris",
  76: "Seine-Maritime",
  77: "Seine-et-Marne",
  78: "Yvelines",
  79: "Deux-Sèvres",
  80: "Somme",
  81: "Tarn",
  82: "Tarn-et-Garonne",
  83: "Var",
  84: "Vaucluse",
  85: "Vendée",
  86: "Vienne",
  87: "Haute-Vienne",
  88: "Vosges",
  89: "Yonne",
  90: "Territoire de Belfort",
  91: "Essonne",
  92: "Hauts-de-Seine",
  93: "Seine-Saint-Denis",
  94: "Val-de-Marne",
  95: "Val-d'Oise",
  971: "Guadeloupe",
  972: "Martinique",
  973: "Guyane",
  974: "La Réunion",
  976: "Mayotte",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpsJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": UA } }, (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function norm(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function pickResult(depName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const n = norm(depName);
  const county = rows.find(
    (r) =>
      r.addresstype === "county" &&
      r.name &&
      norm(r.name) === n
  );
  if (county) return county;
  const byIso = rows.find(
    (r) =>
      r.address?.["ISO3166-2-lvl6"] &&
      String(r.address["ISO3166-2-lvl6"]).match(/^FR-\d/)
  );
  if (byIso && norm(byIso.name) === n) return byIso;
  const boundary = rows.find(
    (r) => r.class === "boundary" && r.name && norm(r.name) === n
  );
  return boundary || rows[0];
}

function zoomFor(code, depName) {
  const c = String(code);
  if (c === "75" || c === "92" || c === "93" || c === "94") return 11;
  if (["971", "972", "973", "974", "976"].includes(c)) return 9;
  if (depName === "Paris") return 11;
  return 9;
}

async function main() {
  const out = {};
  const entries = Object.entries(DEPARTEMENTS).sort(([a], [b]) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );

  for (const [code, depName] of entries) {
    const q = encodeURIComponent(`${depName}, France`);
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5&addressdetails=1`;
    let row = null;
    try {
      const rows = await httpsJson(url);
      row = pickResult(depName, rows);
    } catch (e) {
      console.warn(code, depName, e.message);
    }
    if (row) {
      out[String(code)] = {
        lat: Number.parseFloat(row.lat),
        lon: Number.parseFloat(row.lon),
        zoom: zoomFor(code, depName),
      };
      console.log("OK", code, depName, out[String(code)]);
    } else {
      console.warn("MISS", code, depName);
    }
    await sleep(1200);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ source: "nominatim", builtAt: new Date().toISOString(), centres: out }, null, 0));
  console.log("Wrote", OUT, Object.keys(out).length, "departments");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const natCsvPath =
  process.env.NAT_CSV || "/Users/robert/Downloads/prenoms-2024-nat.csv";
const regCsvPath =
  process.env.REG_CSV || "/Users/robert/Downloads/prenoms-2024-reg.csv";
const dptCsvPath =
  process.env.DPT_CSV || "/Users/robert/Downloads/prenoms-2024-dpt.csv";
const outPath = path.resolve("data/game-data.json");

const REGIONS = {
  "01": "Guadeloupe",
  "02": "Martinique",
  "03": "Guyane",
  "04": "La Réunion",
  "06": "Mayotte",
  11: "Île-de-France",
  24: "Centre-Val de Loire",
  27: "Bourgogne-Franche-Comté",
  28: "Normandie",
  32: "Hauts-de-France",
  44: "Grand Est",
  52: "Pays de la Loire",
  53: "Bretagne",
  75: "Nouvelle-Aquitaine",
  76: "Occitanie",
  84: "Auvergne-Rhône-Alpes",
  93: "Provence-Alpes-Côte d'Azur",
  94: "Corse",
};

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
  17: "Charente-Maritime",
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

function normalizeName(name) {
  return name.trim().toUpperCase();
}

function ensureBucket(map, key, factory) {
  if (!map.has(key)) {
    map.set(key, factory());
  }
  return map.get(key);
}

async function parseNational() {
  const names = new Map();
  let lineNo = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(natCsvPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNo += 1;
    if (lineNo === 1 || !line.trim()) {
      continue;
    }

    const [sexeRaw, prenomRaw, periodeRaw, valeurRaw] = line.split(";");
    const prenom = normalizeName(prenomRaw);
    const period = Number.parseInt(periodeRaw, 10);
    const value = Number.parseInt(valeurRaw, 10);
    const sexe = Number.parseInt(sexeRaw, 10);

    if (
      !prenom ||
      Number.isNaN(period) ||
      Number.isNaN(value) ||
      Number.isNaN(sexe)
    ) {
      continue;
    }

    const entry = ensureBucket(names, prenom, () => ({
      prenom,
      total: 0,
      sexTotals: { 1: 0, 2: 0 },
      yearly: {},
      peak: { year: period, value: value },
    }));

    entry.total += value;
    entry.sexTotals[String(sexe)] =
      (entry.sexTotals[String(sexe)] || 0) + value;
    entry.yearly[String(period)] = (entry.yearly[String(period)] || 0) + value;

    if (entry.yearly[String(period)] > entry.peak.value) {
      entry.peak = { year: period, value: entry.yearly[String(period)] };
    }
  }

  return names;
}

async function parseRegional() {
  const byRegion = new Map();
  let lineNo = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(regCsvPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNo += 1;
    if (lineNo === 1 || !line.trim()) {
      continue;
    }

    const [sexeRaw, prenomRaw, periodeRaw, regRaw, valeurRaw] = line.split(";");
    const prenom = normalizeName(prenomRaw);
    const period = Number.parseInt(periodeRaw, 10);
    const value = Number.parseInt(valeurRaw, 10);
    const sexe = Number.parseInt(sexeRaw, 10);
    const regCode = regRaw.trim().padStart(2, "0");

    if (
      !prenom ||
      Number.isNaN(period) ||
      Number.isNaN(value) ||
      Number.isNaN(sexe)
    ) {
      continue;
    }

    const region = ensureBucket(byRegion, regCode, () => ({
      code: regCode,
      name: REGIONS[regCode] || `Région ${regCode}`,
      total: 0,
      topNames: new Map(),
    }));

    region.total += value;
    const nameBucket = ensureBucket(region.topNames, prenom, () => ({
      total: 0,
      sexTotals: { 1: 0, 2: 0 },
      yearly: {},
    }));
    nameBucket.total += value;
    nameBucket.sexTotals[String(sexe)] =
      (nameBucket.sexTotals[String(sexe)] || 0) + value;
    nameBucket.yearly[String(period)] =
      (nameBucket.yearly[String(period)] || 0) + value;
  }

  return byRegion;
}

async function parseDepartments() {
  const byDepartment = new Map();
  let lineNo = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(dptCsvPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNo += 1;
    if (lineNo === 1 || !line.trim()) {
      continue;
    }

    const parts = line.split(";");
    if (parts.length < 5) {
      continue;
    }
    const [sexeRaw, prenomRaw, periodeRaw, dptRaw, valeurRaw] = parts;
    const prenom = normalizeName(prenomRaw);
    const period = Number.parseInt(periodeRaw, 10);
    const value = Number.parseInt(valeurRaw, 10);
    const sexe = Number.parseInt(sexeRaw, 10);
    const dptCode = (dptRaw || "").trim();

    if (
      !prenom ||
      !dptCode ||
      Number.isNaN(period) ||
      Number.isNaN(value) ||
      Number.isNaN(sexe)
    ) {
      continue;
    }

    const dpt = ensureBucket(byDepartment, dptCode, () => ({
      code: dptCode,
      name: DEPARTEMENTS[dptCode] || `Département ${dptCode}`,
      total: 0,
      topNames: new Map(),
    }));

    dpt.total += value;
    const nameBucket = ensureBucket(dpt.topNames, prenom, () => ({
      total: 0,
      sexTotals: { 1: 0, 2: 0 },
      yearly: {},
    }));
    nameBucket.total += value;
    nameBucket.sexTotals[String(sexe)] =
      (nameBucket.sexTotals[String(sexe)] || 0) + value;
    nameBucket.yearly[String(period)] =
      (nameBucket.yearly[String(period)] || 0) + value;
  }

  return byDepartment;
}

function getTopNames(mapOfCounts, count = 15) {
  return [...mapOfCounts.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, count)
    .map(([name, value]) => ({
      name,
      value: value.total,
      sexTotals: value.sexTotals,
      yearly: value.yearly || {},
    }));
}

function rangeSum(yearly, start, end) {
  let sum = 0;
  for (let y = start; y <= end; y += 1) {
    sum += yearly[String(y)] || 0;
  }
  return sum;
}

async function main() {
  const hasNat = fs.existsSync(natCsvPath);
  const hasReg = fs.existsSync(regCsvPath);
  const hasDpt = fs.existsSync(dptCsvPath);

  if (!hasNat || !hasReg || !hasDpt) {
    // In cloud deploys (Render static), local CSV paths do not exist.
    // If prebuilt data is already committed, keep it and let deploy continue.
    if (fs.existsSync(outPath)) {
      console.log("CSV introuvables dans cet environnement.");
      console.log(`Réutilisation du fichier existant: ${outPath}`);
      return;
    }
    throw new Error(
      "Un ou plusieurs fichiers CSV introuvables et aucun data/game-data.json existant."
    );
  }

  console.log("Parsing national CSV...");
  const namesMap = await parseNational();
  console.log(`National names: ${namesMap.size}`);

  console.log("Parsing regional CSV...");
  const regionsMap = await parseRegional();
  console.log(`Regions found: ${regionsMap.size}`);

  console.log("Parsing department CSV...");
  const departmentsMap = await parseDepartments();
  console.log(`Departments found: ${departmentsMap.size}`);

  const playableNames = [...namesMap.values()]
    .filter((n) => n.total >= 150)
    .sort((a, b) => b.total - a.total);

  const namesLite = playableNames.map((n) => ({
    prenom: n.prenom,
    total: n.total,
    sexTotals: n.sexTotals,
    yearly: n.yearly,
    peak: n.peak,
    recent2015_2024: rangeSum(n.yearly, 2015, 2024),
    old1900_1980: rangeSum(n.yearly, 1900, 1980),
  }));

  const regions = [...regionsMap.values()]
    .map((r) => ({
      code: r.code,
      name: r.name,
      total: r.total,
      topNames: getTopNames(r.topNames, 20),
    }))
    .sort((a, b) => b.total - a.total);

  const departments = [...departmentsMap.values()]
    .map((d) => ({
      code: d.code,
      name: d.name,
      total: d.total,
      topNames: getTopNames(d.topNames, 20),
    }))
    .sort((a, b) => b.total - a.total);

  const output = {
    meta: {
      builtAt: new Date().toISOString(),
      source: {
        natCsvPath,
        regCsvPath,
        dptCsvPath,
      },
      playableNames: namesLite.length,
    },
    regions,
    departments,
    names: namesLite,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output));
  console.log(`Game data written to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

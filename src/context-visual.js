/**
 * Carte (Leaflet + tuiles OSM) et graphique temporel (canvas) pour le jeu.
 * Leaflet doit être chargé globalement (window.L) avant le module app.
 */

/** Centres approximatifs par code région INSEE (API geo.gouv). */
export const REGION_MAP_FOCUS = {
  "01": { lat: 16.25, lon: -61.55, zoom: 9 },
  "02": { lat: 14.64, lon: -61.02, zoom: 9 },
  "03": { lat: 3.93, lon: -53.13, zoom: 6 },
  "04": { lat: -21.12, lon: 55.55, zoom: 10 },
  "06": { lat: -12.83, lon: 45.15, zoom: 11 },
  11: { lat: 48.7, lon: 2.4, zoom: 8 },
  24: { lat: 47.5, lon: 1.75, zoom: 7 },
  27: { lat: 47.3, lon: 4.8, zoom: 7 },
  28: { lat: 49.2, lon: 0.5, zoom: 8 },
  32: { lat: 50.4, lon: 3.0, zoom: 8 },
  44: { lat: 48.5, lon: 6.2, zoom: 7 },
  52: { lat: 47.45, lon: -0.85, zoom: 8 },
  53: { lat: 48.2, lon: -2.8, zoom: 8 },
  /** Centroid approximatif de la région (OSM), pas Bordeaux — pour vue « région » seulement. */
  75: { lat: 45.4, lon: 0.38, zoom: 7 },
  76: { lat: 43.6, lon: 2.5, zoom: 7 },
  84: { lat: 45.4, lon: 4.4, zoom: 7 },
  93: { lat: 43.9, lon: 6.2, zoom: 7 },
  94: { lat: 42.0, lon: 9.0, zoom: 8 },
};

const DEFAULT_FOCUS = { lat: 46.5, lon: 2.5, zoom: 5 };

const departmentCentresUrl = "./data/department-centres.json";
/** @type {Promise<Record<string, { lat: number, lon: number, zoom?: number }>> | null} */
let departmentCentresPromise = null;

function loadDepartmentCentres() {
  if (!departmentCentresPromise) {
    departmentCentresPromise = fetch(departmentCentresUrl)
      .then((r) => (r.ok ? r.json() : { centres: {} }))
      .then((j) => j.centres || {})
      .catch(() => ({}));
  }
  return departmentCentresPromise;
}

let leafletMap = null;
/** Incrémenté à chaque reset : ignore les fetch carte arrivés trop tard. */
let mapEpoch = 0;

function getL() {
  return typeof window !== "undefined" ? window.L : null;
}

function setGeoLinks(query) {
  const osm = document.getElementById("geoLinkOsm");
  const gm = document.getElementById("geoLinkGmaps");
  if (!osm || !gm) return;
  const q = encodeURIComponent(query);
  osm.href = `https://www.openstreetmap.org/search?query=${q}`;
  gm.href = `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function hideGeoPanel() {
  const geoBlock = document.getElementById("geoBlock");
  const mapEl = document.getElementById("leafletMap");
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
  if (mapEl) mapEl.innerHTML = "";
  if (geoBlock) geoBlock.classList.add("hidden");
}

export function clearContextPanel() {
  mapEpoch += 1;
  const wrap = document.getElementById("contextVisual");
  const chartBlock = document.getElementById("chartBlock");

  hideGeoPanel();

  if (chartBlock) chartBlock.classList.add("hidden");
  if (wrap) wrap.classList.add("hidden");

  const legend = document.getElementById("chartLegend");
  if (legend) legend.innerHTML = "";
}

function showContextShell() {
  const wrap = document.getElementById("contextVisual");
  if (wrap) wrap.classList.remove("hidden");
}

function initLeafletMap(lat, lon, zoom, popupHtml) {
  const L = getL();
  const mapEl = document.getElementById("leafletMap");
  if (!L || !mapEl) return;

  mapEl.innerHTML = "";
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }

  leafletMap = L.map(mapEl, { scrollWheelZoom: false }).setView(
    [lat, lon],
    zoom
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  }).addTo(leafletMap);
  L.marker([lat, lon]).addTo(leafletMap).bindPopup(popupHtml).openPopup();
  setTimeout(() => leafletMap?.invalidateSize(), 100);
}

/**
 * @param {{ code: string, name: string }} region
 */
export function showRegionGeoContext(region) {
  const geoBlock = document.getElementById("geoBlock");
  const hint = document.getElementById("geoHint");
  if (!geoBlock || !hint) return;

  clearContextPanel();
  showContextShell();
  geoBlock.classList.remove("hidden");

  const focus = REGION_MAP_FOCUS[region.code] || DEFAULT_FOCUS;
  const query = `${region.name}, région France`;
  hint.textContent =
    "Repère la région sur la carte (centre approximatif de la région, pas une ville en particulier). Affiner avec les liens ci-dessous.";
  setGeoLinks(query);
  initLeafletMap(
    focus.lat,
    focus.lon,
    focus.zoom,
    `<strong>${region.name}</strong><br>Région française (INSEE ${region.code}).`
  );
}

/**
 * @param {{ code: string, name: string }} dpt
 */
export async function showDepartmentGeoContext(dpt) {
  const geoBlock = document.getElementById("geoBlock");
  const hint = document.getElementById("geoHint");
  if (!geoBlock || !hint) return;

  const epochAtStart = mapEpoch;

  showContextShell();
  geoBlock.classList.remove("hidden");

  let codeRegion = null;
  let apiNom = dpt.name;
  const centresPromise = loadDepartmentCentres();

  try {
    const res = await fetch(
      `https://geo.api.gouv.fr/departements/${encodeURIComponent(dpt.code)}`
    );
    if (res.ok) {
      const j = await res.json();
      codeRegion = j.codeRegion ? String(j.codeRegion).padStart(2, "0") : null;
      if (j.nom) apiNom = j.nom;
    }
  } catch {
    /* réseau / CORS rare */
  }

  const centres = await centresPromise;
  const deptCenter = centres[String(dpt.code)];

  if (epochAtStart !== mapEpoch) {
    return;
  }

  if (!codeRegion && dpt.code === "20") {
    codeRegion = "94";
  }

  const query = `${dpt.name} département France`;
  setGeoLinks(query);

  if (
    deptCenter &&
    typeof deptCenter.lat === "number" &&
    typeof deptCenter.lon === "number"
  ) {
    hint.textContent =
      `Marqueur au centre géographique du département ${dpt.name} (données OpenStreetMap / Nominatim, fichier local). Les liens permettent d’affiner.`;
    initLeafletMap(
      deptCenter.lat,
      deptCenter.lon,
      deptCenter.zoom ?? 9,
      `<strong>${apiNom}</strong> (${dpt.code})<br>Centre du département sur la carte.`
    );
    return;
  }

  const focus = (codeRegion && REGION_MAP_FOCUS[codeRegion]) || DEFAULT_FOCUS;
  hint.textContent = codeRegion
    ? `Pas de centre départemental en base — vue régionale. Cherche « ${dpt.name} » avec les liens pour un zoom précis.`
    : `Localise le département avec les liens ci-dessous (carte France).`;

  initLeafletMap(
    focus.lat,
    focus.lon,
    focus.zoom,
    `<strong>${apiNom}</strong> (${dpt.code})<br>Département — repli : carte centrée sur la région parente.`
  );
}

/**
 * @param {object} opts
 * @param {number} [opts.yearMin]
 * @param {number} [opts.yearMax]
 * @param {Array<{ label: string, color: string, yearly: Record<string, number> }>} opts.series
 * @param {Array<{ from: number, to: number, fill: string, label?: string }>} [opts.highlights]
 * @param {Array<{ year: number, color: string, width?: number }>} [opts.markYears]
 * @param {string} [opts.caption]
 * @param {{ keepGeo?: boolean }} [displayOpts] — avec carte région/dépt, passer keepGeo: true
 */
export function showTimelineChart(opts, displayOpts = {}) {
  const wrap = document.getElementById("contextVisual");
  const chartBlock = document.getElementById("chartBlock");
  const canvas = document.getElementById("timelineCanvas");
  const cap = document.getElementById("chartCaption");
  const legend = document.getElementById("chartLegend");
  if (!wrap || !chartBlock || !canvas || !cap || !legend) return;

  if (!displayOpts.keepGeo) {
    hideGeoPanel();
  }

  showContextShell();
  chartBlock.classList.remove("hidden");

  const yearMin = opts.yearMin ?? 1900;
  const yearMax = opts.yearMax ?? 2024;
  const years = [];
  for (let y = yearMin; y <= yearMax; y += 1) {
    years.push(y);
  }

  let yMax = 1;
  for (const s of opts.series) {
    for (const y of years) {
      const v = s.yearly[String(y)] || 0;
      if (v > yMax) yMax = v;
    }
  }
  yMax *= 1.08;

  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 28;

  const parent = canvas.parentElement;
  const logicalW = Math.min(640, (parent?.clientWidth || 600) - 8);
  const logicalH = 210;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = logicalW * dpr;
  canvas.height = logicalH * dpr;
  canvas.style.width = `${logicalW}px`;
  canvas.style.height = `${logicalH}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = logicalW;
  const H = logicalH;
  ctx.clearRect(0, 0, W, H);

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  function xOf(year) {
    return padL + ((year - yearMin) / (yearMax - yearMin)) * plotW;
  }

  function yOf(v) {
    return padT + (1 - v / yMax) * plotH;
  }

  cap.textContent =
    opts.caption ||
    `Naissances en France (${yearMin}–${yearMax}, source jeu INSEE agrégée)`;

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(padL, padT, plotW, plotH);

  if (opts.highlights) {
    for (const h of opts.highlights) {
      const x1 = xOf(Math.max(yearMin, h.from));
      const x2 = xOf(Math.min(yearMax, h.to));
      ctx.fillStyle = h.fill;
      ctx.fillRect(x1, padT, Math.max(1, x2 - x1), plotH);
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  for (let y = yearMin; y <= yearMax; y += 25) {
    const x = xOf(y);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = "rgba(200,210,255,0.55)";
    ctx.font = "10px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(y), x, H - 8);
  }

  if (opts.markYears) {
    for (const m of opts.markYears) {
      if (m.year < yearMin || m.year > yearMax) continue;
      const x = xOf(m.year);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.width ?? 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  for (const s of opts.series) {
    ctx.beginPath();
    let first = true;
    for (const y of years) {
      const v = s.yearly[String(y)] || 0;
      const px = xOf(y);
      const py = yOf(v);
      if (first) {
        ctx.moveTo(px, py);
        first = false;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(200,210,255,0.7)";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(formatFr(yMax), padL - 6, padT + 4);
  ctx.fillText("0", padL - 6, padT + plotH);

  legend.innerHTML = "";
  const legItems = document.createElement("div");
  legItems.className = "chart-legend-items";
  for (const s of opts.series) {
    const row = document.createElement("span");
    row.className = "chart-legend-item";
    row.innerHTML = `<i style="background:${s.color}"></i>${escapeHtml(
      s.label
    )}`;
    legItems.appendChild(row);
  }
  legend.appendChild(legItems);

  if (opts.highlights?.length) {
    const hi = document.createElement("div");
    hi.className = "chart-legend-highlights";
    hi.textContent = opts.highlights
      .filter((h) => h.label)
      .map((h) => h.label)
      .join(" · ");
    legend.appendChild(hi);
  }
}

function formatFr(n) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(
    Math.round(n)
  );
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

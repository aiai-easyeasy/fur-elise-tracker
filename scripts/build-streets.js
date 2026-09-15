// Build the offline street payload for all of Taipei (build/tiles → data/streets.js),
// bucketed by map cell so the page only decodes and draws the cells on screen.
// Reads tile files one at a time: the whole city does not fit in memory as one document.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TILES = path.join(ROOT, "build", "tiles");
const OUTFILE = path.join(ROOT, "data", "streets.js");

const ORIGIN = [24.95, 121.44];     // south-west of Taipei City
const SCALE = 100000;               // 1e-5 deg ~= 1.1 m
const CELL = 0.02;                  // cell edge in degrees (~2.2 km)
const MIN_STEP = 2;                 // drop vertices within ~2 m of the previous kept one
const LABEL_EVERY = 340;            // metres between label anchors on one road
const LOOKAHEAD = 35;               // metres ahead of an anchor, used for the text angle

// 0 arterial | 1 secondary | 2 residential | 3 service (巷弄) | 4 foot
const CLASS = {
  motorway:0, motorway_link:0, trunk:0, trunk_link:0, primary:0, primary_link:0,
  secondary:1, secondary_link:1, tertiary:1, tertiary_link:1,
  residential:2, unclassified:2, living_street:2,
  service:3,
  pedestrian:4
};
const SKIP_SERVICE = /^(parking_aisle|driveway|drive-through|emergency_access)$/;
const MIN_LABEL_LEN = [45, 45, 45, 30, 60];

const MPERLAT = 110540, MPERLNG = 100700;
const metres = (a,b) => Math.hypot((a[1]-b[1])*MPERLNG, (a[0]-b[0])*MPERLAT);
function walk(pts, i, d){
  while (i < pts.length - 1){
    const seg = metres(pts[i], pts[i+1]);
    if (seg >= d){
      const f = seg === 0 ? 0 : d/seg;
      return [[pts[i][0] + (pts[i+1][0]-pts[i][0])*f, pts[i][1] + (pts[i+1][1]-pts[i][1])*f], i];
    }
    d -= seg; i++;
  }
  return [pts[pts.length-1], pts.length-1];
}

const qlat = lat => Math.round((lat - ORIGIN[0]) * SCALE);
const qlng = lng => Math.round((lng - ORIGIN[1]) * SCALE);
const cellOf = (lat, lng) => Math.floor((lat - ORIGIN[0]) / CELL) + ":" + Math.floor((lng - ORIGIN[1]) / CELL);

const sources = fs.existsSync(TILES)
  ? fs.readdirSync(TILES).filter(f => /^\d.*\.json$/.test(f)).sort().map(f => path.join(TILES, f))
  : [];
if (!sources.length) throw new Error("no tiles in build/tiles — run: npm run fetch-streets");

const W = Object.create(null), LB = Object.create(null);
const names = [], nameIdx = new Map(), place = new Map(), seenWay = new Set();
const byClass = [0,0,0,0,0], lblByClass = [0,0,0,0,0];
let bad = 0, srcPoints = 0, keptPoints = 0, skippedService = 0;

for (const file of sources){
  let elements;
  try { elements = JSON.parse(fs.readFileSync(file, "utf8")).elements || []; }
  catch { bad++; console.log("unreadable:", path.basename(file)); continue; }

  for (const el of elements){
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    if (seenWay.has(el.id)) continue;
    seenWay.add(el.id);
    const tags = el.tags || {};
    const cls = CLASS[tags.highway];
    if (cls === undefined) continue;
    if (cls === 3 && SKIP_SERVICE.test(tags.service || "")) { skippedService++; continue; }

    const geo = el.geometry.map(p => [p.lat, p.lon]);

    /* geometry, bucketed by the cell holding the way's bounding-box centre */
    const qp = geo.map(p => [qlat(p[0]), qlng(p[1])]);
    srcPoints += qp.length;
    const keep = [qp[0]];
    for (let i = 1; i < qp.length - 1; i++){
      const last = keep[keep.length-1];
      if (Math.abs(qp[i][0]-last[0]) + Math.abs(qp[i][1]-last[1]) >= MIN_STEP) keep.push(qp[i]);
    }
    keep.push(qp[qp.length-1]);
    keptPoints += keep.length;

    let la0 = 90, la1 = -90, ln0 = 180, ln1 = -180;
    for (const p of geo){ la0 = Math.min(la0, p[0]); la1 = Math.max(la1, p[0]); ln0 = Math.min(ln0, p[1]); ln1 = Math.max(ln1, p[1]); }
    const home = cellOf((la0 + la1) / 2, (ln0 + ln1) / 2);

    const w = [cls, keep[0][0], keep[0][1]];
    for (let i = 1; i < keep.length; i++) w.push(keep[i][0]-keep[i-1][0], keep[i][1]-keep[i-1][1]);
    (W[home] ??= []).push(w);
    byClass[cls]++;

    /* labels + search index */
    const nm = tags.name;
    if (!nm) continue;
    let ni = nameIdx.get(nm);
    if (ni === undefined){ ni = names.length; names.push(nm); nameIdx.set(nm, ni); }

    let total = 0;
    for (let i = 0; i < geo.length-1; i++) total += metres(geo[i], geo[i+1]);
    const mid = walk(geo, 0, total/2)[0];
    const pl = place.get(nm);
    if (!pl || total > pl.len) place.set(nm, { lat:mid[0], lng:mid[1], cls: pl ? Math.min(cls, pl.cls) : cls, len:total });

    if (total < MIN_LABEL_LEN[cls]) continue;
    const n = Math.max(1, Math.floor(total / LABEL_EVERY));
    for (let k = 0; k < n; k++){
      const at = total * (k + 0.5) / n;
      const [p, idx] = walk(geo, 0, at);
      const [ahead] = walk(geo, idx, Math.min(LOOKAHEAD, Math.max(5, total - at)));
      if (metres(p, ahead) < 3) continue;
      (LB[cellOf(p[0], p[1])] ??= []).push([ni, cls, qlat(p[0]), qlng(p[1]), qlat(ahead[0]), qlng(ahead[1])]);
      lblByClass[cls]++;
    }
  }
}

const search = [...place.entries()]
  .map(([nm, p]) => [nm, p.cls, qlat(p.lat), qlng(p.lng)])
  .sort((a,b) => a[1]-b[1] || a[0].localeCompare(b[0], "zh-Hant"));

const js = "window.STREETS=" + JSON.stringify({ o:ORIGIN, s:SCALE, cell:CELL, w:W, n:names, l:LB, q:search }) + ";";
fs.writeFileSync(OUTFILE, js, "utf8");

console.log("tiles          :", sources.length, bad ? `(${bad} unreadable)` : "");
console.log("ways           :", seenWay.size, `(dropped ${skippedService} parking/driveway service ways)`);
console.log("road classes   : arterial=%d secondary=%d residential=%d service=%d foot=%d", ...byClass);
console.log("vertices       :", srcPoints, "->", keptPoints);
console.log("cells          :", Object.keys(W).length, "with roads,", Object.keys(LB).length, "with labels");
console.log("names / search :", names.length, "/", search.length);
console.log("label anchors  : arterial=%d secondary=%d residential=%d service=%d foot=%d", ...lblByClass);
console.log("data/streets.js:", (Buffer.byteLength(js, "utf8") / 1048576).toFixed(2) + " MB");

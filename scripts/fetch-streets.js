// Fetch Taipei street geometry from Overpass, tile by tile.
//  - only tiles near a garbage-truck stop (skips mountains and New Taipei)
//  - resumable: finished tiles on disk are skipped
//  - a tile that times out is retried on another mirror, then split into four
// Needs build/data.orig.js (run scripts/build-stops.js first).
// Output: build/tiles/<s>_<w>_<n>_<e>.json   (read by scripts/build-streets.js)
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "build", "tiles");
const STOPS_FILE = path.join(ROOT, "build", "data.orig.js");

const CELL = 0.02;             // starting tile edge in degrees (~2.2 km × 2.0 km)
const MIN_CELL = 0.005;        // stop splitting below this
const NEAR = 0.008;            // keep a tile if a stop lies within this margin of it
const WORKERS = 2;             // Overpass fair use: at most two concurrent requests
const PAUSE_MS = 1500;
const MIRRORS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

if (!fs.existsSync(STOPS_FILE)) throw new Error("build/data.orig.js not found — run: node scripts/build-stops.js");
fs.mkdirSync(DIR, { recursive: true });

/* ---- tiles that matter: any stop inside, or within NEAR of the edge ---- */
global.window = {};
eval(fs.readFileSync(STOPS_FILE, "utf8"));
const stops = window.STOPS;
const lat0 = Math.floor(Math.min(...stops.map(s => s.t)) / CELL) * CELL;
const lng0 = Math.floor(Math.min(...stops.map(s => s.g)) / CELL) * CELL;
const need = new Map();
for (const s of stops){
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
    const iy = Math.floor((s.t - lat0) / CELL) + dy, ix = Math.floor((s.g - lng0) / CELL) + dx;
    const south = lat0 + iy * CELL, west = lng0 + ix * CELL;
    if (s.t < south - NEAR || s.t > south + CELL + NEAR || s.g < west - NEAR || s.g > west + CELL + NEAR) continue;
    need.set(iy + ":" + ix, [south, west, south + CELL, west + CELL]);
  }
}

const r5 = x => (Math.round(x * 1e5) / 1e5).toFixed(5);
const nameOf = b => path.join(DIR, b.map(r5).join("_") + ".json");
const queue = [...need.values()].filter(b => !fs.existsSync(nameOf(b)));
const failed = [];
let done = 0, planned = need.size;

const query = b => `[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|pedestrian)$"](${b.join(",")});
  way["highway"="service"]["service"!~"^(parking_aisle|driveway|drive-through|emergency_access)$"](${b.join(",")});
);
out geom;`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${msg}`);

async function attempt(b, mirror){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 200000);
  try {
    const res = await fetch(mirror, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "fur-elise-tracker/1.0 (offline map build)" },
      body: "data=" + encodeURIComponent(query(b)),
      signal: ctl.signal
    });
    const txt = await res.text();
    if (res.status !== 200) return { ok: false, why: "HTTP " + res.status };
    let j;
    try { j = JSON.parse(txt); } catch { return { ok: false, why: "not JSON" }; }
    if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) return { ok: false, why: "remark: " + j.remark.slice(0, 60) };
    return { ok: true, json: txt, ways: (j.elements || []).length };
  } catch (e) {
    return { ok: false, why: e.name === "AbortError" ? "client timeout" : e.message };
  } finally { clearTimeout(timer); }
}

async function work(id){
  while (queue.length){
    const b = queue.shift();
    let result = null;
    for (let k = 0; k < MIRRORS.length && !(result && result.ok); k++){
      const mirror = MIRRORS[(id + k) % MIRRORS.length];
      result = await attempt(b, mirror);
      if (!result.ok){ log(`w${id} ${b.map(r5)} ✗ ${result.why} @ ${new URL(mirror).host}`); await sleep(5000); }
    }
    if (result.ok){
      fs.writeFileSync(nameOf(b), result.json, "utf8");
      done++;
      log(`w${id} ✓ ${done}/${planned} ${b.map(r5)} ${result.ways} ways  (queue ${queue.length})`);
    } else if (b[2] - b[0] > MIN_CELL + 1e-9){
      const my = (b[0] + b[2]) / 2, mx = (b[1] + b[3]) / 2;
      queue.push([b[0], b[1], my, mx], [b[0], mx, my, b[3]], [my, b[1], b[2], mx], [my, mx, b[2], b[3]]);
      planned += 3;
      log(`w${id} ⤷ split ${b.map(r5)} into 4 (queue ${queue.length})`);
    } else {
      failed.push(b);
      log(`w${id} ✗✗ gave up on ${b.map(r5)}`);
    }
    await sleep(PAUSE_MS);
  }
}

(async () => {
  log(`tiles needed: ${need.size}, already on disk: ${need.size - queue.length}, to fetch: ${queue.length}`);
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => work(i)));
  fs.writeFileSync(path.join(DIR, "_failed.json"), JSON.stringify(failed), "utf8");
  log(`FINISHED  fetched ${done}, failed ${failed.length}`);
})();

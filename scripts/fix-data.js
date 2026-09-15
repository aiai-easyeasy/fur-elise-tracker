// build/data.orig.js (cleaned CSV) → build/data.js, adding:
//   - documented coordinate corrections
//   - x:1 on stops whose coordinates were checked and are right (the page won't flag them)
//   - w:[days] on stops whose name limits them to certain weekdays (「(週一、週五收運)」)
//   - window.DATA_NOTES for the page's 「關於這份資料」
// Then audits for misplaced stops within same-weekday sequences → build/spikes.json.
// Safe to re-run: always starts again from build/data.orig.js.
const fs = require("fs");
const path = require("path");

const BUILD = path.join(__dirname, "..", "build");
const short = n => n.replace(/^(臺北市|台北市)/, "");

// `bad`, when given, must match or the override is refused (guards against the source changing).
const OVERRIDES = [
  { n: "大安區信義路4段222號前",
    bad: { t: 25.01114, g: 121.53657 }, fix: { t: 25.0329893, g: 121.5528388 },
    why: "OpenStreetMap 門牌「信義路四段222號」，里別同為通安里" },
  { n: "文山區新光路2段74巷22號(週二、週六收運)",
    fix: { t: 24.99040, g: 121.59747 },
    why: "OpenStreetMap 門牌「新光路二段74巷22號」，與同巷 20、23、24 號相鄰" },
  { n: "文山區新光路2段74巷13號(週一、週五收運)",
    fix: { t: 24.98388, g: 121.59487 },
    why: "OpenStreetMap 門牌「新光路二段74巷13號」" },
  { n: "北投區杏林二路口",
    fix: { t: 25.14279, g: 121.49561 },
    why: "OpenStreetMap 上杏林二路的位置（道路層級，約略值）" }
];

// Flagged by the audit but confirmed by an OpenStreetMap address match within 200 m.
const VERIFIED = [
  "內湖區成功路4段317號前10公尺處",       // house node 1 m away: a real out-and-back
  "文山區新光路2段74巷23號(週二、週六收運)",
  "文山區新光路2段74巷20號(週二、週六收運)",
  "文山區萬壽路61巷56號(週一、週五收運)",
  "北投區泉源路39之39號(回收車)"           // house node 190 m away on a mountain road
];

const SPIKE_M = 800;
const COLLECTION_DAYS = [1, 2, 4, 5, 6];      // Taipei: no collection on Wednesday or Sunday
const DAY = { "日":0, "一":1, "二":2, "三":3, "四":4, "五":5, "六":6 };

const load = file => { global.window = {}; eval(fs.readFileSync(file, "utf8")); return window.STOPS; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const uniq = a => [...new Set(a)];

const S = load(path.join(BUILD, "data.orig.js"));
const metaFile = path.join(BUILD, "data.meta.json");
const meta = fs.existsSync(metaFile)
  ? JSON.parse(fs.readFileSync(metaFile, "utf8"))
  : { dropped: [], swapped: [] };

/* ---------- corrections ---------- */
const applied = [];
for (const o of OVERRIDES){
  const rows = S.filter(s => short(s.n) === o.n);
  if (!rows.length){ console.log("NOT FOUND   ", o.n); continue; }
  const was = { t: rows[0].t, g: rows[0].g };
  if (o.bad && !(Math.abs(was.t - o.bad.t) < 1e-7 && Math.abs(was.g - o.bad.g) < 1e-7)){
    console.log("REFUSED     ", o.n, "expected", o.bad, "found", was); continue;
  }
  rows.forEach(s => { s.t = o.fix.t; s.g = o.fix.g; });
  applied.push({ ...o, was });
  console.log(`FIXED        ${o.n}  ${was.t},${was.g} → ${o.fix.t},${o.fix.g}  (${rows.length} row${rows.length > 1 ? "s" : ""})`);
}

/* ---------- confirmed-correct stops ---------- */
let verified = 0;
for (const name of VERIFIED){
  const rows = S.filter(s => short(s.n) === name);
  if (!rows.length) console.log("VERIFY: NOT FOUND", name);
  rows.forEach(s => { s.x = 1; verified++; });
}

/* ---------- weekdays written into the stop name ---------- */
let withDays = 0;
for (const s of S){
  const m = s.n.match(/[（(]([^）)]*(?:週|星期)[^）)]*)[）)]/);
  if (!m) continue;
  let days = uniq([...m[1]].filter(ch => ch in DAY).map(ch => DAY[ch]));
  if (!days.length) continue;
  if (/無收運|不收運|停收/.test(m[1])) days = COLLECTION_DAYS.filter(d => !days.includes(d));
  s.w = days.sort();
  withDays++;
}

/* ---------- notes shown on the page ---------- */
const notes = [];
if (meta.dropped.length){
  const names = uniq(meta.dropped.map(d => short(d.name)));
  notes.push(`已剔除 ${names.length} 個座標無法使用的地點：${names.map(esc).join("、")}。`);
}
if (meta.swapped.length){
  const names = uniq(meta.swapped.map(d => short(d.name)));
  notes.push(`已修正 ${names.length} 個經緯度對調的地點：${names.map(esc).join("、")}。`);
}
if (applied.length){
  notes.push(`已更正 ${applied.length} 個座標明顯錯誤的地點：` +
    applied.map(o => `${esc(o.n)}（原始值 <code>${o.was.t}, ${o.was.g}</code>，改用${esc(o.why)}）`).join("、") + "。");
}
if (withDays){
  notes.push(`有 ${withDays} 個收運點只在特定星期收運（原始資料寫在地點名稱裡）。選到這類點時，路線站序只列同一收運日的站；不是今天收的點會標示「今天不收」。`);
}

fs.writeFileSync(path.join(BUILD, "data.js"),
  "window.STOPS = " + JSON.stringify(S) + ";\n" +
  "window.DATA_NOTES = " + JSON.stringify(notes) + ";", "utf8");

/* ---------- audit: same logic the page uses ---------- */
const hav = (a, b, c, d) => {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
function spikes(stops, honourVerified){
  const by = {};
  stops.forEach(s => (by[s.r + "|" + s.c] ??= []).push(s));
  const found = new Map();
  for (const [k, all] of Object.entries(by)){
    all.sort((a, b) => a.a - b.a);
    // one pass per weekday set present on the route (null = every day)
    const daySets = uniq(all.map(s => s.w ? s.w.join(",") : "")).map(x => x ? x.split(",").map(Number) : null);
    for (const days of daySets){
      const seq = days ? all.filter(s => !s.w || s.w.some(d => days.includes(d))) : all;
      for (let i = 1; i < seq.length - 1; i++){
        const p = seq[i-1], q = seq[i], n = seq[i+1];
        if (honourVerified && q.x) continue;
        const dpq = hav(p.t, p.g, q.t, q.g), dqn = hav(q.t, q.g, n.t, n.g), dpn = hav(p.t, p.g, n.t, n.g);
        if (dpq > SPIKE_M && dqn > SPIKE_M && dpn < 0.5 * Math.min(dpq, dqn))
          found.set(k + "|" + q.n, { route: k, name: q.n, d: q.d, t: q.t, g: q.g,
            prev: { name: p.n, t: p.t, g: p.g }, next: { name: n.n, t: n.t, g: n.g },
            dPrev: Math.round(dpq), dNext: Math.round(dqn), dAcross: Math.round(dpn) });
      }
    }
  }
  return [...found.values()];
}

const after = spikes(S, true);
fs.writeFileSync(path.join(BUILD, "spikes.json"), JSON.stringify(after, null, 1), "utf8");

console.log(`\nstops ${S.length} | corrected ${applied.length} | verified rows ${verified} | weekday-limited ${withDays} | notes ${notes.length}`);
console.log(`suspect stops still flagged: ${after.length}  (→ build/spikes.json)`);
after.forEach(x => console.log(`    ${x.route.padEnd(12)} ${short(x.name)}  前站 ${x.dPrev}m / 後站 ${x.dNext}m / 前後站相距 ${x.dAcross}m`));

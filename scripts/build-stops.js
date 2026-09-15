// CSV → cleaned stops for every Taipei district → build/data.orig.js + build/data.meta.json
// (fix-data.js then applies documented coordinate corrections → build/data.js)
// Usage: node scripts/build-stops.js [path/to/stops.csv]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CSV = process.argv[2] || path.join(ROOT, "data", "taipei-garbage-stops.csv");
const OUT = path.join(ROOT, "build");
const LAT = [24.95, 25.22], LNG = [121.44, 121.68];   // generous Taipei City envelope

function parseCSV(text){
  const rows = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (quoted){
      if (ch === '"' && text[i+1] === '"'){ field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ","){ row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r"){
      if (ch === "\r" && text[i+1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length){ row.push(field); if (row.some(f => f !== "")) rows.push(row); }
  return rows;
}

const text = fs.readFileSync(CSV, "utf8").replace(/^﻿/, "");
const [head, ...body] = parseCSV(text);
const col = name => { const i = head.indexOf(name); if (i < 0) throw new Error("missing column " + name); return i; };
const C = { d:col("行政區"), v:col("里別"), r:col("路線"), c:col("車次"), p:col("車號"),
            a:col("抵達時間"), e:col("離開時間"), n:col("地點"), g:col("經度"), t:col("緯度") };

const inLat = x => x >= LAT[0] && x <= LAT[1];
const inLng = x => x >= LNG[0] && x <= LNG[1];
const validTime = v => Number.isInteger(v) && v >= 0 && v % 100 < 60 && v < 2800;

const out = [], dropped = [], swapped = [], badTime = [];
let overMidnight = 0;

for (const f of body){
  const g = parseFloat(f[C.g]), t = parseFloat(f[C.t]);
  const a = parseInt(f[C.a], 10), e = parseInt(f[C.e], 10);
  const where = { name: f[C.n], district: f[C.d], route: f[C.r], car: f[C.c] };

  if (!validTime(a) || !validTime(e) || e < a){ badTime.push({ ...where, raw: `${f[C.a]}-${f[C.e]}` }); continue; }

  let lng = g, lat = t;
  if (Number.isNaN(g) || Number.isNaN(t)){ dropped.push({ ...where, raw: "空白", why: "blank" }); continue; }
  if (!(inLat(lat) && inLng(lng))){
    if (inLat(lng) && inLng(lat)){ [lat, lng] = [lng, lat]; swapped.push({ ...where, raw: `${f[C.g]}, ${f[C.t]}` }); }
    else { dropped.push({ ...where, raw: `${f[C.g]}, ${f[C.t]}`, why: "outside Taipei" }); continue; }
  }
  if (a >= 2400 || e >= 2400) overMidnight++;

  out.push({ d:f[C.d], v:f[C.v], n:f[C.n], a, e, r:f[C.r], c:f[C.c], p:f[C.p], g:lng, t:lat });
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "data.orig.js"), "window.STOPS = " + JSON.stringify(out) + ";", "utf8");
fs.writeFileSync(path.join(OUT, "data.meta.json"), JSON.stringify({ dropped, swapped, badTime, overMidnight }, null, 1), "utf8");

const byDistrict = {};
out.forEach(s => byDistrict[s.d] = (byDistrict[s.d] || 0) + 1);
const line = x => `    ${x.district} ${x.route} ${x.car} ${x.name}  (${x.raw})`;
console.log("csv            :", path.relative(ROOT, CSV));
console.log("csv rows       :", body.length);
console.log("kept           :", out.length);
console.log("districts      :", Object.keys(byDistrict).length, JSON.stringify(byDistrict));
console.log("routes         :", new Set(out.map(s => s.r + "|" + s.c)).size);
console.log("over midnight  :", overMidnight, "(times ≥ 2400, e.g. 2411 = 00:11 next day)");
console.log("swapped coords :", swapped.length); swapped.forEach(x => console.log(line(x)));
console.log("dropped coords :", dropped.length); dropped.forEach(x => console.log(line(x)));
console.log("bad times      :", badTime.length); badTime.forEach(x => console.log(line(x)));

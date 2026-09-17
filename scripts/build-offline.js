// Assemble the fully offline single-file app → index.html
// src/app.html + vendor/leaflet.* + build/data.js + data/streets.js, all inlined.
// The finished page makes no network request for the map.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dataUri = rel => "data:image/png;base64," + fs.readFileSync(path.join(ROOT, rel)).toString("base64");

const HOME = { lat: 25.03130, lng: 121.55475 };   // 通化街19巷6弄（OSM service way 中點）

for (const rel of ["build/data.js", "data/streets.js"]){
  if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`${rel} not found — see README「重新建置」`);
}
for (const rel of ["assets/icon-180.png", "assets/favicon-32.png"]){
  if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`${rel} not found — see README「重新產生 icon」`);
}

let src = read("src/app.html");

// Function replacements: the inlined files contain "$" sequences that a plain
// string replacement would interpret as match patterns and silently corrupt.
function inject(label, marker, content){
  if (!src.includes(marker)) throw new Error(`marker not found: ${label}`);
  src = src.replace(marker, () => content);
}

// 1. real head + body wrapper (the page source starts at <title>)
// The two small icons are inlined so「加入主畫面」still gets an icon when only
// index.html is copied around (or opened via file://). manifest.webmanifest and
// the larger assets/icon-*.png are separate files — Android needs a real
// manifest URL — and are simply ignored if they aren't deployed alongside.
const HEAD = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="垃圾車在哪">
<meta name="application-name" content="垃圾車在哪">
<meta name="theme-color" content="#B87C08">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="${dataUri("assets/icon-180.png")}">
<link rel="icon" type="image/png" sizes="32x32" href="${dataUri("assets/favicon-32.png")}">
`;
if (!src.startsWith("<title>")) throw new Error("expected src/app.html to start with <title>");
src = HEAD + src;
inject("body", '<div class="app">', '</head>\n<body>\n<div class="app">');

// 2. inline Leaflet, stops and streets, dropping every external script
inject("leaflet.js", '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>',
       "<script>\n" + read("vendor/leaflet.js") + "\n</script>");
inject("data.js", '<script src="data.js"></script>', "<script>\n" + read("build/data.js") + "\n</script>");
inject("streets.js", '<script src="streets.js"></script>', "<script>\n" + read("data/streets.js") + "\n</script>");
inject("leaflet.css", "/*__LEAFLET_CSS__*/", read("vendor/leaflet.css"));

// 3. start position
inject("home lat", "__HOME_LAT__", String(HOME.lat));
inject("home lng", "__HOME_LNG__", String(HOME.lng));

src = src.replace(/<\/script>\s*$/, () => "</script>\n</body>\n</html>\n");

for (const bad of ["__LEAFLET_CSS__", "__HOME_LAT__", "__HOME_LNG__", 'src="data.js"', 'src="streets.js"', "cdnjs.cloudflare.com"]){
  if (src.includes(bad)) throw new Error("unresolved: " + bad);
}

fs.writeFileSync(path.join(ROOT, "index.html"), src, "utf8");
console.log("index.html     :", (Buffer.byteLength(src, "utf8") / 1024).toFixed(0) + " KB");

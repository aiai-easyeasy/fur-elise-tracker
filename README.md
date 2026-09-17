# 垃圾車在哪

臺北市 12 個行政區的垃圾車收運點地圖：依距離列出離你最近的收運點、時刻、路線站序。

**整個 App 就是一個 `index.html`**，街道、路名、收運資料都內建在檔案裡，不需要 API 金鑰，也不連任何地圖伺服器。

> 專案名稱 fur-elise-tracker 取自台灣垃圾車播放的〈給愛麗絲〉（Für Elise）。

## 使用

- **直接開啟**：雙擊 `index.html`。地圖、搜尋、時刻都能用；但多數瀏覽器不會對「用檔案開啟」的頁面提供定位。
- **要用定位**：放到 HTTPS 網址上。最簡單是 GitHub Pages：
  1. GitHub repo → **Settings → Pages**
  2. Source 選 **Deploy from a branch**，分支 `main`、資料夾 `/ (root)`
  3. 稍等後網址會是 `https://aiai-easyeasy.github.io/fur-elise-tracker/`
  4. 手機開啟後 **分享 → 加入主畫面**，用起來就像 App

第一次開啟會詢問位置；允許過之後再開會自動定位，拒絕過則不會再問（可隨時按右下角「定位」）。

## 功能

- 依距離列出最近 20 個收運點；沒定位時，以畫面中心起算，拖動地圖即重算
- 右上角搜尋街名、巷弄或收運點
- 點選收運點：時段、路線／車次／車號，以及完整站序（本站、上一站、下一站）
- 「路線」按鈕在地圖上畫出這台車的行駛順序
- 週三、週日開啟時顯示「今日不收運」
- 只在特定星期收運的點，站序只列同一收運日的站，不是今天收的標示「今天不收」
- 淺色／深色主題跟隨系統

## 資料與授權

| 內容 | 來源 | 授權 |
|---|---|---|
| 收運點 `data/taipei-garbage-stops.csv` | 使用者提供的點位資訊檔（原檔名「點位資訊.csv」） | 依原提供單位規定 |
| 街道與路名 `data/streets.js` | © OpenStreetMap 貢獻者，經 Overpass API 取得後轉換 | [ODbL](https://www.openstreetmap.org/copyright) |
| 地圖元件 `vendor/leaflet.*` | Leaflet 1.9.4，© Vladimir Agafonkin | BSD-2-Clause |

### 資料處理

`scripts/build-stops.js` 與 `scripts/fix-data.js` 會：

- 剔除座標無法使用的地點、修正經緯度對調
- 以 OpenStreetMap 門牌核對並更正明顯錯誤的座標（清單與依據寫在 `fix-data.js` 的 `OVERRIDES`）
- 從地點名稱解析收運星期，例如「(週一、週五收運)」
- 找出「離前後站都很遠、但前後站彼此很近」的可疑座標；經核對確認正確的點列在 `VERIFIED`

所有處理結果都會顯示在頁面底部的「關於這份資料」。

## 重新建置

需要 Node.js 22 以上，不需要安裝任何套件。

**更新收運資料**（替換 `data/taipei-garbage-stops.csv` 後）：

```bash
npm run build
```

**更新街道與路名**（約 20–30 分鐘，會分區、限速地向 Overpass 取資料；中斷後重跑會接續）：

```bash
npm run fetch-streets
npm run build-streets
npm run build
```

**重新產生「加入主畫面」的圖示**（換照片，或第一次取得原始檔時才需要）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1 -Source "C:\path\to\photo.jpg"
npm run build
```

不加 `-Source` 則沿用已提交的 `assets/icon-source.jpg` 重新產生各尺寸。Windows-only（用 `System.Drawing`），產生的 PNG 一併提交，`build-offline.js` 會把小尺寸內嵌進 `index.html`。

```
index.html              成品（建置產生，一併提交以便直接使用與 GitHub Pages）
manifest.webmanifest    PWA 設定（App 名稱、圖示、主題色）
assets/                 App 圖示（來源照片與各尺寸 PNG）
src/app.html            頁面原始碼
vendor/                 Leaflet
data/                   收運點 CSV、街道資料
scripts/                建置腳本
build/                  中間檔與街道原始圖塊（不提交）
```

## 已知限制

- 原始資料**沒有星期欄位**，除了少數寫在地點名稱裡的，無法判斷特定日期是否收運，也分不出一般垃圾／資源回收／廚餘。
- 手機 GPS 在市區誤差約 20–100 公尺，收運點常間隔不到 50 公尺，「最近的點」請當參考。
- 士林區仰德大道4段仁民路口、北投區竹子湖路56之57號位於山區，無法核對座標，頁面上保留「可能有誤」提示。
- 資料為靜態快照，收運路線異動需替換 CSV 後重新建置。

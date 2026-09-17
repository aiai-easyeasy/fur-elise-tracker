<#
  Build the "Add to Home Screen" icons from a source photo.

  Windows-only authoring step, deliberately NOT part of `npm run build`:
  the generated PNGs are committed as artwork (like vendor/leaflet.js),
  and build-offline.js inlines the small ones into index.html.

  ASCII only on purpose - Windows PowerShell 5.1 reads .ps1 as ANSI and
  would mangle UTF-8 text, breaking the parser.

  Usage:
    # import a new source photo (center-cropped to 1024x1024) and render every size
    powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1 -Source "C:\path\to\photo.jpg"

    # re-render from the committed assets/icon-source.jpg
    powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1

  Output (all committed):
    assets/icon-source.jpg          source photo, 1024x1024
    assets/icon-180.png             iOS apple-touch-icon
    assets/icon-192.png             Android manifest
    assets/icon-512.png             Android manifest / splash
    assets/icon-maskable-512.png    Android maskable, content inside the 80% safe zone
    assets/favicon-32.png           browser tab
#>
param(
  [string]$Source = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root   = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root "assets"
$canon  = Join-Path $assets "icon-source.jpg"
$maskBg = [System.Drawing.ColorTranslator]::FromHtml("#B87C08")   # matches <meta name="theme-color">

if (-not (Test-Path $assets)) { New-Item -ItemType Directory -Path $assets | Out-Null }

# Center-crop to a square, then scale to Size x Size.
function Resize-Square {
  param([System.Drawing.Image]$Image, [int]$Size)

  $side = [Math]::Min($Image.Width, $Image.Height)
  $srcX = [int](($Image.Width  - $side) / 2)
  $srcY = [int](($Image.Height - $side) / 2)
  $srcRect = New-Object System.Drawing.Rectangle $srcX, $srcY, $side, $side

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bmp.SetResolution(72, 72)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $dstRect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
  $g.DrawImage($Image, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $bmp
}

function Report {
  param([string]$Path)
  $kb = [Math]::Round((Get-Item $Path).Length / 1KB, 1)
  Write-Host ("  {0,-28} {1,7} KB" -f (Split-Path -Leaf $Path), $kb)
}

function Save-Png {
  param([System.Drawing.Bitmap]$Bitmap, [string]$Path)
  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  Report $Path
}

function Save-Jpeg {
  param([System.Drawing.Bitmap]$Bitmap, [string]$Path, [int]$Quality = 88)
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
           Where-Object { $_.MimeType -eq "image/jpeg" }
  $ps = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
                   [System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)
  $Bitmap.Save($Path, $codec, $ps)
  $ps.Dispose()
  Report $Path
}

# 1. import the source photo
if ($Source -ne "") {
  $Source = (Resolve-Path $Source).Path
  Write-Host "source: $Source"
  $orig = [System.Drawing.Image]::FromFile($Source)
  Write-Host ("  {0} x {1}" -f $orig.Width, $orig.Height)
  $src1024 = Resize-Square -Image $orig -Size 1024
  $orig.Dispose()
  Save-Jpeg -Bitmap $src1024 -Path $canon -Quality 88
  $src1024.Dispose()
}
if (-not (Test-Path $canon)) { throw "missing $canon - pass -Source <photo>" }

# 2. plain square icons
Write-Host "icons:"
$src = [System.Drawing.Image]::FromFile($canon)

foreach ($size in 512, 192, 180, 32) {
  $bmp  = Resize-Square -Image $src -Size $size
  $name = if ($size -eq 32) { "favicon-32.png" } else { "icon-$size.png" }
  Save-Png -Bitmap $bmp -Path (Join-Path $assets $name)
  $bmp.Dispose()
}

# 3. maskable: Android crops to a circle, so keep the photo inside the 80%
#    safe zone and pad with the theme color.
$M     = 512
$inner = [int]($M * 0.80)
$off   = [int](($M - $inner) / 2)

$mask = New-Object System.Drawing.Bitmap $M, $M, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$mask.SetResolution(72, 72)
$g = [System.Drawing.Graphics]::FromImage($mask)
$g.Clear($maskBg)
$g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$innerBmp = Resize-Square -Image $src -Size $inner
$g.DrawImage($innerBmp, $off, $off, $inner, $inner)
$innerBmp.Dispose()
$g.Dispose()
Save-Png -Bitmap $mask -Path (Join-Path $assets "icon-maskable-512.png")
$mask.Dispose()

$src.Dispose()
Write-Host 'done - run "npm run build" to inline the icons into index.html'

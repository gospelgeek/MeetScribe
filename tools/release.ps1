# Prepara una version para publicar en GitHub (repositorio gospelgeek/MeetScribe):
#   dist\meetscribe-<version>.zip  <- la version (se sube como archivo de la Release)
#   dist\meetscribe.zip            <- copia con nombre fijo (la usa el boton de descarga: releases/latest/download)
#   docs\                          <- pagina de GitHub Pages: index.html, icono, imagenes y version.json
#                                     (version.json es lo que consulta la extension para avisar de una version nueva)
# Despues: commit y push de docs\, y  gh release create v<version> dist\*.zip --notes "..."
# oauth.html y privacidad.html (tools\) NO van aqui: siguen en gospelgeek.com.co porque Google tiene
# registrada esa direccion para el inicio de sesion de Drive.
#
# Uso (desde la raiz del proyecto):  powershell -File tools\release.ps1 -Notes "Que cambio"
# (Archivo solo con caracteres ASCII: PowerShell 5.1 lee mal el UTF-8 sin BOM.)

param([string]$Notes = '')
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content "$root\manifest.json" -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
$docs = Join-Path $root 'docs'
$repo = 'https://github.com/gospelgeek/MeetScribe'
New-Item -ItemType Directory -Force $dist | Out-Null
New-Item -ItemType Directory -Force $docs | Out-Null

# Lista blanca: solo los archivos de la extension (por tipo), la licencia y la carpeta de iconos.
# Cualquier otra carpeta o archivo del proyecto (ejemplos, transcripciones, pruebas) queda fuera aunque exista.
$files = @(Get-ChildItem $root -File | Where-Object { ($_.Extension -in '.js', '.html', '.css', '.json', '.md' -and $_.Name -ne 'CONTRIBUTING.md') -or $_.Name -eq 'LICENSE' } | ForEach-Object Name) + 'icons'
$zip = Join-Path $dist "meetscribe-$version.zip"
Remove-Item $zip -ErrorAction SilentlyContinue

# El tar de Windows (bsdtar) guarda las rutas con "/", que es lo que esperan macOS y Linux;
# Compress-Archive las guarda con "\" y rompe la descompresion fuera de Windows.
# Ruta completa: en una terminal con Git, "tar" podria resolverse al GNU tar, que no sirve aqui.
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
& $tar -a -c -f $zip -C $root @files
if ($LASTEXITCODE -ne 0) { throw 'tar.exe fallo al crear el zip' }
Copy-Item $zip (Join-Path $dist 'meetscribe.zip') -Force

# Pagina de descarga e instrucciones (GitHub Pages: https://gospelgeek.github.io/MeetScribe/)
Copy-Item (Join-Path $PSScriptRoot 'index.html') (Join-Path $docs 'index.html') -Force
Copy-Item "$root\icons\icon-128.png" (Join-Path $docs 'icon.png') -Force
# Imagen que se ve al compartir el enlace (se genera con: python tools\make_preview.py)
Copy-Item (Join-Path $PSScriptRoot 'preview.jpg') (Join-Path $docs 'preview.jpg') -Force
Copy-Item (Join-Path $PSScriptRoot 'nequi.png') (Join-Path $docs 'nequi.png') -Force

$json = [ordered]@{
  version  = $version
  date     = (Get-Date -Format 'yyyy-MM-dd')
  download = "$repo/releases/download/v$version/meetscribe-$version.zip"
  notes    = $Notes
} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $docs 'version.json'), $json, (New-Object Text.UTF8Encoding($false)))

Write-Host "Version $version lista: zips en $dist y pagina en $docs"
Get-ChildItem $dist, $docs -File | Select-Object Name, Length | Format-Table -AutoSize

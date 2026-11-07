# Copies the mod and the layout into the Herdr home, then switches to it.
#
# A copy, not a junction or a symlink. Linking looks better -- the app
# hot-reloads as you edit -- and the JavaScript really does load through it,
# so the panels come up and nothing reports an error. But every
# svg("mods/personal-cockpit/...") then resolves to a path outside the Herdr
# home and silently draws nothing: the refresh, gear, dock and minimise buttons
# all vanish from the headers. Verified by A/B on 0.1.13.
#
#   -NoSwitch   install without changing the shown layout
#   -NoLayout   install the mod only, leaving layouts/cockpit.json alone

[CmdletBinding()]
param([switch]$NoSwitch, [switch]$NoLayout)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$herdr = Join-Path $env:USERPROFILE '.config\herdr-app'
$name = 'personal-cockpit'

if (-not (Test-Path $herdr)) { throw "No Herdr home at $herdr -- start the app once first." }

$src = Join-Path $root "mods\$name"
$dst = Join-Path $herdr "mods\$name"

# A previous link install has to go before a copy can land. rmdir drops the
# junction itself; Remove-Item -Recurse would follow it into the repo and
# delete the source.
if (Test-Path $dst) {
  if ((Get-Item $dst).LinkType) { cmd /c rmdir "$dst" | Out-Null }
}

# /MIR so a file deleted here is deleted there; the two the app writes into the
# mod folder are left alone, since they belong to the installed version.
robocopy $src $dst /MIR /XF gpui-kit.d.ts jsconfig.json /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with $LASTEXITCODE" }
Write-Host "mod      -> $dst"

if (-not $NoLayout) {
  Copy-Item (Join-Path $root 'layouts\cockpit.json') (Join-Path $herdr 'layouts\cockpit.json') -Force
  Write-Host "layout   -> $herdr\layouts\cockpit.json"
}

$app = Get-Command herdr-app -ErrorAction SilentlyContinue
if (-not $app) {
  $guess = Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe'
  if (Test-Path $guess) { $app = $guess }
}
if (-not $app) { Write-Host "herdr-app not found; switch the layout yourself."; return }

& $app check $dst
if (-not $NoSwitch) { & $app do layout.switch --name cockpit | Out-Null; Write-Host "layout   -> switched to cockpit" }

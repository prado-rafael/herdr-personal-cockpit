# A throwaway Herdr home with this mod installed on made-up data.
#
# What it is for: seeing all four panels full, and shooting them. A screenshot
# of a panel used to be a picture of whoever's queue was open at the time --
# neither reproducible nor publishable. Here every panel is full, of a company
# that does not exist, with no login and no network involved.
#
# `check` is run here too, but demo mode does not change what it renders: check
# draws once and does not wait on a load, so the panel in it is empty either
# way. `sandbox.ps1 kit` is the screen that shows every row and header state,
# because the gallery holds its data instead of fetching it.
#
#   .\tools\sandbox.ps1 start        build the home, install into it, write the
#                                    demo data, and check the result
#   .\tools\sandbox.ps1 check        herdr-app check on the installed mod
#   .\tools\sandbox.ps1 refresh      rewrite the demo data (fresh ages) and reload
#   .\tools\sandbox.ps1 kit          open the chrome gallery in that window
#   .\tools\sandbox.ps1 light        switch that window's theme
#   .\tools\sandbox.ps1 dark
#   .\tools\sandbox.ps1 shot [dir]   a screenshot in each theme, into dir
#   .\tools\sandbox.ps1 env          the variables to drive it yourself
#   .\tools\sandbox.ps1 stop         delete the home
#
# It never touches the real one: everything is under $env:COCKPIT_SANDBOX, and
# every herdr-app call is prefixed with that HERDR_APP_HOME. Opening a *window*
# on it is the one thing this cannot do for you -- `herdr-app` talks to an app
# that is already running, and which command starts a second one depends on how
# Herdr was installed. `start` prints what to run.

[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = 'start',
  [Parameter(Position = 1)][string]$Out
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$box = if ($env:COCKPIT_SANDBOX) { $env:COCKPIT_SANDBOX } else { Join-Path $env:TEMP 'personal-cockpit-sandbox' }
$box = $box.TrimEnd('\', '/')
$mod = Join-Path $box 'mods\personal-cockpit'

function Get-App {
  $found = Get-Command herdr-app -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  $guess = Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe'
  if (Test-Path $guess) { return $guess }
  return $null
}

# Every call carries the sandbox home, so none of them can reach the real one.
function Invoke-App {
  param([string[]]$Arguments)
  $app = Get-App
  if (-not $app) { throw 'herdr-app not found.' }
  $was = $env:HERDR_APP_HOME
  $env:HERDR_APP_HOME = $box
  try { & $app @Arguments } finally { $env:HERDR_APP_HOME = $was }
}

function Test-Window {
  if (-not (Get-App)) { return $false }
  # The socket first: with no window there is nothing listening, and asking
  # herdr-app anyway prints a connection error that reads like a fault when it
  # is the ordinary case. `$?` is no use after a pipe to Out-Null -- it reports
  # on Out-Null, not on the program -- so the exit code is what decides.
  if (-not (Test-Path (Join-Path $box 'herdr-app.sock'))) { return $false }
  try { Invoke-App @('status') | Out-Null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

function Assert-Window {
  if (-not (Test-Window)) { throw "No window on this home. See: .\tools\sandbox.ps1 env" }
}

# The demo answers, with the ages measured from now: a file written last March
# would draw a queue where nothing has moved in months.
function Write-Demo {
  & node (Join-Path $root 'tools\demo.mjs') (Join-Path $box 'personal-cockpit-demo.json') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'tools/demo.mjs failed' }
  # The two config files the panels read from the installed folder. The
  # installer seeds these from the examples, so they are written after it.
  Copy-Item (Join-Path $root 'tools\demo\routines.yml') (Join-Path $mod 'routines.yml') -Force
  Copy-Item (Join-Path $root 'tools\demo\team.yml') (Join-Path $mod 'team.yml') -Force
  # Which repo the Kraken Tasks panel watches. Without this it asks for one,
  # which is a state worth seeing but not the one you came for.
  $shared = @'
{
  "cockpit.issues.repo": "acme/tasks",
  "cockpit.issues.recent": ["acme/tasks", "acme/app"]
}
'@
  Set-Content -Path (Join-Path $box 'shared.json') -Value $shared -Encoding utf8
  Write-Host "demo     -> $(Join-Path $box 'personal-cockpit-demo.json')"
}

switch ($Command) {
  'start' {
    New-Item -ItemType Directory -Force (Join-Path $box 'layouts') | Out-Null
    New-Item -ItemType Directory -Force (Join-Path $box 'mods') | Out-Null
    Write-Host "home     -> $box"

    $was = $env:HERDR_APP_HOME
    $env:HERDR_APP_HOME = $box
    try { & (Join-Path $root 'tools\install.ps1') -NoSwitch } finally { $env:HERDR_APP_HOME = $was }

    Write-Demo
    if (Get-App) {
      Invoke-App @('check', $mod)
      Write-Host 'check    -> passed'
    } else {
      Write-Host 'check    -> skipped: herdr-app is not on the PATH'
    }
    if (-not (Test-Window)) {
      Write-Host ''
      Write-Host 'No window on this home yet. Start Herdr against it, however you launch it:'
      Write-Host "  `$env:HERDR_APP_HOME = '$box'; <your herdr app command>"
      Write-Host 'then: .\tools\sandbox.ps1 kit | shot | light | dark'
    }
  }

  'check' {
    Invoke-App @('check', $mod)
    Write-Host 'check    -> passed'
  }

  'refresh' {
    if (-not (Test-Path $mod)) { throw "No sandbox at $box -- run start first." }
    Write-Demo
    # The panels re-read the demo file on their next call, so this is only for
    # seeing it now rather than within a poll.
    if (Test-Window) { Invoke-App @('do', 'personal-cockpit.refresh') | Out-Null }
  }

  'kit' {
    Assert-Window
    Invoke-App @('do', 'personal-cockpit.kit') | Out-Null
    Write-Host 'gallery  -> opened'
  }

  { $_ -in 'light', 'dark' } {
    Assert-Window
    Invoke-App @('do', 'app.theme', '--name', $Command) | Out-Null
    Write-Host "theme    -> $Command"
  }

  'shot' {
    Assert-Window
    $dir = if ($Out) { $Out } else { Join-Path $box 'shots' }
    New-Item -ItemType Directory -Force $dir | Out-Null
    # A window behind others does not repaint, and `shot` then returns its last
    # frame: bring it to the front before trusting these.
    foreach ($theme in @('light', 'dark')) {
      Invoke-App @('do', 'app.theme', '--name', $theme) | Out-Null
      $file = Join-Path $dir "$theme.png"
      Invoke-App @('shot', $file) | Out-Null
      Write-Host "shot     -> $file"
    }
  }

  'env' {
    Write-Host "`$env:HERDR_APP_HOME = '$box'"
    Write-Host "# e.g. `$env:HERDR_APP_HOME = '$box'; herdr-app status"
  }

  'stop' {
    # Only ever the sandbox: $box comes from COCKPIT_SANDBOX or TEMP, and a real
    # Herdr home is never either.
    if ($box -notmatch 'personal-cockpit-sandbox') {
      throw "refusing to delete $box : it is not a sandbox path."
    }
    if (Test-Path $box) { Remove-Item -Recurse -Force $box }
    Write-Host "removed  -> $box"
  }

  default { throw "unknown command: $Command" }
}

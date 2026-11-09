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
#   .\tools\sandbox.ps1 start        build the home, install into it (which runs
#                                    check), write the demo data, open the window
#   .\tools\sandbox.ps1 window       open a second Herdr window on this home
#   .\tools\sandbox.ps1 check        herdr-app check on the installed mod
#   .\tools\sandbox.ps1 refresh      rewrite the demo data (fresh ages) and reload
#   .\tools\sandbox.ps1 kit          open the chrome gallery in that window
#   .\tools\sandbox.ps1 light        reopen the window light or dark
#   .\tools\sandbox.ps1 dark
#   .\tools\sandbox.ps1 shot [dir]   a screenshot of it, into dir
#   .\tools\sandbox.ps1 env          the variables to drive it yourself
#   .\tools\sandbox.ps1 stop         close the window and delete the home
#
# It never touches the real one: everything is under $env:COCKPIT_SANDBOX, and
# every herdr-app call is prefixed with that HERDR_APP_HOME. That includes the
# window -- `herdr-app` with no arguments opens one, and the home it opens on is
# the one in the environment -- so the sandbox window and the person's own are
# two windows that cannot see each other's layout, mods or shared state.

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

# UTF-8 with no byte-order mark.
#
# `Set-Content -Encoding utf8` writes one in PowerShell 5.1, and a strict JSON
# reader takes the BOM as the first character of the document and rejects the
# file. Herdr then falls back to its defaults without saying anything, which is
# how a seeded `shared.json` and a written `settings.json` both did nothing at
# all: the repo was never watched and the appearance never changed.
function Write-Json([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))
}

function Get-App {
  $found = Get-Command herdr-app -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  $guess = Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe'
  if (Test-Path $guess) { return $guess }
  return $null
}

# Every call carries the sandbox home, so none of them can reach the real one.
#
# Start-Process -Wait rather than the call operator, and this is the whole
# reason: herdr-app is a GUI-subsystem binary, so PowerShell starts it and
# carries straight on without waiting and without ever setting $LASTEXITCODE.
# A failing `check` was therefore followed by the line saying it passed, and its
# output arrived whenever it felt like it. -PassThru is the only way to read an
# exit code here.
#
# The arguments are quoted by hand because -ArgumentList does not quote one
# holding a space, and a sandbox under a path like "C:\Users\First Last\" is
# exactly that: the path reaches herdr-app split in two.
function Quoted([string[]]$parts) {
  ($parts | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
}

function Invoke-App {
  param([string[]]$Arguments, [switch]$Quiet)
  $app = Get-App
  if (-not $app) { throw 'herdr-app not found.' }

  $out = [System.IO.Path]::GetTempFileName()
  $err = [System.IO.Path]::GetTempFileName()
  $was = $env:HERDR_APP_HOME
  $env:HERDR_APP_HOME = $box
  try {
    $ran = Start-Process -FilePath $app -ArgumentList (Quoted $Arguments) -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput $out -RedirectStandardError $err
    $said = (Get-Content $out -Raw -ErrorAction SilentlyContinue)
    $complained = (Get-Content $err -Raw -ErrorAction SilentlyContinue)
    if ($ran.ExitCode -ne 0) {
      throw "herdr-app $($Arguments -join ' ') exited $($ran.ExitCode): $(($complained, $said -join ' ').Trim())"
    }
    if (-not $Quiet -and $said) { Write-Host $said.TrimEnd() }
  } finally {
    $env:HERDR_APP_HOME = $was
    Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
  }
}

function Test-Window {
  if (-not (Get-App)) { return $false }
  # The socket first: with no window there is nothing listening, and asking
  # herdr-app anyway prints a connection error that reads like a fault when it
  # is the ordinary case.
  if (-not (Test-Path (Join-Path $box 'herdr-app.sock'))) { return $false }
  # Invoke-App throws on a non-zero exit, so there is nothing to read a code
  # from here: either it answered or it did not.
  try { Invoke-App @('status') -Quiet; return $true } catch { return $false }
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
  # frame.welcomed: a home that has never had a window shows the welcome over
  # everything, which is every screenshot ruined.
  $shared = @'
{
  "frame.welcomed": "finished",
  "cockpit.issues.repo": "acme/tasks",
  "cockpit.issues.recent": ["acme/tasks", "acme/app"]
}
'@
  Write-Json (Join-Path $box 'shared.json') $shared
  Write-Host "demo     -> $(Join-Path $box 'personal-cockpit-demo.json')"
}

# A second Herdr window, on this home. `herdr-app` with no arguments opens one,
# and HERDR_APP_HOME decides which home it opens on -- so this window and the
# person's own share nothing but herdr-core, whose terminals belong to them.
function Open-Window {
  $app = Get-App
  if (-not $app) { throw 'herdr-app not found.' }
  if (Test-Window) { Write-Host 'window   -> already open'; return }

  $was = $env:HERDR_APP_HOME
  $env:HERDR_APP_HOME = $box
  try { Start-Process -FilePath $app | Out-Null } finally { $env:HERDR_APP_HOME = $was }

  # It has to be listening before `shot` or `do` mean anything.
  foreach ($try in 1..40) {
    Start-Sleep -Milliseconds 250
    if (Test-Window) { Write-Host 'window   -> open'; return }
  }
  throw "gave up waiting for $(Join-Path $box 'herdr-app.sock')"
}

switch ($Command) {
  'window' { Open-Window }

  'start' {
    New-Item -ItemType Directory -Force (Join-Path $box 'layouts') | Out-Null
    New-Item -ItemType Directory -Force (Join-Path $box 'mods') | Out-Null
    Write-Host "home     -> $box"

    $was = $env:HERDR_APP_HOME
    $env:HERDR_APP_HOME = $box
    try { & (Join-Path $root 'tools\install.ps1') -NoSwitch } finally { $env:HERDR_APP_HOME = $was }

    # No check of our own: install.ps1 has just run one on what it installed,
    # and a second would print the same line again. `sandbox.ps1 check` is for
    # re-running it after an edit.
    Write-Demo
    Open-Window
    # Switched after the window is up: the layout is chosen per home, and a home
    # that has never had a window open has nowhere for the choice to land.
    Invoke-App @('do', 'layout.switch', '--name', 'cockpit') -Quiet
    Write-Host 'layout   -> cockpit'
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
    if (Test-Window) { Invoke-App @('do', 'personal-cockpit.refresh') -Quiet }
  }

  'kit' {
    Assert-Window
    Invoke-App @('do', 'personal-cockpit.kit') -Quiet
    Write-Host 'gallery  -> opened'
  }

  { $_ -in 'light', 'dark' } {
    # Light and dark are `appearance` in settings.json, not a theme: there is
    # no command for it (`app.theme` takes a theme file), so the file is written
    # and the window reopened on it.
    Write-Json (Join-Path $box 'settings.json') "{ `"appearance`": `"$Command`" }"
    if (Test-Window) {
      try { Invoke-App @('do', 'window.close') -Quiet } catch {}
      Start-Sleep -Milliseconds 1200
    }
    Open-Window
    Invoke-App @('do', 'layout.switch', '--name', 'cockpit') -Quiet
    Write-Host "appearance -> $Command"
  }

  'shot' {
    Assert-Window
    $dir = if ($Out) { $Out } else { Join-Path $box 'shots' }
    New-Item -ItemType Directory -Force $dir | Out-Null
    $file = Join-Path $dir 'shot.png'
    # A window behind others does not repaint, and `shot` then returns its last
    # frame: bring it to the front before trusting this. `sandbox light|dark`
    # reopens the window, which brings it forward on the way.
    Invoke-App @('shot', $file) -Quiet
    Write-Host "shot     -> $file"
  }

  'env' {
    Write-Host "`$env:HERDR_APP_HOME = '$box'"
    Write-Host "# e.g. `$env:HERDR_APP_HOME = '$box'; herdr-app status"
  }

  'stop' {
    # The window first: it would otherwise be left pointing at a home that is
    # no longer there.
    if (Test-Window) {
      try { Invoke-App @('do', 'window.close') -Quiet; Write-Host 'window   -> closed'; Start-Sleep -Milliseconds 800 } catch {}
    }
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

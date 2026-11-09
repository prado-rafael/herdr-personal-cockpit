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
#                                    check), and write the demo data
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
#
# Start-Process -Wait rather than the call operator, and this is the whole
# reason: herdr-app is a GUI-subsystem binary, so PowerShell starts it and
# carries straight on without waiting and without ever setting $LASTEXITCODE.
# A failing `check` was therefore followed by the line saying it passed, and its
# output arrived whenever it felt like it. -PassThru is the only way to read an
# exit code here.
function Invoke-App {
  param([string[]]$Arguments, [switch]$Quiet)
  $app = Get-App
  if (-not $app) { throw 'herdr-app not found.' }

  $out = [System.IO.Path]::GetTempFileName()
  $err = [System.IO.Path]::GetTempFileName()
  $was = $env:HERDR_APP_HOME
  $env:HERDR_APP_HOME = $box
  try {
    $ran = Start-Process -FilePath $app -ArgumentList $Arguments -NoNewWindow -Wait -PassThru `
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

    # No check of our own: install.ps1 has just run one on what it installed,
    # and a second would print the same line again. `sandbox.ps1 check` is for
    # re-running it after an edit.
    Write-Demo
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
    if (Test-Window) { Invoke-App @('do', 'personal-cockpit.refresh') -Quiet }
  }

  'kit' {
    Assert-Window
    Invoke-App @('do', 'personal-cockpit.kit') -Quiet
    Write-Host 'gallery  -> opened'
  }

  { $_ -in 'light', 'dark' } {
    Assert-Window
    Invoke-App @('do', 'app.theme', '--name', $Command) -Quiet
    Write-Host "theme    -> $Command"
  }

  'shot' {
    Assert-Window
    $dir = if ($Out) { $Out } else { Join-Path $box 'shots' }
    New-Item -ItemType Directory -Force $dir | Out-Null
    # A window behind others does not repaint, and `shot` then returns its last
    # frame: bring it to the front before trusting these.
    foreach ($theme in @('light', 'dark')) {
      Invoke-App @('do', 'app.theme', '--name', $theme) -Quiet
      $file = Join-Path $dir "$theme.png"
      Invoke-App @('shot', $file) -Quiet
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

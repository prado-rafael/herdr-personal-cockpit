# Prints the github.com credential Git Credential Manager already holds, as
# `key=value` lines on stdout. The issues panel parses the `password=` line.
#
# This script exists because herdr's exec() cannot supply stdin, while
# `git credential fill` reads its query from stdin. The query is handed over as
# a file redirect through cmd: on this machine neither piping into a native
# command from PowerShell nor writing raw bytes to a redirected
# StandardInput via System.Diagnostics.Process reaches git -- both make it
# report "refusing to work with credential missing protocol field".
$ErrorActionPreference = 'Stop'

$query = [System.IO.Path]::GetTempFileName()
try {
  # Exact bytes: LF line endings and the trailing blank line git expects.
  [System.IO.File]::WriteAllBytes(
    $query,
    [System.Text.Encoding]::ASCII.GetBytes("protocol=https`nhost=github.com`n`n"))

  # Keep a missing credential a fast failure rather than a GUI prompt nobody
  # is watching: the panel needs an error it can draw, not a blocked exec.
  & cmd /c "set GIT_TERMINAL_PROMPT=0&& set GCM_INTERACTIVE=never&& git credential fill < `"$query`""
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $query -Force -ErrorAction SilentlyContinue
}

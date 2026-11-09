#!/bin/sh
# A throwaway Herdr home with this mod installed on made-up data.
#
# What it is for: seeing all four panels full, and shooting them. A screenshot
# of a panel used to be a picture of whoever's queue was open at the time --
# neither reproducible nor publishable. Here every panel is full, of a company
# that does not exist, with no login and no network involved.
#
# `check` is run here too, but demo mode does not change what it renders: check
# draws once and does not wait on a load, so the panel in it is empty either
# way. `sandbox.sh kit` is the screen that shows every row and header state,
# because the gallery holds its data instead of fetching it.
#
#   sh tools/sandbox.sh start      build the home, install into it (which runs
#                                  check), and write the demo data
#   sh tools/sandbox.sh check      herdr-app check on the installed mod
#   sh tools/sandbox.sh refresh    rewrite the demo data (fresh ages) and reload
#   sh tools/sandbox.sh kit        open the chrome gallery in that window
#   sh tools/sandbox.sh light      switch that window's theme
#   sh tools/sandbox.sh dark
#   sh tools/sandbox.sh shot [dir] a screenshot in each theme, into dir
#   sh tools/sandbox.sh env        the variables to drive it yourself
#   sh tools/sandbox.sh stop       delete the home
#
# It never touches the real one: everything is under $COCKPIT_SANDBOX, and every
# herdr-app call is prefixed with that HERDR_APP_HOME. Opening a *window* on it
# is the one thing this cannot do for you -- `herdr-app` talks to an app that is
# already running, and which command starts a second one depends on how Herdr
# was installed. `start` prints what to run.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=${TMPDIR:-/tmp}
box=${COCKPIT_SANDBOX:-${tmp%/}/personal-cockpit-sandbox}
box=${box%/}
mod=$box/mods/personal-cockpit

app() { HERDR_APP_HOME="$box" herdr-app "$@"; }
have_app() { command -v herdr-app >/dev/null 2>&1; }
# The socket first: with no window there is nothing listening, and asking
# herdr-app anyway prints a connection error that reads like a fault when it is
# the ordinary case.
running() { have_app && [ -e "$box/herdr-app.sock" ] && app status >/dev/null 2>&1; }

# The demo answers, with the ages measured from now: a file written last March
# would draw a queue where nothing has moved in months.
write_demo() {
  node "$root/tools/demo.mjs" "$box/personal-cockpit-demo.json" >/dev/null
  # The two config files the panels read from the installed folder. The
  # installer seeds these from the examples, so they are written after it.
  cp -- "$root/tools/demo/routines.yml" "$mod/routines.yml"
  cp -- "$root/tools/demo/team.yml" "$mod/team.yml"
  # Which repo the Kraken Tasks panel watches. Without this it asks for one,
  # which is a state worth seeing but not the one you came for.
  cat >"$box/shared.json" <<'JSON'
{
  "cockpit.issues.repo": "acme/tasks",
  "cockpit.issues.recent": ["acme/tasks", "acme/app"]
}
JSON
  echo "demo     -> $box/personal-cockpit-demo.json"
}

case ${1:-start} in
  start)
    mkdir -p -- "$box/layouts" "$box/mods"
    echo "home     -> $box"
    HERDR_APP_HOME="$box" sh "$root/tools/install.sh" --no-switch
    # No check of our own: install.sh has just run one on what it installed, and
    # a second would print the same line again. `sandbox.sh check` is for
    # re-running it after an edit.
    write_demo
    if ! running; then
      echo
      echo "No window on this home yet. Start Herdr against it, however you launch it:"
      echo "  HERDR_APP_HOME=$box <your herdr app command>"
      echo "then: sh tools/sandbox.sh kit | shot | light | dark"
    fi
    ;;

  check)
    have_app || { echo "herdr-app is not on the PATH." >&2; exit 1; }
    app check "$mod"
    echo "check    -> passed"
    ;;

  refresh)
    [ -d "$mod" ] || { echo "No sandbox at $box -- run start first." >&2; exit 1; }
    write_demo
    # The panels re-read the demo file on their next call, so this is only for
    # seeing it now rather than within a poll.
    running && app do personal-cockpit.refresh >/dev/null || true
    ;;

  kit)
    running || { echo "No window on this home. See: sh tools/sandbox.sh env" >&2; exit 1; }
    app do personal-cockpit.kit >/dev/null
    echo "gallery  -> opened"
    ;;

  light|dark)
    running || { echo "No window on this home. See: sh tools/sandbox.sh env" >&2; exit 1; }
    app do app.theme --name "$1" >/dev/null
    echo "theme    -> $1"
    ;;

  shot)
    running || { echo "No window on this home. See: sh tools/sandbox.sh env" >&2; exit 1; }
    out=${2:-$box/shots}
    mkdir -p -- "$out"
    # A window behind others does not repaint, and `shot` then returns its last
    # frame: bring it to the front before trusting these.
    for theme in light dark; do
      app do app.theme --name "$theme" >/dev/null
      app shot "$out/$theme.png" >/dev/null
      echo "shot     -> $out/$theme.png"
    done
    ;;

  env)
    echo "HERDR_APP_HOME=$box"
    echo "# e.g. HERDR_APP_HOME=$box herdr-app status"
    ;;

  stop)
    # Only ever the sandbox: $box is built from COCKPIT_SANDBOX or TMPDIR, and
    # a real Herdr home is never either.
    case $box in
      */personal-cockpit-sandbox|*/personal-cockpit-sandbox/*) rm -rf -- "$box"; echo "removed  -> $box" ;;
      *) echo "refusing to delete $box: it is not a sandbox path." >&2; exit 1 ;;
    esac
    ;;

  *)
    echo "unknown command: $1" >&2
    exit 2
    ;;
esac

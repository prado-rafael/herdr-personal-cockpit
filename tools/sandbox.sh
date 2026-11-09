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
#                                  check), write the demo data, open the window
#   sh tools/sandbox.sh window     open a second Herdr window on this home
#   sh tools/sandbox.sh check      herdr-app check on the installed mod
#   sh tools/sandbox.sh refresh    rewrite the demo data (fresh ages) and reload
#   sh tools/sandbox.sh kit        open the chrome gallery in that window
#   sh tools/sandbox.sh light      reopen the window light or dark
#   sh tools/sandbox.sh dark
#   sh tools/sandbox.sh shot [dir] a screenshot of it, into dir
#   sh tools/sandbox.sh env        the variables to drive it yourself
#   sh tools/sandbox.sh stop       close the window and delete the home
#
# It never touches the real one: everything is under $COCKPIT_SANDBOX, and every
# herdr-app call is prefixed with that HERDR_APP_HOME. That includes the window
# -- `herdr-app` with no arguments opens one, and the home it opens on is the
# one in the environment -- so the sandbox window and the person's own are two
# windows that cannot see each other's layout, mods or shared state.

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
  # frame.welcomed: a home that has never had a window shows the welcome over
  # everything, which is every screenshot ruined.
  cat >"$box/shared.json" <<'JSON'
{
  "frame.welcomed": "finished",
  "cockpit.issues.repo": "acme/tasks",
  "cockpit.issues.recent": ["acme/tasks", "acme/app"]
}
JSON
  echo "demo     -> $box/personal-cockpit-demo.json"
}

# A second Herdr window, on this home. `herdr-app` with no arguments opens one,
# and HERDR_APP_HOME decides which home it opens on -- so this window and the
# person's own share nothing but herdr-core, whose terminals belong to them.
open_window() {
  have_app || { echo "herdr-app is not on the PATH." >&2; return 1; }
  running && { echo "window   -> already open"; return 0; }
  HERDR_APP_HOME="$box" herdr-app >/dev/null 2>&1 &
  # It has to be listening before `shot` or `do` mean anything.
  n=0
  while [ "$n" -lt 40 ]; do
    running && { echo "window   -> open"; return 0; }
    n=$((n + 1))
    sleep 0.25
  done
  echo "window   -> gave up waiting for $box/herdr-app.sock" >&2
  return 1
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
    open_window
    # Switched after the window is up: the layout is chosen per home, and a home
    # that has never had a window open has nowhere for the choice to land.
    running && app do layout.switch --name cockpit >/dev/null && echo "layout   -> cockpit"
    ;;

  window)
    open_window
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
    # Light and dark are `appearance` in settings.json, not a theme: there is no
    # command for it (`app.theme` takes a theme file), so the file is written and
    # the window reopened on it.
    printf '{ "appearance": "%s" }\n' "$1" >"$box/settings.json"
    running && app do window.close >/dev/null 2>&1 && sleep 1.2
    open_window
    app do layout.switch --name cockpit >/dev/null
    echo "appearance -> $1"
    ;;

  shot)
    running || { echo "No window on this home. See: sh tools/sandbox.sh env" >&2; exit 1; }
    out=${2:-$box/shots}
    mkdir -p -- "$out"
    # A window behind others does not repaint, and `shot` then returns its last
    # frame: bring it to the front before trusting this. `sandbox.sh light|dark`
    # reopens the window, which brings it forward on the way.
    app shot "$out/shot.png" >/dev/null
    echo "shot     -> $out/shot.png"
    ;;

  env)
    echo "HERDR_APP_HOME=$box"
    echo "# e.g. HERDR_APP_HOME=$box herdr-app status"
    ;;

  stop)
    # The window first: it would otherwise be left pointing at a home that is
    # no longer there.
    running && app do window.close >/dev/null 2>&1 && echo "window   -> closed"
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

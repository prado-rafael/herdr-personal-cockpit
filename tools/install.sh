#!/bin/sh
# Copies the mod and the layout into the Herdr home, then switches to it.
#
# A copy, not a symlink. Linking looks better -- the app hot-reloads as you
# edit -- and the JavaScript really does load through it, so the panels come up
# and nothing reports an error. But every svg("mods/personal-cockpit/...") then
# resolves to a path outside the Herdr home and silently draws nothing: the
# refresh, gear, dock and minimise buttons all vanish from the headers.
# Verified by A/B on Windows 0.1.13; assumed to hold here, so copy.
#
#   --no-switch   install without changing the shown layout
#   --no-layout   install the mod only, leaving layouts/cockpit.json alone

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
herdr=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
name=personal-cockpit

switch=1
layout=1
for arg in "$@"; do
  case $arg in
    --no-switch) switch=0 ;;
    --no-layout) layout=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

[ -d "$herdr" ] || { echo "No Herdr home at $herdr -- start the app once first." >&2; exit 1; }

dst=$herdr/mods/$name

# routines.yml belongs to the person, not to the install: it is their schedule,
# edited in place so a new routine never means reinstalling. The copy below
# wipes the folder, so it is stashed across that and put back.
keep=""
if [ -f "$dst/routines.yml" ]; then
  keep=$(mktemp)
  cp -- "$dst/routines.yml" "$keep"
fi

# A previous symlink install has to go before a copy can land. Removing the
# link itself, never what it points at.
[ -L "$dst" ] && rm -- "$dst"
rm -rf -- "$dst"
mkdir -p -- "$dst"

for f in "$root/mods/$name"/*; do
  case $(basename -- "$f") in
    gpui-kit.d.ts|jsconfig.json) continue ;;   # the app writes these itself
    routines.yml) continue ;;                  # the person's, restored below
  esac
  cp -- "$f" "$dst/"
done
echo "mod      -> $dst"

if [ -n "$keep" ]; then
  cp -- "$keep" "$dst/routines.yml"
  rm -f -- "$keep"
  echo "routines -> kept $dst/routines.yml"
elif [ -f "$dst/routines.example.yml" ]; then
  cp -- "$dst/routines.example.yml" "$dst/routines.yml"
  echo "routines -> $dst/routines.yml (from the example)"
fi

if [ "$layout" -eq 1 ]; then
  # The .json and the .svg its "preview" field points at; the Settings picker
  # draws a blank frame without the second one.
  for ext in json svg; do
    if [ -f "$root/layouts/cockpit.$ext" ]; then
      cp -- "$root/layouts/cockpit.$ext" "$herdr/layouts/cockpit.$ext"
      echo "layout   -> $herdr/layouts/cockpit.$ext"
    fi
  done
fi

command -v herdr-app >/dev/null 2>&1 || { echo "herdr-app not found; switch the layout yourself."; exit 0; }
herdr-app check "$dst"
if [ "$switch" -eq 1 ]; then
  herdr-app do layout.switch --name cockpit >/dev/null
  echo "layout   -> switched to cockpit"
fi

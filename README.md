# Personal Cockpit

Panels for the [Herdr](https://herdr.dev) desktop app: what needs me, in the
sidebar, next to the agents doing the work.

![Personal Cockpit](preview.png)

| Panel | What it shows |
|---|---|
| **Pull requests** | Your open PRs across every repo you can read: build state, approvals, conflicts, unresolved threads, diff size. Grouped into Needs you / Ready to merge / Waiting / Drafts. |
| **Kraken Tasks** | The open issues of one coordination repo you choose — a [kraken](https://github.com/rafael-adcp/kraken) task queue. Grouped into Needs you / Queue, with the issues' own GitHub labels. |

Both keep their last good list when a refresh fails, minimise to their own
header bar, move to a column on the right, and drop to an icon-and-count rail
when the sidebar is dragged narrow.

`RECIPE.md` is the brief this was built from — read that to rebuild or change
it, and keep it current when you do. The files here are one build of it.

## Requirements

- Herdr 0.1.13 or newer.
- The [GitHub CLI](https://cli.github.com), signed in: `gh auth login`. It is
  the only way in — there is no token to configure. On Windows it does not need
  to be on your PATH; the known install paths are tried too.

## Install

From a clone of this repo. **Copy the mod folder — do not link it.**

```powershell
.\tools\install.ps1          # Windows
```

```sh
./tools/install.sh           # macOS, Linux
```

Either one copies `mods/personal-cockpit` and `layouts/cockpit.json` into
`~/.config/herdr-app` and switches to the layout. `ctrl-shift-l` cycles back to
your own, and `ctrl-alt-shift-escape` always returns to the default `main`.

> **Don't install it as a junction or a symlink.** It is tempting — the mod
> hot-reloads as you edit, with no copy step. The JavaScript does load that
> way, so the panels come up and look right. But `svg("mods/personal-cockpit/…")`
> resolves to a path outside `~/.config/herdr-app` and the icons silently do
> not draw: no refresh, no gear, no dock arrow, no minimise, and nothing in
> `herdr-app status` to say why. Verified on Windows 0.1.13 by A/B — same
> commit, same layout, junction gives bare headers and a copy gives all four
> buttons. That the app resolves the real path at all means a Unix symlink
> will very likely do the same; untested, and the install scripts copy on
> every platform so it never comes up. Re-run the installer after each edit.

## Platforms

Windows, macOS and Linux. `gh` is the only thing it shells out to and it
behaves the same on all three; the panel talks to it through `exec`, never
through a shell, so nothing here depends on PowerShell or on `sh`.

Two places know which platform they are on, both through `window().platform`:

- **Finding `gh`.** Herdr's environment is the one it started with, so a `gh`
  installed afterwards is not on its PATH until the app restarts. The lookup
  tries `gh` first, then `C:\Program Files\GitHub CLI\gh.exe` and its x86
  sibling, `/opt/homebrew/bin/gh`, `/usr/local/bin/gh`, `/usr/bin/gh`.
- **Offering to install it.** Windows gets a button running
  `winget install --id GitHub.cli -e`, macOS one running `brew install gh`.
  Linux gets a line of text instead, because guessing between apt, dnf,
  pacman, zypper and the rest is worse than pointing at cli.github.com.

Everything else — opening a row, the New task form — goes through
`cx.open_url`, which hands the URL to whatever the system opens URLs with.

An earlier version of the tasks panel read a GitHub token out of Git
Credential Manager through a bundled PowerShell script, which worked on
Windows only. It is gone; `gh` holds the login now.

To put the panels in a layout you already have, add two blocks to a column:

```json
{ "id": "pulls", "type": "block", "min": 42, "size": { "weight": 1 },
  "content": { "mod": "personal-cockpit", "props": { "kind": "pulls", "node": "pulls" } } },
{ "id": "kraken-issues", "type": "block", "min": 42, "size": { "weight": 1 },
  "content": { "mod": "personal-cockpit", "props": { "kind": "issues", "node": "kraken-issues" } } }
```

For the move button to have somewhere to go, the row holding your tab block
needs an empty `right-lists` column — or let the panel create one the first
time you press it.

## Choosing the repo Kraken Tasks watches

Click the gear in its header, or press `c` while the panel has the keyboard.
Type `owner/name`; anything the signed-in `gh` can read works, including a
private repo on an org. The repos you pick are remembered for one-click
switching.

The choice lives in `shared("cockpit.issues.repo")`, which Herdr keeps in that
machine's `shared.json`. **So each machine keeps its own** — the desktop can
watch `you/personal-tasks` while the work laptop watches `org/work-tasks`, with
no configuration beyond picking once on each.

To pin a block instead, name the repo in the layout and the gear disappears —
useful for showing two task panels at once:

```json
"props": { "kind": "issues", "node": "work-issues", "repo": "org/work-tasks" }
```

## Adding a task

The pencil in the Kraken Tasks header, `n` with the keyboard, or the button
under "No open tasks" when the queue is empty. It opens the new-issue form for
the repo you are watching, in the browser.

Which form it lands on is resolved against the templates the repo really has:

| The repo's `.github/ISSUE_TEMPLATE` | Where the button goes |
|---|---|
| has `task.yml` | straight into it — kraken installs its issue form at exactly that path, so in a repo `kraken init` touched the name is a contract |
| one template, another name | straight into that one |
| several, no `task.yml` | GitHub's `/issues/new/choose` |
| none, or unreadable | a blank `/issues/new` |

The list is looked up once per repo per run, not on every poll. To force one
named form regardless, add `"template": "something.yml"` to the block's props.

## Keys

Handled by the focused panel, no binding needed:

| Key | Does |
|---|---|
| `↑` / `↓` | move the selection |
| `enter` | open the selected row in the browser |
| `r` | refresh |
| `n` | new task (Kraken Tasks) |
| `c` | choose the repository (Kraken Tasks) |

`pane.go` reaches the panels, so `ctrl-alt-<arrow>` or whatever you have bound
to it moves the keyboard onto one.

A binding in `keys.json` reaches **both** panels, because they are one mod:

```json
{ "mod:personal-cockpit": { "f5": "personal-cockpit.refresh" } }
```

No `keys.json` ships here, so nothing of yours is touched.

## Developing

The loop is edit, reinstall, look — there is no hot reload here, because the
mod is installed as a copy (see the warning above):

```powershell
.\tools\install.ps1 -NoSwitch     # copy over the installed one; runs check too
```

```sh
./tools/install.sh --no-switch
herdr-app status                  # errors from layouts, keys and mods
herdr-app shot shot.png           # the last rendered frame, as a PNG
```

Both installers replace the installed copy wholesale, so a file deleted here
is deleted there, and both run `check` on what they installed before
switching. `--no-layout` / `-NoLayout` leaves `layouts/cockpit.json` alone.
`HERDR_APP_HOME` points `install.sh` at another home, which is also how it
gets tested.

```sh
herdr-app check mods/personal-cockpit   # must exit 0 before you call it done
```

`check` renders the mod once with no props, which is the pull requests panel.
To check another screen, force it at the top of `list.js` or `main.js`, run
`check`, and put it back. `herdr-app shot` is the only way to see the other
two; `status` stays clean even when an asset fails to load.

`jsconfig.json` and `gpui-kit.d.ts` are written into the mod folder by the app
on every start and are deliberately not committed: the typings have to match
the installed version.

## Why one mod

The two panels began as two mod folders and shared about a third of their code
line for line — plus a second copy of every bug fix. Mods cannot import across
folders (`./relative` inside the folder is the limit), so the only way to share
is to be one mod, with the layout running it twice under different `props.kind`.
That is what the Herdr app's own `win98` does, and what `cockpit`, `redline` and
`claude-chat` do in the community.

`git log` has the before: the first commit is both panels exactly as they ran,
the second is the merge.

## Licence

MIT.

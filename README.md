# Personal Cockpit

Panels for the [Herdr](https://herdr.dev) desktop app: what needs me, in the
sidebar, next to the agents doing the work.

![Personal Cockpit](preview.png)

| Panel | What it shows |
|---|---|
| **My pull requests** | Your open PRs across every repo you can read: build state, approvals, conflicts, unresolved threads, diff size. Grouped into Needs you / Ready to merge / Waiting / Drafts. |
| **Team's pull requests** | The same, for the people you watch — from a search you keep in `team.yml`. **Grouped by whoever opened them**, and a row says when your review is the thing it is waiting for. |
| **Kraken Tasks** | The open issues of one coordination repo you choose — a [kraken](https://github.com/rafael-adcp/kraken) task queue. Grouped into Needs you / Queue, with the issues' own GitHub labels. |
| **Routines** | Kraken tasks you keep instead of rewriting. A `▶` opens one in the queue; while its task is open the button is gone. Grouped into Needs you / In the queue / Ready / Paused. |

All four keep their last good list when a refresh fails, minimise to their own
header bar — the minus, or a press anywhere else on the bar — move to a column
on the right, and drop to an icon-and-count rail when the sidebar is dragged
narrow.

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

Three places know which platform they are on, all through `window().platform`:

- **Finding `gh`.** Herdr's environment is the one it started with, so a `gh`
  installed afterwards is not on its PATH until the app restarts. The lookup
  tries `gh` first, then `C:\Program Files\GitHub CLI\gh.exe` and its x86
  sibling, `/opt/homebrew/bin/gh`, `/usr/local/bin/gh`, `/usr/bin/gh`.
- **Offering to install it.** Windows gets a button running
  `winget install --id GitHub.cli -e`, macOS one running `brew install gh`.
  Linux gets a line of text instead, because guessing between apt, dnf,
  pacman, zypper and the rest is worse than pointing at cli.github.com.
- **Opening a config file** from the Routines or Team gear (`conf.js`):
  `cmd /c start`, `open`, `xdg-open`. `cx.open_url` cannot do this one — it
  takes an absolute `http`/`https` URL and refuses every other scheme by
  design, so that a mod cannot hand an arbitrary URI to whichever handler the
  desktop registered for it. That rules out `file://`, and a file is what this
  has to open.

Everything else — opening a row, the New task form — goes through
`cx.open_url`, which hands the URL to whatever the system opens URLs with.

An earlier version of the tasks panel read a GitHub token out of Git
Credential Manager through a bundled PowerShell script, which worked on
Windows only. It is gone; `gh` holds the login now.

To put the panels in a layout you already have, add a block per panel to a
column:

```json
{ "id": "pulls", "type": "block", "min": 42, "size": { "weight": 1 },
  "content": { "mod": "personal-cockpit", "props": { "kind": "pulls", "node": "pulls" } } },
{ "id": "team", "type": "block", "min": 42, "size": { "weight": 1 },
  "content": { "mod": "personal-cockpit", "props": { "kind": "team", "node": "team" } } },
{ "id": "routines", "type": "block", "min": 42, "size": { "weight": 1 },
  "content": { "mod": "personal-cockpit", "props": { "kind": "routines", "node": "routines" } } },
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

## Team's pull requests

Nothing can ask GitHub for somebody else's pull requests the way the panel
above asks for yours — `viewer.pullRequests` is only ever you. So this one
searches, with a query you keep in `team.yml` **in the installed mod folder**:

```
~/.config/herdr-app/mods/personal-cockpit/team.yml
```

The gear in the header opens it, and `c` with the keyboard does the same. It
writes the file from `team.example.yml` the first time, so the gear always opens
something. Both installers leave it alone, so a new teammate takes effect on the
next poll — no reinstall, no restart, and like `routines.yml` it is per machine.

Two settings, both optional on their own but not together:

```yaml
query: org:your-org draft:false -author:your-login

people:
  - alice
  - bob
```

`query` is GitHub's own issue-search syntax — the string you would type into
the search box. **Scope it**: without an `org:` or a `repo:` you get a
teammate's weekend projects beside the work. `is:pr`, `is:open` and
`sort:updated-desc` are added when you leave them out, and a query that already
says `is:closed` or `merged:` keeps the state it asked for. `@me` is expanded
before the call, so `review-requested:@me` works here even though the search API
does not know that shorthand — that one query turns the panel from who you watch
into what is waiting on you.

`people` are GitHub logins. They go on as `author:` terms, so the panel holds
those people and nobody else, and **the order you write them in is the order of
the groups**. Leave it out and the query stands alone, with a group for whoever
it found, most recently active first: that is how to watch a whole org without
naming anybody.

The groups do not reorder themselves as things happen — a list you glance at is
one whose rows are where you left them. What wants you is in the header's red
count, in a `your review` on the row, and first inside that person's group.
`you approved` says you are done with one. Set the panel wide, or dock it to the
right column, and the second line gets room for all of it.

Pointed at nothing, the panel says `nothing to watch` rather than showing you an
empty list and letting you wonder. A query too long for GitHub's 256-character
cap says that too, with the length, instead of returning a bare
`Validation Failed`.

## Routines

A task you open again and again — review the flaky tests, prune merged
branches — written once and kept. Press `▶` in the row and it is opened in the
queue, labelled and with its Goal and Acceptance already in it; a worker claims
it from there.

They live in `routines.yml` **in the installed mod folder**, not in this repo:

```
~/.config/herdr-app/mods/personal-cockpit/routines.yml
```

The gear in the panel's header opens that file, and `c` with the keyboard does
the same — it is the whole configuration surface of the panel, so there is
nowhere else to look and no path to remember. If it is not there, the gear
writes it from `routines.example.yml` first.

Both installers leave that file alone — it is in their exclude list beside
`team.yml` and the two the app writes — and copy `routines.example.yml` across
only when it is not there yet. So a new routine takes effect on the next poll, with no reinstall and
no restart, which is the opposite of how every other file here works. It is also
why the file is per machine: your two laptops can keep different routines, and
neither can open the other's tasks.

The example file is the reference for the fields. Three of them are not a style
preference — `PROTOCOL.md §2` makes **Goal**, **Acceptance** and exactly one
`project:<name>` mandatory, because a task with no project label is invisible to
every conforming worker and one with an empty Goal stalls whoever claims it. The
panel checks that when it reads the file, so a broken routine says so in its row
rather than when you press the button.

A routine has no id: **the title is its identity**, written into a marker in
every task it opens, which is how the panel tells whose task is whose. A second
field to keep in step with the title would earn its place only for renames, and
the cost of not having it is narrow — rename a routine while its task is open
and the `▶` comes back, so a second task can be opened. The loose one is sitting
in Kraken Tasks. Renaming the *issue* on GitHub is safe: the marker keeps the
title the task was opened with.

**Nothing here is scheduled.** The `▶` is the only way a routine opens anything:
no timer, no daemon, no launchd or Task Scheduler, and so nothing to install and
nothing that behaves differently on Windows than on macOS. A cron field is the
obvious next step and deliberately not here; `git log` has a tested
implementation of one if it is ever wanted.

While a routine's task is still open, its `▶` is gone: two workers on one goal
would deliver the same work twice. Close the task to run it again. That is the
only guard, and it is enough because the queue is the state — nothing about a
routine is remembered locally, so both laptops read the same answer out of
GitHub rather than disagreeing from their own `shared.json`.

## Keys

Handled by the focused panel, no binding needed:

| Key | Does |
|---|---|
| `↑` / `↓` | move the selection |
| `enter` | open the selected row in the browser |
| `r` | refresh |
| `n` | new task (Kraken Tasks) |
| `c` | the gear: choose the repository (Kraken Tasks), open `routines.yml` (Routines) or `team.yml` (Team's pull requests) |

`pane.go` reaches the panels, so `ctrl-alt-<arrow>` or whatever you have bound
to it moves the keyboard onto one.

A binding in `keys.json` reaches **every** panel, because they are one mod:

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
`check`, and put it back. `herdr-app shot` is the only way to see the others;
`status` stays clean even when an asset fails to load.

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

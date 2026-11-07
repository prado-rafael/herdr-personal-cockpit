// Your open pull requests in the sidebar: whether the build passed, how many
// approvals each has, and what else stands between it and the merge button.
// Click a row to open that PR in the browser. Minimise to the header bar with
// the − button; `r` refreshes when the panel has the keyboard.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, theme, notify, nextCommand, layout, shared, setShared, window as hostWindow } from "herdr";
import { fetchPulls, ghCommand, ago, agoShort } from "./github.js";

// Slow on purpose: a sidebar panel keeps its timers while hidden.
const EVERY = 180000;
// Below this the row drops to one line: there is no room for a second.
const WIDE = 220;
// Minimised: the header bar and nothing else (1px top border + a 41px header).
const COLLAPSED = 42;
// Anything this short counts as minimised, however it got that way -- dragging
// the divider up to a sliver means the same thing as pressing the button.
const COLLAPSED_MAX = 60;

const GROUPS = [
  ["attention", "Needs you"],
  ["ready", "Ready to merge"],
  ["waiting", "Waiting"],
  ["draft", "Drafts"],
];

const RED = (state) => state === "FAILURE" || state === "ERROR";
const RUNNING = (state) => state === "PENDING" || state === "EXPECTED";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The layout block showing this mod, so the minimise button resizes the right
// node without hardcoding an id the layout is free to rename. Null when the mod
// runs as a pane instead of a layout block -- then there is nothing to resize.
function hostBlock(node) {
  if (node?.content?.mod === "pulls") return node;
  for (const child of node?.children ?? []) {
    const found = hostBlock(child);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows
// it too. Same rule the spaces, agents and issues mods use.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function parentOf(node, id) {
  for (const child of node?.children ?? []) {
    if (child.id === id) return node;
    const found = parentOf(child, id);
    if (found) return found;
  }
  return null;
}

// The right-hand column of panels: a stack like the sidebar's, not one block
// filling the side. Shared with the other panels that can move there, so the
// id is a convention between them, not this mod's own. It stays in the tree
// while empty and hides instead, which is what keeps its dragged width.
const RIGHT = "right-lists";
const RIGHT_WIDTH = 380;

const holdingIn = (tree, test) => {
  const walk = (node) => {
    for (const child of node?.children ?? []) {
      if (test(child)) return node;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(tree);
};

// Where this panel can live, found by what the nodes hold rather than by their
// names: the column with the spaces list is the sidebar, the row with the tab
// block is the work area that the right column goes in. A layout shaped
// differently returns null and the move button stays hidden.
function destinations(tree) {
  return {
    sidebar: holdingIn(tree, (n) => n.content?.mod === "spaces"),
    work: holdingIn(tree, (n) => n.content?.tab),
    right: find(tree, RIGHT),
  };
}

// Which of the two the block sits in now, or null when this copy is a pane or
// an overlay and there is nothing to move.
function placeOf(tree, host) {
  if (!host) return null;
  const { sidebar, work, right } = destinations(tree);
  const owner = parentOf(tree, host.id);
  if (!owner) return null;
  if (owner === sidebar) return "sidebar";
  if (owner === right) return "right";
  // Somewhere else in the layout: it can still move, as long as both ends exist.
  return sidebar && work ? "elsewhere" : null;
}

function opener(url) {
  switch (hostWindow()?.platform) {
    // FileProtocolHandler hands the URL to the default browser with no shell in
    // between, so nothing has to be quoted and no console window flashes.
    case "windows": return ["rundll32", ["url.dll,FileProtocolHandler", url]];
    case "macos": return ["open", [url]];
    default: return ["xdg-open", [url]];
  }
}

export default class Pulls extends View {
  init(_props, cx) {
    this.pulls = [];
    this.login = null;
    this.state = "loading"; // loading | ok | no-gh | no-auth | error
    this.error = null;
    // Set when a refresh failed but the list it would have replaced is still good.
    this.stale = null;
    this.at = 0;
    this.fetchedAt = null;
    this.busy = false;
    this.width = 0;
    this.handle = cx.focus_handle();
    this.refresh(cx);
    cx.timer.every(EVERY, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (command === "refresh") this.refresh(cx);
        cx.notify();
      }
    });
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await fetchPulls();
        this.pulls = r.pulls;
        this.login = r.login;
        this.state = "ok";
        this.error = null;
        this.stale = null;
        this.fetchedAt = Date.now();
      } catch (e) {
        const kind = e?.kind ?? "error";
        const message = String(e?.message ?? e);
        // One failed poll -- a dropped connection, a TLS timeout -- shouldn't
        // blank a list that was right a moment ago. Keep it and say it's old.
        if (kind === "error" && this.state === "ok" && this.pulls.length) {
          this.stale = message;
        } else {
          this.state = kind;
          this.error = message;
          this.stale = null;
        }
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
    cx.notify();
  }

  open(pr, cx) {
    if (!pr) return;
    const [command, args] = opener(pr.url);
    cx.spawn(async () => {
      try {
        const r = await exec(command, args);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `${command} exited ${r.code}`);
      } catch (e) {
        notify({ title: `Couldn't open ${pr.repo} #${pr.number}`, body: String(e?.message ?? e), level: "error" });
      }
    });
  }

  terminal(argv) {
    run("terminal.open", { argv, place: "tab" });
  }

  // Minimise to the header bar rather than hiding the block: a hidden block
  // leaves nothing on screen to click to bring it back.
  minimise(host, collapsed) {
    if (collapsed) {
      const remembered = shared("pulls.height");
      if (typeof remembered === "number" && remembered > COLLAPSED_MAX) {
        run("layout.resize", { id: host.id, px: remembered });
      } else {
        // Never dragged, so give back the flexible share it started as.
        run("layout.resize", { id: host.id, weight: 1 });
      }
      return;
    }
    const px = host.size?.px;
    if (typeof px === "number" && px > COLLAPSED_MAX) setShared("pulls.height", px);
    run("layout.resize", { id: host.id, px: COLLAPSED });
  }

  // Move the block between the sidebar column and the work row. Each side
  // remembers the size it had there, so going back and forth doesn't reset it.
  // Only a layout the person owns accepts this: Herdr refuses structural edits
  // to its own, which is why the button hides when there is nowhere to go.
  moveTo(host, side) {
    const tree = JSON.parse(JSON.stringify(layout()));
    const { sidebar, work } = destinations(tree);
    const owner = parentOf(tree, host.id);
    if (!owner || !sidebar || !work) return;
    const at = owner.children.findIndex((c) => c.id === host.id);
    if (at < 0) return;
    const [block] = owner.children.splice(at, 1);
    // A panel in a stack: the same shape on either side, so moving it is only
    // a change of column, never a change of what it is.
    block.size = { weight: 1 };
    block.min = 42;
    delete block.max;

    if (side === "right") {
      let column = find(tree, RIGHT);
      if (!column) {
        column = { id: RIGHT, type: "column", size: { px: RIGHT_WIDTH }, min: 300, max: 640, children: [] };
        work.children.push(column);
      }
      column.children.push(block);
    } else {
      sidebar.children.push(block);
    }

    // An empty column hides rather than goes: it keeps the width it was
    // dragged to, and the panel that moves back next lands in the same place.
    const column = find(tree, RIGHT);
    if (column) column.hidden = column.children.length === 0;
    run("layout.set", { layout: tree });
  }

  // The flat strip the list draws and the arrows walk: group titles in place,
  // every PR under its own.
  strip() {
    const rows = [], pickable = [];
    for (const [group, label] of GROUPS) {
      const mine = this.pulls.filter((p) => p.group === group);
      if (!mine.length) continue;
      rows.push({ kind: "head", label, count: mine.length });
      for (const pr of mine) {
        rows.push({ kind: "pr", pr });
        pickable.push(pr);
      }
    }
    return { rows, pickable };
  }

  // How many want something from you: the number worth widening the rail for.
  attention() {
    return this.pulls.filter((p) => p.group === "attention").length;
  }

  checkGlyph(t, checks) {
    if (RUNNING(checks.state))
      return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
    const red = RED(checks.state);
    return div()
      .w(11)
      .flex_none()
      .text_center()
      .text_color(red ? t.ansi1 : checks.state === "SUCCESS" ? t.ansi2 : t.dim)
      .child(red ? "✕" : checks.state === "SUCCESS" ? "✓" : "·");
  }

  // What's true about this PR, most pressing first: the line truncates from the
  // right, so the thing you need to act on survives a narrow sidebar.
  signals(t, pr) {
    const out = [];
    const tag = (text, color) => out.push(div().flex_none().text_color(color).child(text));
    if (pr.conflicts) tag("conflicts", t.ansi1);
    if (pr.changesRequested) tag("changes requested", t.ansi1);
    if (RED(pr.checks.state)) {
      const n = pr.checks.failing.length;
      tag(n > 1 ? `${n} failing` : pr.checks.failing[0] ? `${pr.checks.failing[0]} failing` : "build failed", t.ansi1);
    }
    if (pr.unresolved) tag(`${pr.unresolved} unresolved`, t.blocked);
    if (RUNNING(pr.checks.state)) tag(pr.checks.running.length > 1 ? `${pr.checks.running.length} running` : "building", t.working);
    if (pr.approvals) tag(`${pr.approvals} approved`, t.ansi2);
    else if (pr.reviewDecision === "REVIEW_REQUIRED") tag("review needed", t.muted);
    if (pr.clean && pr.group === "ready") tag("ready", t.ansi2);
    if (pr.behind) tag("behind base", t.dim);
    if (pr.checks.state === "NONE" && !pr.draft) tag("no checks", t.dim);
    return out;
  }

  // Everything the row had to truncate away, in full.
  tip(pr) {
    const lines = [`${pr.repo} #${pr.number}`, pr.title, `${pr.branch} → ${pr.base}`];
    if (pr.checks.failing.length) lines.push(`failing: ${pr.checks.failing.join(", ")}`);
    if (pr.checks.running.length) lines.push(`running: ${pr.checks.running.join(", ")}`);
    if (pr.approvals) lines.push(`${pr.approvals} approved`);
    if (pr.unresolved) lines.push(`${pr.unresolved} unresolved thread${pr.unresolved > 1 ? "s" : ""}`);
    if (pr.comments) lines.push(`${pr.comments} comment${pr.comments > 1 ? "s" : ""}`);
    lines.push(`${pr.changedFiles} file${pr.changedFiles === 1 ? "" : "s"}, +${pr.additions} −${pr.deletions}`);
    lines.push(`updated ${ago(pr.updatedAt)}`);
    return lines.join("\n");
  }

  row(t, pr, on, pickable, wide) {
    const short = pr.repo.includes("/") ? pr.repo.split("/")[1] : pr.repo;
    const line1 = h_flex()
      .gap(6)
      .items_center()
      .child(this.checkGlyph(t, pr.checks))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(pr.title))
      .when(pr.draft, (el) => el.child(div().flex_none().text_size(9.5).text_color(t.dim).child("draft")))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(agoShort(pr.updatedAt)));
    const row = v_flex()
      .id(`pr-${pr.repo}-${pr.number}`)
      .px(10)
      .py(5)
      .gap(2)
      .rounded(6)
      .cursor_pointer()
      .tooltip(this.tip(pr))
      .when(on, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.at = Math.max(0, pickable.indexOf(pr));
        this.open(pr, cx);
        cx.notify();
      })
      .child(line1);
    if (!wide) return row;
    // Same 11px first cell and gap as the line above, so the text starts under
    // the title however the glyph is drawn.
    return row.child(
      h_flex()
        .gap(6)
        .items_center()
        .text_size(10.5)
        .child(div().w(11).flex_none())
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .gap(5)
            .items_center()
            .truncate()
            .child(div().flex_none().text_color(t.muted).child(`${short} #${pr.number}`))
            .children(this.signals(t, pr))
            .child(div().flex_none().text_color(t.ansi2).child(`+${pr.additions}`))
            .child(div().flex_none().text_color(t.ansi1).child(`−${pr.deletions}`)),
        ),
    );
  }

  // The sidebar rail: no room for rows, so carry only the one number that
  // would make someone widen it again.
  rail(t, attention) {
    const children = [svg("mods/pulls/pulls.svg").size(15).flex_none().text_color(attention ? t.blocked : t.dim)];
    if (attention > 0) {
      children.push(
        div()
          .flex_none()
          .px(4)
          .rounded(4)
          .bg(t.blocked + "26")
          .text_size(10)
          .font_semibold()
          .text_color(t.blocked)
          .child(String(attention)),
      );
    }
    return v_flex().pt(14).gap(5).flex_none().items_center().children(children);
  }

  header(t, host, collapsed, place) {
    const attention = this.attention();
    const left = [div().flex_none().text_size(11.5).font_medium().text_color(t.dim).child("Pull requests")];
    // Say which kind of trouble: "needs setup" is a lie when the network blipped.
    const trouble =
      this.state === "no-gh" ? "gh missing"
      : this.state === "no-auth" ? "sign in"
      : this.state === "error" ? "failed"
      : this.stale ? "stale" : null;
    if (trouble) {
      left.push(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.blocked).child(trouble));
    } else if (attention > 0) {
      left.push(
        div()
          .flex_none()
          .px(5)
          .rounded(4)
          .bg(t.blocked + "26")
          .text_size(10)
          .font_semibold()
          .text_color(t.blocked)
          .child(`${attention} needs you`),
      );
    } else if (this.state === "ok" && this.pulls.length) {
      left.push(div().flex_none().text_size(10).text_color(t.muted).child(String(this.pulls.length)));
    }

    const stamp = this.fetchedAt ? `Refreshed ${ago(this.fetchedAt)}` : "Never refreshed";
    const actions = [
      this.busy
        ? svg("mods/workspace-chrome/spinner.svg").size(13).flex_none().text_color(t.working).spin(900)
        : div()
            .id("pulls-refresh")
            .flex_none()
            .text_color(t.dim)
            .hover((s) => s.text_color(t.foreground))
            .tooltip(this.login ? `${this.login} · ${stamp}` : stamp)
            .on_click((_e, cx) => this.refresh(cx))
            .child(svg("mods/pulls/refresh.svg").size(13)),
    ];
    if (place) {
      const here = place === "right";
      actions.push(
        div()
          .id("pulls-move")
          .flex_none()
          .text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .tooltip(here ? "Move to the left sidebar" : "Move to the right column")
          .on_click(() => this.moveTo(host, here ? "sidebar" : "right"))
          .child(svg(`mods/pulls/dock-${here ? "left" : "right"}.svg`).size(13)),
      );
    }
    if (host) {
      actions.push(
        div()
          .id("pulls-minimise")
          .flex_none()
          .text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .tooltip(collapsed ? "Expand" : "Minimise")
          .on_click(() => this.minimise(host, collapsed))
          .child(svg(`mods/pulls/${collapsed ? "plus" : "minus"}.svg`).size(13)),
      );
    }

    return h_flex()
      .px(16)
      .h(41)
      .pt(14)
      .pb(5)
      .flex_none()
      .gap(6)
      .items_center()
      .justify_between()
      .child(h_flex().flex_1().min_w(0).gap(6).items_center().children(left))
      .child(h_flex().flex_none().gap(8).items_center().children(actions));
  }

  // Not an empty panel: say what's missing and hand over a terminal that fixes it.
  setup(t) {
    const button = (label, onClick) =>
      div()
        .id(`pulls-${label.replace(/\W+/g, "-")}`)
        .flex_none()
        .h(26)
        .px(10)
        .flex()
        .items_center()
        .rounded(6)
        .bg(t.solid)
        .text_color(t.solid_foreground)
        .text_size(11.5)
        .cursor_pointer()
        .hover((s) => s.bg(t.accent))
        .on_click(onClick)
        .child(label);
    const note = (text) => div().text_size(11).text_color(t.dim).child(text);
    const panel = v_flex().px(16).pb(10).gap(8).items_start();
    if (this.state === "no-gh") {
      const windows = hostWindow()?.platform === "windows";
      return panel
        .child(note("GitHub CLI not found. Install it, sign in, then restart Herdr so it picks up the new PATH."))
        .when(windows, (el) =>
          el.child(button("Install gh", () => this.terminal(["powershell", "-NoProfile", "-Command", "winget install --id GitHub.cli -e"]))))
        .when(!windows, (el) => el.child(note("macOS: brew install gh · Linux: cli.github.com")));
    }
    if (this.state === "no-auth")
      return panel
        .child(note("Not signed in. `gh auth login` opens your browser once."))
        .child(button("Sign in", () => this.terminal([ghCommand(), "auth", "login"])));
    // Not every failure is a setup problem: a dropped connection lands here too,
    // so the way out is to try again, not to reinstall anything.
    return panel
      .child(div().text_size(11).text_color(t.ansi1).child(this.error ?? "unknown error"))
      .child(button("Try again", (_e, cx) => this.refresh(cx)));
  }

  render() {
    const t = theme();
    const rail = narrow();
    const wide = this.width >= WIDE;
    const tree = layout();
    const host = hostBlock(tree) ?? find(tree, "pulls");
    const place = placeOf(tree, host);
    // Go by this copy's own measured width, not by a node name: the panel can
    // be in either column, and either one can be dragged narrow.
    const railed = this.width > 0 ? this.width < 160 : rail;
    const collapsed = Boolean(host) && host.size?.px <= COLLAPSED_MAX;
    const { rows, pickable } = this.strip();
    this.at = Math.min(this.at, Math.max(0, pickable.length - 1));
    const selected = pickable[this.at] ?? null;

    const body = [railed ? this.rail(t, this.attention()) : this.header(t, host, collapsed, place)];
    if (!railed && !collapsed) {
      if (this.state !== "ok" && this.state !== "loading") {
        body.push(this.setup(t));
      } else if (!rows.length) {
        body.push(
          div()
            .px(16)
            .pb(6)
            .text_size(12)
            .text_color(t.dim)
            .child(this.state === "loading" ? "Loading pull requests…" : "No open pull requests"),
        );
      } else {
        body.push(
          v_flex()
            .id("pulls-list")
            .flex_1()
            .min_h(0)
            .px(6)
            .gap(1)
            .overflow_y_scrollbar()
            .children(
              rows.map((r) =>
                r.kind === "head"
                  ? h_flex()
                      .px(10)
                      .pt(8)
                      .pb(2)
                      .gap(5)
                      .items_center()
                      .text_size(10)
                      .font_semibold()
                      .text_color(t.dim)
                      .child(r.label)
                      .child(div().text_color(t.muted).child(String(r.count)))
                  : this.row(t, r.pr, r.pr === selected, pickable, wide),
              ),
            ),
        );
        if (this.stale) {
          body.push(
            div()
              .flex_none()
              .px(16)
              .pb(6)
              .text_size(10)
              .truncate()
              .text_color(t.dim)
              .tooltip(this.stale)
              .child(`Couldn't refresh · showing ${ago(this.fetchedAt)}`),
          );
        }
      }
    }

    return v_flex()
      .id("pulls")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .track_focus(this.handle)
      .on_size_change((size, cx) => {
        if (size.width === this.width) return;
        this.width = size.width;
        cx.notify();
      })
      .on_key_down((e, cx) => {
        if (e.key === "r") {
          this.refresh(cx);
          cx.stop_propagation();
          return;
        }
        if (!pickable.length) return;
        if (e.key === "down") this.at = (this.at + 1) % pickable.length;
        else if (e.key === "up") this.at = (this.at + pickable.length - 1) % pickable.length;
        else if (e.key === "enter") this.open(selected, cx);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(body);
  }
}

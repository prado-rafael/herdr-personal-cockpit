// The list panel, for whichever source `props.kind` names.
//
// Everything here used to exist twice -- once per mod -- and had already
// drifted: only one side kept a cache, only one had a keyboard cursor, only one
// held its last good list when a refresh failed. Now both get all three,
// because there is one of each.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { layout, nextCommand, openOverlay, props, run, theme, window as hostWindow } from "herdr";
import {
  COLLAPSED_MAX,
  RAIL_MAX,
  WIDE,
  button,
  find,
  hostBlockFor,
  header,
  minimise,
  moveTo,
  narrowSidebar,
  placeOf,
  rail,
  sectionHead,
  shell,
} from "./kit.js";
import { ago, ghCommand } from "./github.js";
import { repoOf } from "./config.js";
import * as pulls from "./pulls.js";
import * as issues from "./issues.js";

const SOURCES = { pulls, issues };

export class List {
  constructor(view, cx) {
    const p = props() ?? {};
    this.source = SOURCES[p.kind] ?? pulls;
    this.node = p.node ?? null;
    // Only for a repo with several issue forms where the layout wants one
    // named; with none or one, the right answer is found rather than told.
    this.template = p.template ?? null;
    this.heightKey = `cockpit.${this.source.panel}.height`;

    this.items = [];
    this.meta = null;
    this.state = "loading"; // loading | ok | no-repo | no-gh | no-auth | not-found | error
    this.error = null;
    // Set when a refresh failed but the list it would have replaced is still good.
    this.stale = null;
    this.fetchedAt = null;
    this.busy = false;
    this.width = 0;
    this.at = 0;

    this.repo = this.source.needsRepo ? repoOf(this.source.panel).repo : null;
    if (this.source.needsRepo && this.repo && this.source.cached) {
      const saved = this.source.cached(this.repo);
      if (saved) {
        this.items = saved.items;
        this.fetchedAt = saved.at ?? null;
        this.state = "ok";
      }
    }

    this.handle = cx.focus_handle();
    this.refresh(cx);
    cx.timer.every(this.source.refreshMs, (cx) => this.refresh(cx));

    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (command === "refresh") this.refresh(cx);
        else if (command === "configure") this.configure();
        else if (command === "new") this.openNew(cx);
        cx.notify();
      }
    });
  }

  // ---- data ---------------------------------------------------------------

  refresh(cx) {
    if (this.busy) return;
    if (this.source.needsRepo && !this.repo) {
      this.state = "no-repo";
      cx.notify();
      return;
    }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const { items, meta } = await this.source.load({ repo: this.repo });
        this.items = items;
        this.meta = meta;
        this.state = "ok";
        this.error = null;
        this.stale = null;
        this.fetchedAt = Date.now();
        if (this.source.save) this.source.save(this.repo, items, this.fetchedAt);
      } catch (e) {
        const kind = e?.kind ?? "error";
        const message = String(e?.message ?? e);
        // One failed poll -- a dropped connection, a TLS timeout -- shouldn't
        // blank a list that was right a moment ago. Keep it and say it's old.
        if (kind === "error" && this.state === "ok" && this.items.length) {
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

  // The repo changed under us: a pick in this panel's own dialog, or in another
  // copy of it. Shared state re-renders every mod, which is how we hear about it.
  reload(cx) {
    this.items = [];
    this.meta = null;
    this.state = this.repo ? "loading" : "no-repo";
    this.error = null;
    this.stale = null;
    this.fetchedAt = null;
    if (this.repo && this.source.cached) {
      const saved = this.source.cached(this.repo);
      if (saved) {
        this.items = saved.items;
        this.fetchedAt = saved.at ?? null;
        this.state = "ok";
      }
    }
    this.refresh(cx);
  }

  configure() {
    openOverlay({
      mod: "personal-cockpit",
      kind: "dialog",
      width: 420,
      props: { kind: "repo-picker", panel: this.source.panel, current: this.repo },
    });
  }

  terminal(argv) {
    run("terminal.open", { argv, place: "tab" });
  }

  // ---- shape --------------------------------------------------------------

  // The flat strip the list draws and the arrows walk: group titles in place,
  // every item under its own.
  strip() {
    const rows = [], pickable = [];
    for (const section of this.source.sections(this.items)) {
      rows.push({ kind: "head", label: section.label, count: section.items.length });
      for (const item of section.items) {
        rows.push({ kind: "item", item });
        pickable.push(item);
      }
    }
    return { rows, pickable };
  }

  open(item, cx) {
    if (item?.url) cx.open_url(item.url);
  }

  /** Where "New task" points, or null for a panel that makes nothing (pull
   *  requests come from a branch, not a form) or one with no repo yet. */
  newUrl() {
    if (!this.source.newUrl || !this.repo) return null;
    return this.source.newUrl(this.repo, this.meta, this.template);
  }

  openNew(cx) {
    const url = this.newUrl();
    if (url) cx.open_url(url);
  }

  // ---- ui -----------------------------------------------------------------

  // Not an empty panel: say what's missing and hand over the thing that fixes it.
  setup(t) {
    const note = (text) => div().text_size(11).text_color(t.dim).child(text);
    const panel = v_flex().px(16).pb(10).gap(8).items_start();
    const id = `cockpit-${this.source.panel}`;

    if (this.state === "no-repo") {
      return panel
        .child(note("No repository yet. Pick the one whose open issues are your queue."))
        .child(button(t, `${id}-pick`, "Choose repository", () => this.configure()));
    }
    if (this.state === "no-gh") {
      panel.child(note("GitHub CLI not found. Install it, sign in, then restart Herdr so it picks up the new PATH."));
      // Offer a command only where there is one command to offer. Linux has a
      // dozen package managers and guessing wrong is worse than saying where
      // to look.
      switch (hostWindow()?.platform) {
        case "windows":
          return panel.child(
            button(t, `${id}-install`, "Install gh", () =>
              this.terminal(["powershell", "-NoProfile", "-Command", "winget install --id GitHub.cli -e"]),
            ),
          );
        case "macos":
          return panel.child(
            button(t, `${id}-install`, "Install gh", () => this.terminal(["brew", "install", "gh"])),
          );
        default:
          return panel.child(note("Your package manager, or cli.github.com — then restart Herdr."));
      }
    }
    if (this.state === "no-auth") {
      return panel
        .child(note("Not signed in. `gh auth login` opens your browser once."))
        .child(button(t, `${id}-signin`, "Sign in", () => this.terminal([ghCommand(), "auth", "login"])));
    }
    if (this.state === "not-found") {
      return panel
        .child(note(`No access to ${this.repo}. GitHub answers the same for a repo that isn't there and one your login can't see.`))
        .child(button(t, `${id}-repick`, "Choose another", () => this.configure()));
    }
    // Not every failure is a setup problem: a dropped connection lands here
    // too, so the way out is to try again, not to reinstall anything.
    return panel
      .child(div().text_size(11).text_color(t.ansi1).child(this.error ?? "unknown error"))
      .child(button(t, `${id}-retry`, "Try again", (_e, cx) => this.refresh(cx)));
  }

  render(cx) {
    const t = theme();
    const source = this.source;

    // A pick in the dialog lands in shared state, which re-renders us. Noting
    // it here and loading from a deferred timer keeps the work out of the
    // render pass; the comparison makes it fire once per actual change.
    if (source.needsRepo) {
      const current = repoOf(source.panel).repo;
      if (current !== this.repo) {
        this.repo = current;
        cx.timer.after(0, (cx) => this.reload(cx));
      }
    }

    const tree = layout();
    const host = hostBlockFor(tree, source.panel, this.node) ?? find(tree, source.panel);
    const place = placeOf(tree, host);
    const collapsed = Boolean(host) && host.size?.px <= COLLAPSED_MAX;
    // Go by this copy's own measured width when it has one, not by a node name:
    // the panel can be in either column, and either one can be dragged narrow.
    const railed = this.width > 0 ? this.width < RAIL_MAX : narrowSidebar();
    const wide = this.width >= WIDE;

    const { rows, pickable } = this.strip();
    this.at = Math.min(this.at, Math.max(0, pickable.length - 1));
    const selected = pickable[this.at] ?? null;
    const attention = source.attention(this.items);
    const pinned = source.needsRepo && repoOf(source.panel).pinned;
    const newTask = this.newUrl();

    const trouble =
      this.state === "no-repo" ? "no repo"
      : this.state === "no-gh" ? "gh missing"
      : this.state === "no-auth" ? "sign in"
      : this.state === "not-found" ? "no access"
      : this.state === "error" ? "failed"
      : this.stale ? "stale" : null;

    const note = source.stampNote ? source.stampNote(this.meta, this.repo) : null;
    const body = [
      railed
        ? rail(t, source.icon, attention)
        : header(t, {
            id: `cockpit-${source.panel}`,
            title: source.title,
            attention,
            count: this.state === "ok" ? this.items.length : 0,
            trouble,
            troubleTip: this.stale ?? this.error ?? undefined,
            stamp: this.fetchedAt ? `${note ? `${note} · ` : ""}Refreshed ${ago(this.fetchedAt)}` : "Never refreshed",
            busy: this.busy,
            host,
            collapsed,
            place,
            // A layout that pinned the repo meant that block to be that repo.
            onConfigure: source.needsRepo && !pinned ? () => this.configure() : null,
            configureTip: this.repo ? `Watching ${this.repo} — change it` : "Choose a repository",
            onNew: newTask ? (c) => this.openNew(c) : null,
            newTip: `${source.newLabel} in ${this.repo}`,
            onRefresh: (c) => this.refresh(c),
            onMove: (side) => moveTo(host, side),
            onMinimise: () => minimise(host, collapsed, this.heightKey),
          }),
    ];

    if (!railed && !collapsed) {
      if (this.state !== "ok" && this.state !== "loading") {
        body.push(this.setup(t));
      } else if (!rows.length) {
        // An empty queue is the good case, so it gets the way to fill it
        // rather than only the news that it is empty.
        const idle = v_flex()
          .px(16)
          .pb(10)
          .gap(8)
          .items_start()
          .child(div().text_size(12).text_color(t.dim).child(this.state === "loading" ? source.loading : source.empty));
        if (newTask && this.state !== "loading") {
          idle.child(button(t, `cockpit-${source.panel}-new-empty`, source.newLabel, (_e, cx) => this.openNew(cx)));
        }
        body.push(idle);
      } else {
        body.push(
          v_flex()
            .id(`cockpit-${source.panel}-list`)
            .flex_1()
            .min_h(0)
            .px(6)
            .gap(1)
            .overflow_y_scrollbar()
            .children(
              rows.map((r) =>
                r.kind === "head"
                  ? sectionHead(t, r.label, r.count)
                  : source.rowOf(t, r.item, {
                      wide,
                      repo: this.repo,
                      selected: r.item === selected,
                      onClick: (_e, cx) => {
                        this.at = Math.max(0, pickable.indexOf(r.item));
                        this.open(r.item, cx);
                        cx.notify();
                      },
                    }),
              ),
            ),
        );
        const footnote = source.footnote ? source.footnote(this.meta) : null;
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
        } else if (footnote) {
          body.push(div().flex_none().px(16).pb(6).text_size(10).text_color(t.dim).child(footnote));
        }
      }
    }

    return shell(t, {
      id: `cockpit-${source.panel}`,
      handle: this.handle,
      body,
      onSize: (size, cx) => {
        if (size.width === this.width) return;
        this.width = size.width;
        cx.notify();
      },
      onKey: (e, cx) => {
        if (e.key === "r") {
          this.refresh(cx);
          cx.stop_propagation();
          return;
        }
        if (e.key === "c" && source.needsRepo && !pinned) {
          this.configure();
          cx.stop_propagation();
          return;
        }
        if (e.key === "n" && newTask) {
          this.openNew(cx);
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
      },
    });
  }
}

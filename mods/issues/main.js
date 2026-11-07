import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  appHome,
  exec,
  layout,
  nextCommand,
  props,
  readTextFile,
  run,
  setShared,
  shared,
  theme,
  writeTextFile,
} from "herdr";

// The kraken coordination repo: its open issues *are* the queue (PROTOCOL.md §1).
// Every issue in it carries `kraken-task`, so `state=open` already means
// "my kraken issues" -- no label filter is needed to scope the list.
const REPO = "rafael-adcp/personal-tasks";

// Parked on a human. These are the whole reason the panel exists, so they sort
// and draw first.
const ATTENTION = ["needs-decision", "awaiting-merge"];


const PER_PAGE = 100;
const REFRESH_MS = 60000;

// Below this the row drops to one line: there is no room for a second.
const WIDE = 220;

// Minimised: the header bar and nothing else (1px top border + a 41px header).
const COLLAPSED = 42;
// Anything this short counts as minimised, however it got that way -- dragging
// the divider down to a sliver means the same thing as pressing the button.
const COLLAPSED_MAX = 60;
// Where the button puts it back when there is no remembered height.
const RESTORED = 220;

// The two columns of stacked panels the panel can live in: the sidebar's, and
// the matching one on the right. Both are columns, so a panel keeps the same
// shape either side -- it shares the column's height and can minimise to its
// header bar in both.
const SIDEBAR = "sidebar-lists";
const RIGHT = "right-lists";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function parentOf(node, id) {
  for (const child of node?.children ?? []) {
    if (child.id === id) return node;
    const found = parentOf(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows
// it too. Same rule the spaces and agents mods use.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

const pad = (n) => (n < 10 ? `0${n}` : String(n));

function hhmm(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ago(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!(ms >= 0)) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 365)}y`;
}

const hex2 = (n) => (n < 16 ? "0" : "") + n.toString(16);

// GitHub picks label colours to sit on a white page, so the dark ones go
// invisible against the sidebar. Lift them toward white until they read: the
// badge still carries the label's own colour, only bright enough to see.
function labelColor(t, hex) {
  const n = hex ? parseInt(hex, 16) : NaN;
  if (!Number.isFinite(n)) return t.muted;
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  for (let i = 0; i < 8 && (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45; i++) {
    r += Math.round((255 - r) * 0.25);
    g += Math.round((255 - g) * 0.25);
    b += Math.round((255 - b) * 0.25);
  }
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

const labelNames = (issue) => (issue.labels ?? []).map((l) => l.name);
const needsYou = (issue) => labelNames(issue).some((n) => ATTENTION.includes(n));
const newestFirst = (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at);

// Keep only what a row draws: the cache goes through localStorage, and a full
// GitHub issue payload is ~40x larger than this.
const slim = (i) => ({
  number: i.number,
  title: i.title,
  url: i.html_url,
  comments: i.comments ?? 0,
  updated_at: i.updated_at,
  labels: (i.labels ?? [])
    .map((l) => (typeof l === "string" ? { name: l, color: null } : { name: l.name, color: l.color ?? null }))
    .filter((l) => Boolean(l.name)),
});

export default class Issues extends View {
  init(_props, cx) {
    this.repo = props()?.repo ?? REPO;
    this.node = props()?.node ?? null;
    this.error = null;
    this.loading = false;
    this.limited = false;
    this.token = null;
    this.updated = null;
    this.width = 0;
    this.issues = this.cached();
    this.handle = cx.focus_handle();

    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));

    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (command === "refresh") this.refresh(cx);
        cx.notify();
      }
    });
  }

  // ---- data ---------------------------------------------------------------

  cacheKey() {
    return `issues:${this.repo}`;
  }

  // Paint the last known queue immediately, so opening the panel is never a
  // blank box waiting on the network.
  cached() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.cacheKey()) ?? "null");
      if (saved && Array.isArray(saved.issues)) {
        this.updated = saved.updated ?? null;
        return saved.issues;
      }
    } catch {
      // A corrupt cache is not worth a broken panel.
    }
    return [];
  }

  save() {
    try {
      localStorage.setItem(this.cacheKey(), JSON.stringify({ issues: this.issues, updated: this.updated }));
    } catch {
      // The cache is a nicety; losing it costs one spinner.
    }
  }

  // The repo is private, so every request needs a bearer token. Git Credential
  // Manager already holds one for github.com, which is why nothing has to be
  // configured by hand; `data/github-token` is the escape hatch if it stops
  // answering.
  async githubToken() {
    if (this.token) return this.token;
    try {
      const r = await exec("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        `${appHome()}/mods/issues/token.ps1`,
      ]);
      const found = /^password=(.+)$/m.exec(r.stdout ?? "");
      if (r.code === 0 && found) {
        this.token = found[1].trim();
        return this.token;
      }
    } catch {
      // Not installed, or no credential stored: fall through to the file.
    }
    const file = await readTextFile(`${appHome()}/data/github-token`);
    this.token = file?.trim() || null;
    return this.token;
  }

  async load() {
    let token = await this.githubToken();
    if (!token) throw new Error("No GitHub login found");

    const url =
      `https://api.github.com/repos/${this.repo}/issues` +
      `?state=open&per_page=${PER_PAGE}&sort=updated&direction=desc`;
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "herdr-issues",
    };

    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${token}` } });

      if (r.ok) {
        const body = await r.json();
        if (!Array.isArray(body)) throw new Error("Unexpected response from GitHub");
        // `is:issue`: the issues endpoint returns pull requests too.
        return body.filter((i) => !i.pull_request).map(slim);
      }

      // Git Credential Manager rotates its token, so a rejected one is worth
      // exactly one retry with a freshly read credential.
      if ((r.status === 401 || r.status === 403) && attempt === 0) {
        this.token = null;
        const fresh = await this.githubToken();
        if (fresh && fresh !== token) {
          token = fresh;
          continue;
        }
      }

      if (r.status === 401 || r.status === 403) throw new Error("GitHub rejected the login");
      // GitHub answers 404, not 403, for a private repo the token cannot see.
      if (r.status === 404) throw new Error(`No access to ${this.repo}`);
      throw new Error(`GitHub returned ${r.status}`);
    }
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const issues = await this.load();
        this.issues = issues;
        this.limited = issues.length >= PER_PAGE;
        this.updated = Date.now();
        this.error = null;
        this.save();
      } catch (e) {
        // Keep the last good list on screen and report the failure in place of
        // the counts, rather than blanking the panel on a flaky network.
        this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  sections() {
    return [
      { id: "attention", label: "Needs you", issues: this.issues.filter(needsYou).sort(newestFirst) },
      { id: "queue", label: "Queue", issues: this.issues.filter((i) => !needsYou(i)).sort(newestFirst) },
    ];
  }

  // ---- ui -----------------------------------------------------------------

  // The sidebar rail: no room for rows, so carry only the one number that
  // would make someone widen it again.
  rail(t, attention) {
    const children = [svg("mods/issues/issues.svg").size(15).flex_none().text_color(attention ? t.blocked : t.dim)];
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

  // Dock the panel on the other side by editing the layout file: this is a
  // cloned, personal layout, and layout files apply live. `layout.set` would
  // need the whole tree round-tripped through layout(); the file *is* the tree.
  async dock() {
    const name = shared("layout");
    const path = `${appHome()}/layouts/${name}.json`;
    const text = await readTextFile(path);
    if (!text) throw new Error(`Could not read ${name}.json`);
    const tree = JSON.parse(text);

    const from = parentOf(tree, this.node);
    if (!from) throw new Error(`No "${this.node}" block in ${name}`);
    const toId = from.id === RIGHT ? SIDEBAR : RIGHT;
    const to = find(tree, toId);
    if (!to) throw new Error(`No "${toId}" in ${name}`);

    const [block] = from.children.splice(
      from.children.findIndex((c) => c.id === this.node),
      1,
    );
    // Both docks are columns of stacked panels, so the shape carries over.
    block.size = { weight: 1 };
    block.min = 42;
    // Arriving hidden or collapsed would read as "it vanished".
    delete block.hidden;
    (to.children ??= []).push(block);
    delete to.hidden;
    // An empty column would otherwise hold its width as a blank gutter.
    if (!from.children.length) from.hidden = true;

    // Compare-and-swap: another panel lives in this same file, and a stale
    // write would silently drop it.
    await writeTextFile(path, `${JSON.stringify(tree, null, 2)}\n`, text);
  }

  // Minimise to the header bar rather than hiding the block: a hidden block
  // leaves nothing on screen to click to bring it back.
  minimise(host, collapsed) {
    if (collapsed) {
      const remembered = shared("issues.height");
      if (typeof remembered === "number" && remembered > COLLAPSED_MAX) {
        run("layout.resize", { id: host.id, px: remembered });
      } else {
        // Never dragged, so give back the flexible third it started as.
        run("layout.resize", { id: host.id, weight: 1 });
      }
      return;
    }
    const px = host.size?.px;
    if (typeof px === "number" && px > COLLAPSED_MAX) setShared("issues.height", px);
    run("layout.resize", { id: host.id, px: COLLAPSED });
  }

  header(t, attention, host, collapsed, right) {
    const left = [div().flex_none().text_size(11.5).font_medium().text_color(t.dim).child("Kraken Tasks")];
    if (this.error) {
      left.push(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.blocked).child(this.error));
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
    } else if (this.issues.length) {
      left.push(div().flex_none().text_size(10).text_color(t.muted).child(String(this.issues.length)));
    }

    const stamp = this.updated ? `Updated ${hhmm(this.updated)}` : "Never refreshed";

    const actions = [
      this.loading
        ? svg("mods/workspace-chrome/spinner.svg").size(13).flex_none().text_color(t.working).spin(900)
        : div()
            .id("issues-refresh")
            .flex_none()
            .text_color(t.dim)
            .hover((s) => s.text_color(t.foreground))
            .tooltip(`${this.repo} · ${stamp}`)
            .on_click((_e, cx) => this.refresh(cx))
            .child(svg("mods/issues/refresh.svg").size(13)),
    ];
    if (this.node) {
      actions.push(
        div()
          .id("issues-dock")
          .flex_none()
          .text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .tooltip(right ? "Move to the sidebar" : "Move to the right")
          .on_click((_e, cx) =>
            cx.spawn(async (cx) => {
              try {
                await this.dock();
              } catch (e) {
                this.error = String(e?.message ?? e);
                cx.notify();
              }
            }),
          )
          .child(svg(`mods/issues/dock-${right ? "left" : "right"}.svg`).size(13)),
      );
    }
    if (host) {
      actions.push(
        div()
          .id("issues-minimise")
          .flex_none()
          .text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .tooltip(collapsed ? "Expand" : "Minimise")
          .on_click(() => this.minimise(host, collapsed))
          .child(svg(`mods/issues/${collapsed ? "plus" : "minus"}.svg`).size(13)),
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

  sectionRows(section, t, wide) {
    if (!section.issues.length) return [];
    const head = h_flex()
      .px(10)
      .pt(8)
      .pb(2)
      .gap(5)
      .items_center()
      .text_size(10)
      .font_semibold()
      .text_color(t.dim)
      .child(section.label)
      .child(div().text_color(t.muted).child(String(section.issues.length)));

    return [head, ...section.issues.map((i) => this.row(i, t, wide))];
  }

  // The same 11px first cell the title line uses, so a glyph of any width
  // leaves the second line starting under the title.
  stateGlyph(t, attention) {
    return div()
      .w(11)
      .flex_none()
      .text_center()
      .text_color(attention ? t.blocked : t.dim)
      .child(attention ? "●" : "·");
  }

  // The issue's labels, as they are on GitHub: same names, same order, nothing
  // added, hidden or rewritten.
  badges(t, issue) {
    return issue.labels.map((label) => {
      const color = labelColor(t, label.color);
      return div().flex_none().px(4).rounded(4).bg(color + "26").text_color(color).child(label.name);
    });
  }

  // Everything the row had to truncate away, in full.
  tip(issue) {
    const lines = [`${this.repo} #${issue.number}`, issue.title];
    const labels = issue.labels.map((l) => l.name);
    if (labels.length) lines.push(labels.join(", "));
    if (issue.comments) lines.push(`${issue.comments} comment${issue.comments > 1 ? "s" : ""}`);
    lines.push(`updated ${ago(issue.updated_at)} ago`);
    return lines.join("\n");
  }

  row(issue, t, wide) {
    const attention = needsYou(issue);

    const line1 = h_flex()
      .gap(6)
      .items_center()
      .child(this.stateGlyph(t, attention))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(issue.title))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(ago(issue.updated_at)));

    const row = v_flex()
      .id(`issue-${issue.number}`)
      .px(10)
      .py(5)
      .gap(2)
      .rounded(6)
      .cursor_pointer()
      .tooltip(this.tip(issue))
      .hover((s) => s.bg(t.hover))
      // GitHub stays the place to act on an issue; this panel is the "what
      // needs me" view. open_url hands it to the system browser.
      .on_click((_e, cx) => cx.open_url(issue.url))
      .child(line1);
    if (!wide) return row;

    const second = h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .items_center()
      .truncate()
      .child(div().flex_none().text_color(t.muted).child(`#${issue.number}`))
      .children(this.badges(t, issue));
    if (issue.comments > 0) {
      second.child(div().flex_none().text_color(t.dim).child(`${issue.comments} comment${issue.comments > 1 ? "s" : ""}`));
    }

    return row.child(
      h_flex().gap(6).items_center().text_size(10.5).child(div().w(11).flex_none()).child(second),
    );
  }

  render(_cx) {
    const t = theme();
    const tree = layout();
    const right = Boolean(this.node) && parentOf(tree, this.node)?.id === RIGHT;
    // The rail is about the *sidebar* being dragged narrow; the right column
    // has its own width and never collapses to one.
    const rail = !right && narrow();
    const sections = this.sections();
    const attention = sections[0].issues.length;
    const wide = this.width >= WIDE;
    // Only a layout block can be minimised, and only the layout says which
    // node is this copy: `props.node` in the layout file. Without it (a mod
    // pane) there is nothing to resize, so the button stays away rather than
    // reaching for some other copy's block.
    const host = this.node ? find(tree, this.node) : null;
    const collapsed = Boolean(host) && host.size?.px <= COLLAPSED_MAX;

    const rows = this.issues.length
      ? sections.flatMap((s) => this.sectionRows(s, t, wide))
      : [
          div()
            .px(10)
            .py(4)
            .text_size(12)
            .text_color(this.error ? t.blocked : t.dim)
            .child(this.error ?? (this.loading ? "Loading tasks…" : "No open tasks")),
        ];

    const body = [rail ? this.rail(t, attention) : this.header(t, attention, host, collapsed, right)];
    if (!rail && !collapsed) {
      body.push(v_flex().id("issues-list").flex_1().min_h(0).px(8).gap(1).overflow_y_scrollbar().children(rows));
      if (this.limited) {
        body.push(
          div().flex_none().px(16).pb(6).text_size(10).text_color(t.dim).child(`First ${PER_PAGE} tasks`),
        );
      }
    }

    return v_flex()
      .id("issues")
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
        }
      })
      .children(body);
  }
}

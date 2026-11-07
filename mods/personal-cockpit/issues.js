// Kraken Tasks: the open issues of a coordination repo, which *are* the queue
// (kraken's PROTOCOL.md §1). Every issue in such a repo carries `kraken-task`,
// so `state=open` already means "my kraken tasks" -- no label filter needed to
// scope the list.
//
// Which repo is the person's choice, not a constant: see config.js. A fixed
// `rafael-adcp/personal-tasks` was baked in here until this mod moved to a repo.

import { div } from "gpui-kit";
import { rest, ago, agoShort } from "./github.js";
import { row } from "./kit.js";

export const panel = "issues";
export const title = "Kraken Tasks";
export const icon = "mods/personal-cockpit/issues.svg";
export const needsRepo = true;
export const refreshMs = 60000;
export const loading = "Loading tasks…";
export const empty = "No open tasks";

const PER_PAGE = 100;

// Parked on a human. These are the whole reason the panel exists, so they sort
// and draw first.
const ATTENTION = ["needs-decision", "awaiting-merge"];

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

const cacheKey = (repo) => `cockpit.issues:${repo}`;

/** The last known queue for this repo, so opening the panel is never a blank
 *  box waiting on the network. */
export function cached(repo) {
  if (!repo) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey(repo)) ?? "null");
    if (saved && Array.isArray(saved.items)) return saved;
  } catch {
    // A corrupt cache is not worth a broken panel.
  }
  return null;
}

export function save(repo, items, at) {
  if (!repo) return;
  try {
    localStorage.setItem(cacheKey(repo), JSON.stringify({ items, at }));
  } catch {
    // The cache is a nicety; losing it costs one spinner.
  }
}

/** `{ items, meta }`. Throws with a `kind` from github.js -- including
 *  "not-found", which for a private repo is what no access looks like. */
export async function load({ repo }) {
  const body = await rest(
    `repos/${repo}/issues?state=open&per_page=${PER_PAGE}&sort=updated&direction=desc`,
  );
  if (!Array.isArray(body)) throw new Error("Unexpected response from GitHub");
  // `is:issue`: the issues endpoint returns pull requests too.
  const items = body.filter((i) => !i.pull_request).map(slim);
  return { items, meta: { limited: items.length >= PER_PAGE, perPage: PER_PAGE } };
}

export function sections(items) {
  return [
    { label: "Needs you", items: items.filter(needsYou).sort(newestFirst) },
    { label: "Queue", items: items.filter((i) => !needsYou(i)).sort(newestFirst) },
  ].filter((s) => s.items.length);
}

export const attention = (items) => items.filter(needsYou).length;

export const stampNote = (meta, repo) => repo ?? null;

export const footnote = (meta) => (meta?.limited ? `First ${meta.perPage} tasks` : null);

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

// The issue's labels, as they are on GitHub: same names, same order, nothing
// added, hidden or rewritten.
const badges = (t, issue) =>
  issue.labels.map((label) => {
    const color = labelColor(t, label.color);
    return div().flex_none().px(4).rounded(4).bg(color + "26").text_color(color).child(label.name);
  });

function tooltip(repo, issue) {
  const lines = [`${repo} #${issue.number}`, issue.title];
  const labels = issue.labels.map((l) => l.name);
  if (labels.length) lines.push(labels.join(", "));
  if (issue.comments) lines.push(`${issue.comments} comment${issue.comments > 1 ? "s" : ""}`);
  lines.push(`updated ${ago(issue.updated_at)}`);
  return lines.join("\n");
}

export function rowOf(t, issue, o) {
  const mine = needsYou(issue);
  const second = [div().flex_none().text_color(t.muted).child(`#${issue.number}`), ...badges(t, issue)];
  if (issue.comments > 0) {
    second.push(
      div().flex_none().text_color(t.dim).child(`${issue.comments} comment${issue.comments > 1 ? "s" : ""}`),
    );
  }
  return row(t, {
    id: `issue-${issue.number}`,
    // The same 11px first cell the title line uses, so a glyph of any width
    // leaves the second line starting under the title.
    glyph: div().w(11).flex_none().text_center().text_color(mine ? t.blocked : t.dim).child(mine ? "●" : "·"),
    title: issue.title,
    age: agoShort(issue.updated_at),
    tooltip: tooltip(o.repo, issue),
    selected: o.selected,
    wide: o.wide,
    onClick: o.onClick,
    second,
  });
}

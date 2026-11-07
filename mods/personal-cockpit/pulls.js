// Your open pull requests: whether the build passed, how many approvals each
// has, and what else stands between it and the merge button.
//
// `viewer.pullRequests` is the PRs the authenticated person wrote, in every
// repo they can read, public and private. The search API's `author:@me` is a
// gh/web shorthand the GraphQL API doesn't expand, so this avoids it (and the
// extra call that looking up the login would cost).

import { div } from "gpui-kit";
import { graphql, ago, agoShort } from "./github.js";
import { RED, RUNNING, checkGlyph, row } from "./kit.js";

export const panel = "pulls";
// "My", because the panel below it is the same list for other people. The
// `panel` key stays "pulls": it names the layout block, the height remembered
// in shared state and the cache, and none of those are the title.
export const title = "My pull requests";
export const icon = "mods/personal-cockpit/pulls.svg";
export const needsRepo = false;
// Slow on purpose: a sidebar panel keeps its timers while hidden.
export const refreshMs = 180000;
export const loading = "Loading pull requests…";
export const empty = "No open pull requests";

const GROUPS = [
  ["attention", "Needs you"],
  ["ready", "Ready to merge"],
  ["waiting", "Waiting"],
  ["draft", "Drafts"],
];

// Counts stay small on purpose. 30 PRs of ~50 child nodes reads like about 20
// GraphQL rate-limit points a call against a budget of 5,000 an hour, which is
// what this used to say; asked with `rateLimit { cost }` it answered 1, at one
// open PR. GitHub charges per connection it has to go and fetch rather than per
// node returned, so the honest version is "cheap, and measurable" -- measure
// before adding a connection here.
const QUERY = (mergeState) => `
query {
  viewer {
    login
    pullRequests(states: OPEN, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        number title url isDraft updatedAt
        additions deletions changedFiles
        mergeable reviewDecision${mergeState ? "\n        mergeStateStatus" : ""}
        headRefName baseRefName
        repository { nameWithOwner isArchived }
        comments { totalCount }
        reviewThreads(first: 20) { nodes { isResolved } }
        latestOpinionatedReviews(first: 10) { nodes { state } }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 20) {
                  totalCount
                  nodes {
                    __typename
                    ... on CheckRun { name conclusion status }
                    ... on StatusContext { context state }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

// mergeStateStatus is still behind a preview media type.
const PREVIEW = "Accept: application/vnd.github.merge-info-preview+json";

const FAILED_RUN = ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"];

function checksOf(pr) {
  const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;
  // Null means the head commit has no checks at all, which is not a failure.
  if (!rollup) return { state: "NONE", failing: [], running: [], total: 0 };
  const nodes = rollup.contexts?.nodes ?? [];
  const failing = [], running = [];
  for (const c of nodes) {
    if (c.__typename === "CheckRun") {
      if (c.status !== "COMPLETED") running.push(c.name);
      else if (FAILED_RUN.includes(c.conclusion)) failing.push(c.name);
    } else {
      if (c.state === "PENDING" || c.state === "EXPECTED") running.push(c.context);
      else if (c.state === "FAILURE" || c.state === "ERROR") failing.push(c.context);
    }
  }
  return { state: rollup.state ?? "NONE", failing, running, total: rollup.contexts?.totalCount ?? nodes.length };
}

function shape(pr) {
  const checks = checksOf(pr);
  const approvals = (pr.latestOpinionatedReviews?.nodes ?? []).filter((r) => r.state === "APPROVED").length;
  const unresolved = (pr.reviewThreads?.nodes ?? []).filter((n) => !n.isResolved).length;
  const conflicts = pr.mergeable === "CONFLICTING";
  const changesRequested = pr.reviewDecision === "CHANGES_REQUESTED";
  // mergeStateStatus is what GitHub's own merge button goes by, so it decides
  // "ready" where it's available; without it, an approval has to stand in.
  const clean = pr.mergeStateStatus === "CLEAN";
  const behind = pr.mergeStateStatus === "BEHIND";
  const landable = !conflicts && !changesRequested && !RED(checks.state);
  const group = pr.isDraft
    ? "draft"
    : RED(checks.state) || changesRequested || conflicts
      ? "attention"
      : landable && (clean || (approvals > 0 && pr.reviewDecision === "APPROVED"))
        ? "ready"
        : "waiting";
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    draft: pr.isDraft,
    updatedAt: pr.updatedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    comments: pr.comments?.totalCount ?? 0,
    repo: pr.repository?.nameWithOwner ?? "",
    branch: pr.headRefName,
    base: pr.baseRefName,
    reviewDecision: pr.reviewDecision,
    checks, approvals, unresolved, conflicts, changesRequested, clean, behind, group,
  };
}

/** `{ items, meta }`. Throws with a `kind` from github.js. */
export async function load() {
  let data;
  try {
    data = await graphql(QUERY(true), PREVIEW);
  } catch (e) {
    // A graduated or withdrawn preview takes mergeStateStatus with it;
    // everything else on the row survives without it.
    if (!/mergeStateStatus|merge-info-preview|preview/i.test(String(e?.message ?? e))) throw e;
    data = await graphql(QUERY(false));
  }
  const prs = (data.viewer.pullRequests.nodes ?? []).filter((n) => n && !n.repository?.isArchived);
  return { items: prs.map(shape), meta: { login: data.viewer.login } };
}

export function sections(items) {
  return GROUPS.map(([group, label]) => ({ label, items: items.filter((p) => p.group === group) })).filter(
    (s) => s.items.length,
  );
}

/** How many want something from you: the number worth widening the rail for. */
export const attention = (items) => items.filter((p) => p.group === "attention").length;

export const stampNote = (meta) => meta?.login ?? null;

// What's true about this PR, most pressing first: the line truncates from the
// right, so the thing you need to act on survives a narrow sidebar.
function signals(t, pr) {
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
function tooltip(pr) {
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

export function rowOf(t, pr, o) {
  const short = pr.repo.includes("/") ? pr.repo.split("/")[1] : pr.repo;
  return row(t, {
    id: `pr-${pr.repo}-${pr.number}`,
    glyph: checkGlyph(t, pr.checks.state),
    title: pr.title,
    tag: pr.draft ? "draft" : null,
    age: agoShort(pr.updatedAt),
    tooltip: tooltip(pr),
    selected: o.selected,
    wide: o.wide,
    onClick: o.onClick,
    second: [
      div().flex_none().text_color(t.muted).child(`${short} #${pr.number}`),
      ...signals(t, pr),
      div().flex_none().text_color(t.ansi2).child(`+${pr.additions}`),
      div().flex_none().text_color(t.ansi1).child(`−${pr.deletions}`),
    ],
  });
}

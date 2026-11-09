// The made-up world the sandbox runs on.
//
// Writes the `personal-cockpit-demo.json` that github.js looks for in a Herdr
// home: a list of routes, each answering the `gh` call whose arguments contain
// its `match`. Every panel then loads for real -- the queries go out, the
// answers come back, and each panel's own `shape` judges them -- without a
// network, a login or a repository that exists.
//
// Generated rather than committed as data, for one reason: the ages on the rows
// are relative, so a file written in March would read "250d ago" in November
// and every screenshot would be of a dead queue. Run it again before shooting.
//
//   node tools/demo.mjs <herdr home>/personal-cockpit-demo.json
//
// Nothing here is anybody's: repos acme/app, acme/web and acme/tasks, the
// login `you`, teammates `robin` and `sam`. See CONTRIBUTING.md -- a screenshot
// is the likeliest way a real repository name escapes into this repository.

import { writeFileSync } from "node:fs";

const LOGIN = "you";
const REPO = "acme/app";
const TASKS = "acme/tasks";

const ago = (minutes, now) => new Date(now - minutes * 60_000).toISOString();

// ---- your pull requests (pulls.js) ----------------------------------------

const rollup = (state, contexts = []) => ({
  nodes: [{ commit: { statusCheckRollup: { state, contexts: { totalCount: contexts.length, nodes: contexts } } } }],
});

const run = (name, conclusion) => ({ __typename: "CheckRun", name, conclusion, status: "COMPLETED" });

const pr = (over, now) => ({
  number: 1,
  title: "",
  url: `https://github.com/${REPO}/pull/1`,
  isDraft: false,
  updatedAt: ago(30, now),
  additions: 20,
  deletions: 4,
  changedFiles: 2,
  mergeable: "MERGEABLE",
  mergeStateStatus: "BLOCKED",
  reviewDecision: null,
  headRefName: "work",
  baseRefName: "main",
  repository: { nameWithOwner: REPO, isArchived: false },
  comments: { totalCount: 0 },
  reviewThreads: { nodes: [] },
  latestOpinionatedReviews: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  ...over,
});

// One of each group the panel has, so a screenshot shows all four headings.
const mine = (now) => [
  pr(
    {
      number: 128,
      title: "Keep the last good list when a refresh fails",
      url: `https://github.com/${REPO}/pull/128`,
      headRefName: "keep-last-good",
      updatedAt: ago(26, now),
      additions: 86,
      deletions: 12,
      changedFiles: 4,
      comments: { totalCount: 2 },
      reviewThreads: { nodes: [{ isResolved: false }, { isResolved: false }] },
      commits: rollup("FAILURE", [run("lint", "FAILURE"), run("test", "SUCCESS")]),
    },
    now,
  ),
  pr(
    {
      number: 127,
      title: "Read the five YAML constructs the config files use",
      url: `https://github.com/${REPO}/pull/127`,
      headRefName: "yaml-subset",
      updatedAt: ago(95, now),
      additions: 176,
      deletions: 8,
      changedFiles: 3,
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] },
      commits: rollup("SUCCESS", [run("lint", "SUCCESS"), run("test", "SUCCESS")]),
    },
    now,
  ),
  pr(
    {
      number: 126,
      title: "Hand a narrow panel the rail instead of the rows",
      url: `https://github.com/${REPO}/pull/126`,
      repository: { nameWithOwner: "acme/web", isArchived: false },
      headRefName: "narrow-rail",
      updatedAt: ago(320, now),
      additions: 41,
      deletions: 23,
      changedFiles: 2,
      reviewDecision: "REVIEW_REQUIRED",
      commits: rollup("PENDING", [{ __typename: "CheckRun", name: "test", conclusion: null, status: "IN_PROGRESS" }]),
    },
    now,
  ),
  pr(
    {
      number: 125,
      title: "Split the panel chrome out of the list",
      url: `https://github.com/${REPO}/pull/125`,
      headRefName: "split-chrome",
      isDraft: true,
      updatedAt: ago(1500, now),
      additions: 304,
      deletions: 288,
      changedFiles: 9,
    },
    now,
  ),
];

// ---- the team's pull requests (team.js) -----------------------------------

const theirs = (over, now) => ({
  __typename: "PullRequest",
  number: 1,
  title: "",
  url: `https://github.com/${REPO}/pull/1`,
  isDraft: false,
  updatedAt: ago(20, now),
  additions: 12,
  deletions: 3,
  changedFiles: 1,
  mergeable: "MERGEABLE",
  reviewDecision: null,
  author: { login: "robin" },
  repository: { nameWithOwner: REPO, isArchived: false },
  comments: { totalCount: 0 },
  reviewThreads: { nodes: [] },
  latestOpinionatedReviews: { nodes: [] },
  reviewRequests: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  ...over,
});

const watched = (now) => [
  theirs(
    {
      number: 311,
      title: "Cache the issue templates per repo",
      url: `https://github.com/${REPO}/pull/311`,
      updatedAt: ago(14, now),
      additions: 24,
      // The one waiting on you, which is the whole point of the panel.
      reviewRequests: { nodes: [{ requestedReviewer: { login: LOGIN } }] },
      reviewDecision: "REVIEW_REQUIRED",
    },
    now,
  ),
  theirs(
    {
      number: 309,
      title: "Ask gh once per owner, even when the answer is empty",
      url: `https://github.com/${REPO}/pull/309`,
      author: { login: "sam" },
      updatedAt: ago(150, now),
      additions: 58,
      deletions: 31,
      changedFiles: 3,
      commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
    },
    now,
  ),
  theirs(
    {
      number: 304,
      title: "Teach the installer to copy a subfolder",
      url: `https://github.com/acme/web/pull/304`,
      author: { login: "robin" },
      repository: { nameWithOwner: "acme/web", isArchived: false },
      updatedAt: ago(600, now),
      latestOpinionatedReviews: { nodes: [{ state: "APPROVED", author: { login: LOGIN } }] },
      reviewDecision: "APPROVED",
    },
    now,
  ),
];

// ---- the task queue (issues.js and routines.js) ---------------------------

const marker = (title) => `<!-- routine ${JSON.stringify({ title })} -->`;

const task = (over, now) => ({
  number: 1,
  title: "",
  html_url: `https://github.com/${TASKS}/issues/1`,
  state: "open",
  comments: 0,
  created_at: ago(400, now),
  updated_at: ago(60, now),
  labels: [{ name: "kraken-task", color: "1d76db" }],
  body: "",
  ...over,
});

const queue = (now) => [
  task(
    {
      number: 81,
      title: "Decide whether routines get a cron field",
      html_url: `https://github.com/${TASKS}/issues/81`,
      created_at: ago(90, now),
      updated_at: ago(18, now),
      comments: 4,
      labels: [
        { name: "kraken-task", color: "1d76db" },
        { name: "project:cockpit", color: "0e8a16" },
        { name: "needs-decision", color: "d4c5f9" },
      ],
    },
    now,
  ),
  task(
    {
      number: 80,
      title: "Weekly dependency sweep",
      html_url: `https://github.com/${TASKS}/issues/80`,
      created_at: ago(240, now),
      updated_at: ago(45, now),
      comments: 1,
      labels: [
        { name: "kraken-task", color: "1d76db" },
        { name: "project:upkeep", color: "0e8a16" },
        { name: "awaiting-merge", color: "fbca04" },
      ],
      body: `### Goal\n\nEvery direct dependency is current.\n\n${marker("Weekly dependency sweep")}`,
    },
    now,
  ),
  task(
    {
      number: 79,
      title: "Prune merged branches",
      html_url: `https://github.com/${TASKS}/issues/79`,
      created_at: ago(900, now),
      updated_at: ago(500, now),
      labels: [
        { name: "kraken-task", color: "1d76db" },
        { name: "project:upkeep", color: "0e8a16" },
      ],
    },
    now,
  ),
  task(
    {
      number: 74,
      title: "Rotate the preview tokens",
      html_url: `https://github.com/${TASKS}/issues/74`,
      state: "closed",
      created_at: ago(4000, now),
      updated_at: ago(3900, now),
      labels: [
        { name: "kraken-task", color: "1d76db" },
        { name: "project:upkeep", color: "0e8a16" },
      ],
      body: `### Goal\n\nThe preview tokens are fresh.\n\n${marker("Rotate the preview tokens")}`,
    },
    now,
  ),
];

// ---- the routes -----------------------------------------------------------

/**
 * The demo file's contents.
 *
 * Order matters: a route answers when its `match` appears anywhere in the
 * arguments, and the first one wins. Your own pull requests' query also
 * contains `nameWithOwner`, so it has to come before the repo picker's route.
 */
export function demo(now = Date.now()) {
  return {
    // Read by nothing: a note for whoever finds this file in a Herdr home and
    // wonders why their panels are full of a company that does not exist.
    note: "Demo answers for the Personal Cockpit mod. Written by tools/demo.mjs. Delete it to go back to the real gh.",
    written: new Date(now).toISOString(),
    routes: [
      { match: "pullRequests", json: { data: { viewer: { login: LOGIN, pullRequests: { totalCount: 4, nodes: mine(now) } } } } },
      { match: "search(", json: { data: { search: { issueCount: 3, nodes: watched(now) } } } },
      { match: "viewer { login }", json: { data: { viewer: { login: LOGIN } } } },
      // Open and closed, newest created first: what routines.js reads to tell a
      // routine already in the queue from one that has run before.
      { match: "state=all", json: queue(now) },
      // Open only, newest updated first: the Kraken Tasks panel's own list.
      { match: "state=open", json: queue(now).filter((i) => i.state === "open") },
      { match: "ISSUE_TEMPLATE", json: [{ name: "task.yml", type: "file" }] },
      {
        match: "nameWithOwner",
        json: [
          { nameWithOwner: TASKS, isPrivate: true, updatedAt: ago(30, now) },
          { nameWithOwner: REPO, isPrivate: false, updatedAt: ago(90, now) },
          { nameWithOwner: "acme/web", isPrivate: false, updatedAt: ago(600, now) },
        ],
      },
    ],
  };
}

const [, , out] = process.argv;
if (out) {
  writeFileSync(out, `${JSON.stringify(demo(), null, 2)}\n`);
  process.stdout.write(`wrote ${out}\n`);
}

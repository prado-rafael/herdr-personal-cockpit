// list.js: the screen that runs whichever panel it was given.
//
// It knows nothing about pull requests or issues -- it asks `this.source` for a
// list and for a row, which is what makes the four panels one file instead of
// four. So these tests are about the orchestration: which source was chosen,
// what happens to a list when a poll fails, and the guards that stop two loads
// or two button presses overlapping.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { List } from "../mods/personal-cockpit/list.js";
import { host, reset } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { gh, apiCalls } from "./support/gh.js";
import { tree, panelBlock, prNode, issue } from "./support/factories.js";

const view = {};

/** The answers the pull requests panel needs. */
const pullsAnswer = (nodes = [prNode({})]) =>
  gh([["pullRequests", { data: { viewer: { login: "rafael", pullRequests: { totalCount: nodes.length, nodes } } } }]]);

/** The answers the tasks panel needs. */
const issuesAnswer = (items = [issue({})]) =>
  gh([
    ["ISSUE_TEMPLATE", []],
    ["state=open", items],
  ]);

beforeEach(() => {
  reset();
  host.layout = tree({ sidebar: [panelBlock("pulls")] });
  localStorage.clear();
});

// ---- which panel am I -----------------------------------------------------

test("the kind in the layout chooses the source", () => {
  for (const [kind, panel] of [["pulls", "pulls"], ["issues", "issues"], ["routines", "routines"], ["team", "team"]]) {
    reset();
    host.props = { kind };
    assert.equal(new List(view, cx()).source.panel, panel, kind);
  }
});

test("an unknown or missing kind is the pull requests panel", () => {
  assert.equal(new List(view, cx()).source.panel, "pulls");
  host.props = { kind: "nonsense" };
  assert.equal(new List(view, cx()).source.panel, "pulls");
});

test("the remembered height is keyed by the panel, so each keeps its own", () => {
  host.props = { kind: "team" };
  assert.equal(new List(view, cx()).heightKey, "cockpit.team.height");
  host.props = { kind: "pulls" };
  assert.equal(new List(view, cx()).heightKey, "cockpit.pulls.height");
});

test("a layout can name the block and pin an issue form outright", () => {
  host.props = { kind: "issues", node: "work-issues", template: "task.yml" };
  const list = new List(view, cx());
  assert.equal(list.node, "work-issues");
  assert.equal(list.template, "task.yml");
});

test("with no props, nothing is pinned", () => {
  const list = new List(view, cx());
  assert.equal(list.node, null);
  assert.equal(list.template, null);
});

// ---- opening the panel ----------------------------------------------------

test("a panel takes the keyboard handle and polls at its source's interval", () => {
  host.props = { kind: "team" };
  const context = cx();
  const list = new List(view, context);
  assert.equal(context.focused >= 0, true);
  assert.deepEqual(context.timers.map((t) => t.ms), [list.source.refreshMs]);
  assert.equal(list.source.refreshMs, 120000);
});

test("a repo-keyed panel opens on its cached list rather than a blank box", () => {
  host.props = { kind: "issues" };
  host.shared.set("cockpit.issues.repo", "acme/tasks");
  localStorage.setItem("cockpit.issues:acme/tasks", JSON.stringify({ items: [issue({ number: 3 })], at: 99 }));

  const list = new List(view, cx());
  assert.equal(list.state, "ok");
  assert.equal(list.items[0].number, 3);
  assert.equal(list.fetchedAt, 99);
});

test("a panel with no repo chosen asks for one instead of loading", async () => {
  host.props = { kind: "issues" };
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "no-repo");
  assert.deepEqual(apiCalls(), [], "it went to GitHub with no repo");
});

test("a panel that needs no repo loads straight away", async () => {
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "ok");
  assert.equal(list.items.length, 1);
  assert.ok(list.fetchedAt > 0);
});

test("a load writes the cache for a panel that has one", async () => {
  host.props = { kind: "issues" };
  host.shared.set("cockpit.issues.repo", "acme/tasks");
  issuesAnswer([issue({ number: 12 })]);
  const context = cx({ spawn: "run" });
  new List(view, context);
  await context.settle();
  const saved = JSON.parse(localStorage.getItem("cockpit.issues:acme/tasks"));
  assert.equal(saved.items[0].number, 12);
});

// ---- when a poll fails ----------------------------------------------------

test("one failed poll does not blank a list that was right a moment ago", async () => {
  // A dropped connection or a TLS timeout. The list is kept and called old.
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "ok");

  host.onExec = () => ({ code: 1, stdout: "", stderr: "could not resolve host" });
  await context.tick(list.source.refreshMs);

  assert.equal(list.state, "ok", "the good list was thrown away");
  assert.equal(list.items.length, 1);
  assert.match(list.stale, /could not resolve host/);
});

test("a fresh panel with nothing to keep shows the error", async () => {
  host.props = { kind: "pulls" };
  host.onExec = () => ({ code: 1, stdout: "", stderr: "could not resolve host" });
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "error");
  assert.match(list.error, /could not resolve host/);
  assert.equal(list.stale, null);
});

test("a login problem replaces the list, because the fix is a button", async () => {
  // Unlike a dropped connection: no amount of waiting fixes this one, so the
  // panel has to stop showing a list and offer the sign-in.
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.state, "ok");

  host.onExec = () => ({ code: 1, stdout: "", stderr: "HTTP 401: Bad credentials" });
  await context.tick(list.source.refreshMs);

  assert.equal(list.state, "no-auth");
  assert.equal(list.stale, null);
});

test("every kind of failure reaches the panel under its own name", async () => {
  for (const [stderr, state] of [
    ["HTTP 401: Bad credentials", "no-auth"],
    ["HTTP 404: Not Found", "not-found"],
    ["HTTP 500: Server Error", "error"],
  ]) {
    reset();
    host.props = { kind: "pulls" };
    host.onExec = () => ({ code: 1, stdout: "", stderr });
    const context = cx({ spawn: "run" });
    const list = new List(view, context);
    await context.settle();
    assert.equal(list.state, state, stderr);
  }
});

test("a poll already in flight is not started again", async () => {
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);

  // The constructor's load has not settled yet.
  list.refresh(context);
  list.refresh(context);
  await context.settle();

  assert.equal(apiCalls().length, 1, "the panel polled while it was already polling");
});

// ---- the repo changing under it -------------------------------------------

test("a new repo clears the old list and loads the new one", async () => {
  host.props = { kind: "issues" };
  host.shared.set("cockpit.issues.repo", "acme/one");
  issuesAnswer([issue({ number: 1 })]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.items[0].number, 1);

  list.repo = "acme/two";
  issuesAnswer([issue({ number: 2 })]);
  list.reload(context);
  await context.settle();
  assert.equal(list.items[0].number, 2);
});

test("losing the repo altogether asks for one again", () => {
  host.props = { kind: "issues" };
  host.shared.set("cockpit.issues.repo", "acme/one");
  const list = new List(view, cx());
  list.repo = null;
  list.reload(cx());
  assert.equal(list.state, "no-repo");
  assert.deepEqual(list.items, []);
});

// ---- a row's own button ---------------------------------------------------

test("a panel whose source has no button does nothing when pressed", async () => {
  host.props = { kind: "pulls" };
  pullsAnswer();
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  const before = apiCalls().length;
  list.act({ key: "k" }, context);
  await context.settle();
  assert.equal(apiCalls().length, before);
});

test("the spinner stays on the pressed row until the new list lands", async () => {
  // Clearing it when the work finished would put the button back for the length
  // of one round trip, on a row that still describes the old world.
  host.props = { kind: "routines" };
  host.files.set("/herdr/mods/personal-cockpit/routines.yml", [
    "coordination_repo: acme/tasks",
    "routines:",
    "  - title: Prune",
    "    project: chores",
    "    goal: g",
    "    acceptance: a",
  ].join("\n"));
  gh([
    ["POST", issue({ number: 50, body: '<!-- routine {"title":"Prune"} -->' })],
    ["state=all", []],
  ]);

  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();
  assert.equal(list.items[0].state, "ready");

  list.act(list.items[0], context);
  assert.equal(list.acting, list.items[0].key, "the row did not show it was working");

  await context.settle();
  assert.equal(list.acting, null, "the spinner outlived the refresh");
  assert.equal(list.done.key, list.items[0].key);
});

// A routine that ▶ was pressed on is remembered in routines.js for the life of
// the process, to paper over GitHub's read-after-write lag. `reset()` cannot
// clear that, so a test about pressing ▶ needs a title no other test has used
// -- otherwise the routine arrives already "open" and the button does nothing.
test("a button that failed says so on the row, not as a dead panel", async () => {
  host.props = { kind: "routines" };
  host.files.set("/herdr/mods/personal-cockpit/routines.yml", [
    "coordination_repo: acme/tasks",
    "routines:",
    "  - title: Tidy the changelog",
    "    project: chores",
    "    goal: g",
    "    acceptance: a",
  ].join("\n"));
  gh([
    ["POST", () => ({ code: 1, stdout: "", stderr: "HTTP 403: Forbidden" })],
    ["state=all", []],
  ]);

  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  list.act(list.items[0], context);
  await context.settle();

  assert.match(list.acted, /Forbidden/);
  assert.equal(list.state, "ok", "a failed button must not blank the list");
});

// ---- the gear -------------------------------------------------------------

test("the gear of a panel with its own settings opens its file", async () => {
  host.props = { kind: "team" };
  host.files.set("/herdr/mods/personal-cockpit/team.yml", "query: org:acme\n");
  gh([
    ["viewer { login }", { data: { viewer: { login: "rafael" } } }],
    ["search(", { data: { search: { issueCount: 0, nodes: [] } } }],
  ]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  list.configureWith(context);
  await context.settle();
  assert.ok(host.exec.some((call) => call.command === "xdg-open"));
});

test("the gear of the repo-keyed panel opens the picker as an overlay", () => {
  host.props = { kind: "issues" };
  const list = new List(view, cx());
  list.configure();
  assert.equal(host.overlays.length, 1);
  assert.equal(host.overlays[0].mod, "personal-cockpit");
  assert.equal(host.overlays[0].props.kind, "repo-picker");
});

// ---- drawing --------------------------------------------------------------

test("the panel renders in every state it can be in", async () => {
  for (const kind of ["pulls", "issues", "routines", "team"]) {
    for (const state of ["loading", "ok", "no-repo", "no-gh", "no-auth", "not-found", "error"]) {
      reset();
      host.layout = tree({ sidebar: [panelBlock(kind)] });
      host.props = { kind };
      const context = cx();
      const list = new List(view, context);
      list.state = state;
      list.error = "something went wrong";
      assert.doesNotThrow(() => list.render(context), `${kind} in ${state}`);
    }
  }
});

test("the panel renders a list, a stale list and a failed button", async () => {
  host.props = { kind: "pulls" };
  pullsAnswer([prNode({ number: 1 }), prNode({ number: 2, isDraft: true })]);
  const context = cx({ spawn: "run" });
  const list = new List(view, context);
  await context.settle();

  assert.doesNotThrow(() => list.render(context));
  list.stale = "could not resolve host";
  assert.doesNotThrow(() => list.render(context));
  list.acted = "HTTP 403: Forbidden";
  assert.doesNotThrow(() => list.render(context));
  list.at = 1;
  assert.doesNotThrow(() => list.render(context));
});

test("the panel renders minimised, narrow and docked right", async () => {
  host.props = { kind: "pulls", node: "pulls" };
  pullsAnswer();

  for (const layout of [
    tree({ sidebar: [panelBlock("pulls", { size: { px: 42 } })] }),
    tree({ sidebarPx: 100, sidebar: [panelBlock("pulls")] }),
    tree({ right: { id: "right-lists", type: "column", size: { px: 380 }, children: [panelBlock("pulls")] } }),
  ]) {
    host.layout = layout;
    const context = cx({ spawn: "run" });
    const list = new List(view, context);
    await context.settle();
    assert.doesNotThrow(() => list.render(context));
  }
});

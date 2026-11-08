// drawer.js: the floating "Needs you" drawer.
//
// It loads nothing. Every row on it was published by a panel that already
// fetched and already judged, so what is testable here is the drawing: when it
// shows at all, which side the peek strip goes on, what it does when something
// else is already using that edge, and that a row leads where it says.
//
// The round trip -- a panel loads, publishes, and the drawer draws what it
// published -- is at the bottom. That one is the whole design in a test: if it
// passes, the drawer cannot be telling you something no panel believes.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Drawer } from "../mods/personal-cockpit/drawer.js";
import { List } from "../mods/personal-cockpit/list.js";
import { shareKey } from "../mods/personal-cockpit/urgent.js";
import { host, reset } from "./support/host/herdr.js";
import { cx } from "./support/cx.js";
import { gh } from "./support/gh.js";
import { callsOf, handlerOf, textOf } from "./support/element.js";
import { panelBlock, placedAt, prNode, rightColumn, rollup, checkRun, tree, urgentRow } from "./support/factories.js";

const view = {};

const drawer = () => new Drawer(view, cx());

const publish = (panel, rows) => host.shared.set(shareKey(panel), rows);

/** Every `id` the drawn tree asks for, in tree order: the root first, then its
 *  children depth-first. Index 1 is therefore the first thing inside the root,
 *  which is how "the strip comes first" is asserted without reaching into the
 *  element double. */
const ids = (el) => callsOf(el, "id").map(([id]) => id);

/** Nothing drawn at all: a zero-sized element, carrying no text. */
function assertDrawsNothing(el) {
  assert.deepEqual(callsOf(el, "size"), [[0]], "expected a zero-sized element");
  assert.deepEqual(textOf(el), []);
}

beforeEach(() => {
  reset();
  host.layout = tree({ sidebar: [panelBlock("pulls")] });
  host.placement = placedAt("right");
  localStorage.clear();
});

// ---- when it shows at all -------------------------------------------------

test("no panel has published anything, so there is nothing on the edge", () => {
  assertDrawsNothing(drawer().render());
});

test("every panel published an empty list, and the edge still stays clean", () => {
  // The good case. A drawer you put things into has a reason to open while
  // empty; this one has none, so being up to date looks like nothing at all.
  for (const panel of ["pulls", "team", "issues", "routines"]) publish(panel, []);
  assertDrawsNothing(drawer().render());
});

test("one row is enough to bring it out", () => {
  publish("pulls", [urgentRow()]);
  const el = drawer().render();
  assert.ok(textOf(el).includes("Tidy the header"));
  assert.ok(textOf(el).includes("lint failing"));
});

test("junk in a shared key is ignored rather than drawn", () => {
  // Shared state is persisted, so a value written by an older copy of the mod
  // outlives it -- and `shared` hands back whatever is there.
  publish("pulls", "not a list");
  publish("team", { rows: [] });
  publish("issues", null);
  publish("routines", [urgentRow({ key: "routines:0-x", verb: "config", title: "routine 1", url: null })]);
  const el = drawer().render();
  assert.deepEqual(textOf(el).includes("routine 1"), true);
});

// ---- what it draws --------------------------------------------------------

test("it reads all four panels and heads each verb it found", () => {
  publish("pulls", [urgentRow({ key: "pulls:a#1", title: "mine" })]);
  publish("team", [urgentRow({ key: "team:a#2", verb: "review", title: "theirs", reason: "robin" })]);
  publish("issues", [urgentRow({ key: "issues:3", verb: "decide", title: "a task", reason: "needs-decision" })]);
  publish("routines", [urgentRow({ key: "routines:0-x", verb: "config", title: "routine 1", reason: "no title", url: null })]);

  const text = textOf(drawer().render());
  for (const label of ["Fix", "Review", "Decide", "Configure"]) {
    assert.ok(text.includes(label), `no ${label} heading`);
  }
  for (const title of ["mine", "theirs", "a task", "routine 1"]) {
    assert.ok(text.includes(title), `no ${title} row`);
  }
  // The total, next to the drawer's own title.
  assert.equal(text[0], "Needs you");
  assert.equal(text[1], "4");
});

test("the verbs are headed in urgent.js's order, whatever order the panels published in", () => {
  publish("routines", [urgentRow({ key: "routines:0-x", verb: "config", title: "c", url: null })]);
  publish("issues", [urgentRow({ key: "issues:3", verb: "decide", title: "d" })]);
  publish("pulls", [urgentRow({ key: "pulls:a#1", verb: "fix", title: "f" })]);

  const text = textOf(drawer().render());
  const order = ["Fix", "Decide", "Configure"].map((label) => text.indexOf(label));
  assert.deepEqual([...order].sort((a, b) => a - b), order, `headings came out as ${text.join(" ")}`);
});

test("past nine rows the rest are counted, not drawn", () => {
  // The drawer hangs over the work area: a list as tall as the window is in
  // the way rather than within reach.
  publish(
    "pulls",
    Array.from({ length: 13 }, (_v, i) => urgentRow({ key: `pulls:a#${i}`, title: `pr ${i}`, at: 1000 + i })),
  );
  const text = textOf(drawer().render());
  assert.ok(text.includes("+4 more"));
  // Dropped from the end, so the longest waits are the ones kept.
  assert.ok(text.includes("pr 0"));
  assert.equal(text.includes("pr 12"), false);
});

test("a row leads to its page, and one with no page is not pressable", () => {
  publish("pulls", [urgentRow({ at: 2 })]);
  publish("routines", [urgentRow({ key: "routines:0-x", verb: "config", title: "routine 1", url: null, at: 1 })]);

  const el = drawer().render();
  // One handler, not two: the url-less row wires no click at all, which is how
  // it avoids looking pressable.
  const clicks = callsOf(el, "on_click");
  assert.equal(clicks.length, 1);

  const context = cx();
  handlerOf(el, "on_click")({}, context);
  assert.deepEqual(context.opened, ["https://github.com/acme/app/pull/7"]);
});

// ---- the edge it hangs from ----------------------------------------------

test("on the right edge the body opens inward and the strip stays on the edge", () => {
  publish("pulls", [urgentRow()]);
  host.placement = placedAt("right");
  assert.deepEqual(ids(drawer().render()).slice(0, 2), ["cockpit-urgent", "cockpit-urgent-body"]);
});

test("dragged to the left edge, the strip and the body swap", () => {
  // Herdr lets the drawer be dragged to either side and remembers it, so both
  // ways have to be drawn -- the peek is whichever side is against the edge.
  publish("pulls", [urgentRow()]);
  host.placement = placedAt("left");
  assert.deepEqual(ids(drawer().render()).slice(0, 2), ["cockpit-urgent", "cockpit-urgent-peek"]);
});

test("on the top or bottom edge there is no strip, because there is no peek", () => {
  // `peek` is for the side edges only: on top or bottom Herdr shows the whole
  // block, so a strip would stand in front of nothing.
  publish("pulls", [urgentRow()]);
  for (const edge of ["top", "bottom"]) {
    host.placement = placedAt(edge);
    const drawn = ids(drawer().render());
    assert.equal(drawn[0], "cockpit-urgent-body", edge);
    assert.equal(drawn.includes("cockpit-urgent-peek"), false, edge);
  }
});

test("in an ordinary block it fills the block and draws no strip", () => {
  // A layout is free to put this screen in the tree instead of floating it.
  publish("pulls", [urgentRow()]);
  host.placement = null;
  const el = drawer().render();
  assert.equal(ids(el)[0], "cockpit-urgent-body");
  assert.equal(ids(el).includes("cockpit-urgent-peek"), false);
  assert.ok(callsOf(el, "size_full").length > 0, "an ordinary block should be filled");
});

// ---- getting out of the way ----------------------------------------------

test("it gives way to a panel moved into the right column", () => {
  // Both would be on the same edge, and the drawer would cover the panel
  // rather than sit beside it. Whatever it was about is counted in that
  // panel's own header anyway.
  publish("pulls", [urgentRow()]);
  host.layout = tree({ sidebar: [], right: rightColumn([panelBlock("pulls")]) });
  assertDrawsNothing(drawer().render());
});

test("an empty right column is hidden, so the drawer stays", () => {
  // dock.js hides that column rather than removing it, to keep the width it
  // was dragged to. A hidden one is not in anybody's way.
  publish("pulls", [urgentRow()]);
  host.layout = tree({ sidebar: [panelBlock("pulls")], right: { ...rightColumn([]), hidden: true } });
  assert.ok(textOf(drawer().render()).includes("Tidy the header"));
});

test("it gives way to Herdr's own files and changes panel", () => {
  publish("pulls", [urgentRow()]);
  host.layout = tree({ sidebar: [panelBlock("pulls")], right: { id: "panel", type: "column", children: [] } });
  assertDrawsNothing(drawer().render());
});

test("on the left edge it ignores what is happening on the right", () => {
  publish("pulls", [urgentRow()]);
  host.layout = tree({ sidebar: [], right: rightColumn([panelBlock("pulls")]) });
  host.placement = placedAt("left");
  assert.ok(textOf(drawer().render()).includes("Tidy the header"));
});

// ---- the round trip ------------------------------------------------------

test("a panel loads, publishes, and the drawer draws what it published", async () => {
  // The design, in one test. The drawer never calls `gh` and never judges a
  // pull request: it shows the panel's own answer, so the two cannot disagree.
  host.props = { kind: "pulls" };
  const failing = prNode({
    number: 42,
    title: "Teach the installer to copy a subfolder",
    url: "https://github.com/acme/app/pull/42",
    commits: rollup("FAILURE", [checkRun("lint", "FAILURE")]),
  });
  gh([["pullRequests", { data: { viewer: { login: "rafael", pullRequests: { totalCount: 1, nodes: [failing] } } } }]]);

  const context = cx({ spawn: "run" });
  new List(view, context);
  await context.settle();

  assert.deepEqual(host.shared.get(shareKey("pulls")), [
    {
      key: "pulls:acme/app#42",
      verb: "fix",
      title: "Teach the installer to copy a subfolder",
      reason: "lint failing",
      url: "https://github.com/acme/app/pull/42",
      at: Date.parse(failing.updatedAt),
    },
  ]);

  host.props = { kind: "urgent" };
  const text = textOf(drawer().render());
  assert.ok(text.includes("Teach the installer to copy a subfolder"));
  assert.ok(text.includes("lint failing"));
  assert.ok(text.includes("Fix"));
});

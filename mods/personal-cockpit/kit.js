// The panel chrome every list in this mod shares: the header bar, the narrow
// rail, the row, minimise, and moving between the sidebar and the right column.
//
// This file is the whole point of the mod being one folder. Both panels drew
// their own copy of all of it, word for word, down to the comments -- and then
// drifted: two `ago()` with different output, two ways to dock, a timestamp
// that was relative on one side and a wall clock on the other.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { layout, run, shared, setShared } from "herdr";

// Below this the row drops to one line: there is no room for a second.
export const WIDE = 220;
// Minimised: the header bar and nothing else (1px top border + a 41px header).
export const COLLAPSED = 42;
// Anything this short counts as minimised, however it got that way -- dragging
// the divider to a sliver means the same thing as pressing the button.
export const COLLAPSED_MAX = 60;
// Narrower than this and a panel draws the rail instead of rows.
export const RAIL_MAX = 160;

// The right-hand column of panels: a stack like the sidebar's, not one block
// filling the side. Shared with the other panels that can move there, so the
// id is a convention between them, not this mod's own. It stays in the tree
// while empty and hides instead, which is what keeps its dragged width.
export const RIGHT = "right-lists";
const RIGHT_WIDTH = 380;

// ---- the layout tree ------------------------------------------------------

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export function parentOf(node, id) {
  for (const child of node?.children ?? []) {
    if (child.id === id) return node;
    const found = parentOf(child, id);
    if (found) return found;
  }
  return null;
}

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

// Where a panel can live, found by what the nodes hold rather than by their
// names: the column with the spaces list is the sidebar, the row with the tab
// block is the work area the right column goes in. A layout shaped differently
// returns null and the move button stays hidden -- which beats the tasks
// panel's old version, that hardcoded "sidebar-lists" and broke if a layout
// renamed it.
export function destinations(tree) {
  return {
    sidebar: holdingIn(tree, (n) => n.content?.mod === "spaces"),
    work: holdingIn(tree, (n) => n.content?.tab),
    right: find(tree, RIGHT),
  };
}

// The layout block showing this copy. Two blocks now run the same mod, so the
// mod name alone no longer identifies one: the `kind` prop is what tells them
// apart. An explicit `props.node` still wins, for a layout that would rather
// say it outright.
export function hostBlockFor(tree, kind, node) {
  if (node) return find(tree, node);
  const walk = (n) => {
    if (n?.content?.props?.kind === kind) return n;
    for (const child of n?.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(tree);
}

// Which column the block sits in now, or null when this copy is a pane or an
// overlay and there is nothing to move.
export function placeOf(tree, host) {
  if (!host) return null;
  const { sidebar, work, right } = destinations(tree);
  const owner = parentOf(tree, host.id);
  if (!owner) return null;
  if (owner === sidebar) return "sidebar";
  if (owner === right) return "right";
  // Somewhere else in the layout: it can still move, as long as both ends exist.
  return sidebar && work ? "elsewhere" : null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows
// it too. Same rule the spaces and agents mods use.
export const narrowSidebar = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < RAIL_MAX;

// ---- resize and dock ------------------------------------------------------

// Minimise to the header bar rather than hiding the block: a hidden block
// leaves nothing on screen to click to bring it back.
export function minimise(host, collapsed, key) {
  if (collapsed) {
    const remembered = shared(key);
    if (typeof remembered === "number" && remembered > COLLAPSED_MAX) {
      run("layout.resize", { id: host.id, px: remembered });
    } else {
      // Never dragged, so give back the flexible share it started as.
      run("layout.resize", { id: host.id, weight: 1 });
    }
    return;
  }
  const px = host.size?.px;
  if (typeof px === "number" && px > COLLAPSED_MAX) setShared(key, px);
  run("layout.resize", { id: host.id, px: COLLAPSED });
}

// Move the block between the sidebar column and the right column. Each side
// keeps the size it had there, so going back and forth doesn't reset it. Only a
// layout the person owns accepts this: Herdr refuses structural edits to its
// own, which is why the button hides when there is nowhere to go.
export function moveTo(host, side) {
  const tree = JSON.parse(JSON.stringify(layout()));
  const { sidebar, work } = destinations(tree);
  const owner = parentOf(tree, host.id);
  if (!owner || !sidebar || !work) return;
  const at = owner.children.findIndex((c) => c.id === host.id);
  if (at < 0) return;
  const [block] = owner.children.splice(at, 1);
  // A panel in a stack: the same shape on either side, so moving it is only a
  // change of column, never a change of what it is.
  block.size = { weight: 1 };
  block.min = COLLAPSED;
  delete block.max;
  // Arriving hidden or collapsed would read as "it vanished".
  delete block.hidden;

  if (side === "right") {
    let column = find(tree, RIGHT);
    if (!column) {
      column = { id: RIGHT, type: "column", size: { px: RIGHT_WIDTH }, min: 300, max: 640, children: [] };
      work.children.push(column);
    }
    column.children.push(block);
    delete column.hidden;
  } else {
    sidebar.children.push(block);
  }

  // An empty column hides rather than goes: it keeps the width it was dragged
  // to, and the panel that moves back next lands in the same place.
  const column = find(tree, RIGHT);
  if (column) column.hidden = column.children.length === 0;
  run("layout.set", { layout: tree });
}

// ---- pieces ---------------------------------------------------------------

/** The accent pill both panels use for a count that wants attention. */
export const badge = (t, text, color = t.blocked) =>
  div()
    .flex_none()
    .px(5)
    .rounded(4)
    .bg(color + "26")
    .text_size(10)
    .font_semibold()
    .text_color(color)
    .child(String(text));

/** A primary button for the setup and empty states. */
export const button = (t, id, label, onClick) =>
  div()
    .id(id)
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

/** A header-bar icon button. */
const action = (t, id, tip, icon, onClick) =>
  div()
    .id(id)
    .flex_none()
    .text_color(t.dim)
    .hover((s) => s.text_color(t.foreground))
    .tooltip(tip)
    .on_click(onClick)
    .child(svg(icon).size(13));

export const spinner = (t, size = 13) =>
  svg("mods/workspace-chrome/spinner.svg").size(size).flex_none().text_color(t.working).spin(900);

/** The rail: no room for rows, so carry only the one number that would make
 *  someone widen the sidebar again. */
export function rail(t, icon, attention) {
  const children = [svg(icon).size(15).flex_none().text_color(attention ? t.blocked : t.dim)];
  if (attention > 0) children.push(badge(t, attention).px(4));
  return v_flex().pt(14).gap(5).flex_none().items_center().children(children);
}

/** The header bar: title, then one of trouble / attention / a plain count, then
 *  refresh, dock and minimise. */
export function header(t, o) {
  const left = [div().flex_none().text_size(11.5).font_medium().text_color(t.dim).child(o.title)];
  if (o.trouble) {
    left.push(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.blocked).tooltip(o.troubleTip ?? o.trouble).child(o.trouble));
  } else if (o.attention > 0) {
    left.push(badge(t, `${o.attention} needs you`));
  } else if (o.count) {
    left.push(div().flex_none().text_size(10).text_color(t.muted).child(String(o.count)));
  }
  if (o.note) {
    left.push(div().flex_none().text_size(10).text_color(t.dim).truncate().tooltip(o.noteTip ?? o.note).child(o.note));
  }

  const actions = [
    o.busy ? spinner(t) : action(t, `${o.id}-refresh`, o.stamp, "mods/personal-cockpit/refresh.svg", (_e, cx) => o.onRefresh(cx)),
  ];
  if (o.onConfigure) {
    actions.push(action(t, `${o.id}-configure`, o.configureTip ?? "Settings", "mods/personal-cockpit/settings.svg", (_e, cx) => o.onConfigure(cx)));
  }
  if (o.place) {
    const here = o.place === "right";
    actions.push(
      action(
        t,
        `${o.id}-move`,
        here ? "Move to the left sidebar" : "Move to the right column",
        `mods/personal-cockpit/dock-${here ? "left" : "right"}.svg`,
        () => o.onMove(here ? "sidebar" : "right"),
      ),
    );
  }
  if (o.host) {
    actions.push(
      action(
        t,
        `${o.id}-minimise`,
        o.collapsed ? "Expand" : "Minimise",
        `mods/personal-cockpit/${o.collapsed ? "plus" : "minus"}.svg`,
        () => o.onMinimise(),
      ),
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

/** A group title with its count. */
export function sectionHead(t, label, count) {
  return h_flex()
    .px(10)
    .pt(8)
    .pb(2)
    .gap(5)
    .items_center()
    .text_size(10)
    .font_semibold()
    .text_color(t.dim)
    .child(label)
    .child(div().text_color(t.muted).child(String(count)));
}

/** The glyph cell every row's first line starts with. Fixed at 11px so the
 *  second line's text lands under the title however the glyph is drawn. */
export const CELL = 11;
export const cell = () => div().w(CELL).flex_none();

/** A two-line row: a glyph, a truncating title and an age; then, when there is
 *  room, a second line of whatever the panel wants to put there. */
export function row(t, o) {
  const line1 = h_flex()
    .gap(6)
    .items_center()
    .child(o.glyph)
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(o.title))
    .when(Boolean(o.tag), (el) => el.child(div().flex_none().text_size(9.5).text_color(t.dim).child(o.tag)))
    .child(div().flex_none().text_size(10).text_color(t.dim).child(o.age));

  const el = v_flex()
    .id(o.id)
    .px(10)
    .py(5)
    .gap(2)
    .rounded(6)
    .cursor_pointer()
    .tooltip(o.tooltip)
    .when(Boolean(o.selected), (e) => e.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    .on_click(o.onClick)
    .child(line1);

  if (!o.wide || !o.second?.length) return el;
  return el.child(
    h_flex()
      .gap(6)
      .items_center()
      .text_size(10.5)
      .child(cell())
      .child(h_flex().flex_1().min_w(0).gap(5).items_center().truncate().children(o.second)),
  );
}

/** The panel shell: the root element, focus, size reporting and the keys both
 *  lists answer. The caller passes the body it wants inside. */
export function shell(t, o) {
  return v_flex()
    .id(o.id)
    .size_full()
    .min_h(0)
    .bg(t.chrome)
    .border_t(1)
    .border_color(t.border)
    .text_size(13)
    .track_focus(o.handle)
    .on_size_change((size, cx) => o.onSize(size, cx))
    .on_key_down((e, cx) => o.onKey(e, cx))
    .children(o.body);
}

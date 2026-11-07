// One mod, several screens, chosen by `props.kind`.
//
// `kind` is what lets two layout blocks run the same mod and still be two
// different panels -- and what lets the mod open its own repo dialog as an
// overlay instead of needing a second mod folder for it.
//
//   { "mod": "personal-cockpit", "props": { "kind": "pulls" } }     your pull requests
//   { "mod": "personal-cockpit", "props": { "kind": "issues" } }    Kraken Tasks
//   openOverlay({ mod: "personal-cockpit", props: { kind: "repo-picker", ... } })
//
// Add a screen by writing its module and naming it here. Nothing else in the
// mod has to know.

import { View } from "gpui-kit";
import { props } from "herdr";
import { List } from "./list.js";
import { Picker } from "./picker.js";

export default class Cockpit extends View {
  init(_props, cx) {
    // The screens are plain classes, not Views: one exported View per mod is
    // the rule, and a screen needs no lifecycle of its own beyond the `cx` it
    // is handed here.
    this.screen = props()?.kind === "repo-picker" ? new Picker(this, cx) : new List(this, cx);
  }

  render(cx) {
    return this.screen.render(cx);
  }
}

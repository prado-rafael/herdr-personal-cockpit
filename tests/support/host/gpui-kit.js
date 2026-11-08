// `gpui-kit`, as much of it as this mod names.
import { element } from "../element.js";

export class View {
  constructor(...args) {
    if (typeof this.init === "function") this.init(...args);
  }
}

export const div = () => element();
export const svg = () => element();

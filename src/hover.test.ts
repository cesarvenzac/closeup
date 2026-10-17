import { describe, expect, it } from "vitest";

import { markSelector } from "./hover.ts";

describe("markSelector", () => {
  it("swaps :hover and :active for Closeup's attributes, wherever they are", () => {
    expect(markSelector("a:hover")).toBe("a[data-closeup-hover]");
    expect(markSelector(".group-hover\\:x:is(:where(.group):hover *)")).toBe(".group-hover\\:x:is(:where(.group)[data-closeup-hover] *)");
    expect(markSelector("button:active, .b:not(:hover)")).toBe("button[data-closeup-active], .b:not([data-closeup-hover])");
  });

  it("leaves lookalikes alone", () => {
    expect(markSelector(".hover\\:bg")).toBe(".hover\\:bg");
    expect(markSelector("a:hovered, a:active-thing")).toBe("a:hovered, a:active-thing");
  });
});

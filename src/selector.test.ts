import { describe, expect, it } from "vitest";

import { isStableId, isUtility } from "./selector.ts";

describe("naming elements", () => {
  it("passes over ids a framework makes up per render", () => {
    expect(isStableId("closeup-set")).toBe(true);
    expect(isStableId("main")).toBe(true);
    for (const id of ["_R_kqihrqatpesndaitmlb_", ":r3:", "«r1»", "radix-:R1:", "base-ui-_R_kqihrqatpesndaitmlb_", "headlessui-menu-3", "mui-12", "react-aria-5", "row-1234", ""]) {
      expect(isStableId(id), id).toBe(false);
    }
  });

  it("passes over classes that only style", () => {
    expect(isUtility("closeup-cloud")).toBe(false);
    expect(isUtility("mascot-body")).toBe(false);
    expect(isUtility("border-cloud")).toBe(true);
    expect(isUtility("bordered-card")).toBe(false);
    for (const name of ["mt-4", "text-sm", "flex", "hover:bg-muted", "w-[42px]", "md:grid", "rounded-xl", "border", "rounded"]) expect(isUtility(name), name).toBe(true);
  });
});

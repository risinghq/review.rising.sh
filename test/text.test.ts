import { describe, expect, it } from "vitest";

import { normalise, sameText } from "../src/text.ts";

describe("sameText", () => {
  it("ignores style commands, spacing and braces", () => {
    expect(sameText("$\\left( x \\right)^{2}$", "$(x)^2$")).toBe(true);
  });
  it("keeps a real difference", () => {
    expect(sameText("$n$", "$m$")).toBe(false);
  });
  it("drops spacing commands", () => {
    expect(normalise("\\displaystyle a \\, b")).toBe("ab");
  });
});

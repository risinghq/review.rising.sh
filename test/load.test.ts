import { describe, expect, it } from "vitest";

import { insertion, parseChunk } from "../scripts/chunk.ts";
import { memoryD1 } from "./d1.ts";

const machine = `---
status: machine
source: 02---continuous-random
page: 5
sharpness: 155.9
agreement: 0.99
---
Next we compute:

---

$$\\langle x\\rangle = \\frac{b+a}{2}$$
`;

const disputed = `---
status: disputed
source: 02---continuous-random
page: 8
sharpness: 31.7
agreement: 0.91
alt: |
  The Bernoulli
  distribution
---
The Bernoulli distribution
`;

describe("parseChunk", () => {
  it("takes the source from the store folder and keeps a rule inside the text", () => {
    const chunk = parseChunk("landi-02", "p05-c01", machine);
    expect(chunk).toMatchObject({ id: "landi-02/p05-c01", source: "landi-02", page: 5, status: "machine", alt: null });
    expect(chunk.sharpness).toBe(155.9);
    expect(chunk.text).toBe("Next we compute:\n\n---\n\n$$\\langle x\\rangle = \\frac{b+a}{2}$$");
  });

  it("reads pass B of a disputed chunk", () => {
    expect(parseChunk("landi-02", "p08-c01", disputed)).toMatchObject({
      status: "disputed",
      alt: "The Bernoulli\ndistribution",
      text: "The Bernoulli distribution",
    });
  });

  it("refuses a file without front matter", () => {
    expect(() => parseChunk("landi-02", "p01-c01", "text only")).toThrow("no front matter");
  });
});

describe("insertion", () => {
  it("loads a chunk once and leaves a reviewed one alone", async () => {
    const db = memoryD1();
    const { sql, params } = insertion(parseChunk("landi-02", "p05-c01", machine));
    await db.prepare(sql).bind(...params).run();
    await db.prepare("UPDATE chunks SET status = 'checked'").run();
    await db.prepare(sql).bind(...params).run();
    const rows = (await db.prepare("SELECT status FROM chunks").all<{ status: string }>()).results;
    expect(rows).toEqual([{ status: "checked" }]);
  });
});

import { describe, expect, it } from "vitest";
import { shortEntrantUrl } from "@/lib/share/posts";

describe("shortEntrantUrl", () => {
  it("builds site/p/handle without a tournament slug", () => {
    expect(shortEntrantUrl("zepeddies", "https://www.bestofclt.com/")).toBe("https://www.bestofclt.com/p/zepeddies");
    expect(shortEntrantUrl("pie_zaa", "https://bestofclt.com")).toBe("https://bestofclt.com/p/pie_zaa");
  });
});

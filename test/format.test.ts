import { describe, expect, it } from "vitest";
import {
  abstractPreview,
  directSupplementLinks,
  formatRecordFields,
  plainText,
  pruneEmpty,
  slugifyTitle,
} from "../src/format.js";

describe("token-saving transforms", () => {
  it("normalizes titles into readable bounded slugs", () => {
    expect(slugifyTitle("Landau–Zener: Démonstration / Results")).toBe(
      "landau-zener-demonstration-results",
    );
    expect(slugifyTitle("量子センシング")).toBe("");
    const slug = slugifyTitle("word ".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(96);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("removes markup and compacts abstract whitespace", () => {
    expect(plainText("A <sup>2</sup>  &amp;\n B")).toBe("A 2 & B");
    const preview = abstractPreview("word ".repeat(300));
    expect(preview?.truncated).toBe(true);
    expect(preview?.text).toContain("chars total");
  });

  it("keeps list defaults compact and strips empty API fields", () => {
    const formatted = formatRecordFields(
      {
        osti_id: "42",
        title: " Test  Record ",
        publication_date: "2026-08-01T00:00:00Z",
        doi: "",
        links: [{ rel: "fulltext", href: "https://www.osti.gov/servlets/purl/42" }],
      },
      ["id", "title", "date", "has_fulltext", "doi"],
    );
    expect(formatted).toEqual({
      id: "42",
      title: "Test Record",
      date: "2026-08-01",
      has_fulltext: true,
    });
    expect(pruneEmpty({ a: null, b: "", c: [], d: { ok: true } })).toEqual({ d: { ok: true } });
  });

  it("selects only direct supplemental relation types", () => {
    const links = directSupplementLinks({
      links: [
        { rel: "supplemental_data", href: "https://www.osti.gov/file.zip" },
        { rel: "attachment-1", href: "https://www.osti.gov/file.csv" },
        { rel: "citation_doe_dataexplorer", href: "https://www.osti.gov/dataexplorer/1" },
        { rel: "supplement", href: "http://insecure.example/file" },
      ],
    });
    expect(links.map((link) => link.rel)).toEqual(["supplemental_data", "attachment-1"]);
  });
});

import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import {
  parseSearchArgs,
  parseDigestArgs,
  parseDownloadArgs,
} from "../src/args.js";

describe("argument parsing", () => {
  it("parses agent-friendly multi-token search queries and flags", () => {
    expect(
      parseSearchArgs([
        "quantum",
        "sensing",
        "--limit=25",
        "--page",
        "2",
        "--fields",
        "id,title,doi",
        "--fulltext-only",
        "--sort",
        "newest",
      ]),
    ).toEqual({
      query: "quantum sensing",
      limit: 25,
      page: 2,
      fields: ["id", "title", "doi"],
      hasFulltext: true,
      sort: "newest",
    });
  });

  it("parses every documented OSTI search criterion without requiring a general query", () => {
    const parsed = parseSearchArgs([
      "--osti-id", "123",
      "--doi", "10.1000/test",
      "--fulltext", "neutron flux",
      "--biblio", "conference",
      "--author", "Chen, Kun",
      "--title", "reactor safety",
      "--identifier", "DE-AC05-00OR22725",
      "--sponsor-org", "DOE",
      "--research-org", "ORNL",
      "--contributing-org", "LANL",
      "--source-id", "S-123",
      "--publication-from", "01/01/2020",
      "--publication-to", "12/31/2024",
      "--entry-from", "02/01/2020",
      "--entry-to", "01/31/2025",
      "--language", "English",
      "--country", "United States",
      "--site-ownership-code", "DOE",
      "--subject", "quantum sensing",
      "--has-fulltext", "false",
      "--sort", "entry_date",
      "--order", "asc",
    ]);

    expect(parsed).toMatchObject({
      ostiId: "123",
      doi: "10.1000/test",
      fulltext: "neutron flux",
      biblio: "conference",
      author: "Chen, Kun",
      title: "reactor safety",
      identifier: "DE-AC05-00OR22725",
      sponsorOrg: "DOE",
      researchOrg: "ORNL",
      contributingOrg: "LANL",
      sourceId: "S-123",
      publicationFrom: "01/01/2020",
      publicationTo: "12/31/2024",
      entryFrom: "02/01/2020",
      entryTo: "01/31/2025",
      language: "English",
      country: "United States",
      siteOwnershipCode: "DOE",
      subject: "quantum sensing",
      hasFulltext: false,
      sort: "entry_date",
      order: "asc",
    });
    expect(parsed.query).toBeUndefined();
  });

  it("rejects invalid search dates, ranges, sort order, and conflicting aliases", () => {
    expect(() => parseSearchArgs(["--publication-from", "2020-01-01"]))
      .toThrow("--publication-from must use MM/DD/YYYY");
    expect(() => parseSearchArgs([
      "--entry-from", "12/31/2025", "--entry-to", "01/01/2025",
    ])).toThrow("--entry-from must not be later than --entry-to");
    expect(() => parseSearchArgs(["--order", "desc"]))
      .toThrow("--order requires --sort");
    expect(() => parseSearchArgs(["--fulltext-only", "--has-fulltext", "false"]))
      .toThrow("Use either --fulltext-only or --has-fulltext, not both");
  });

  it("rejects unknown flags before execution with usage exit semantics", () => {
    expect(() => parseSearchArgs(["fusion", "--rows", "50"])).toThrowError(AxiError);
    try {
      parseSearchArgs(["fusion", "--rows", "50"]);
    } catch (error) {
      expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
      expect((error as AxiError).suggestions.join(" ")).toContain("--limit");
    }
  });

  it("accepts both numeric and product-prefixed OSTI IDs", () => {
    expect(parseDigestArgs(["3376511"])).toEqual({ id: "3376511", full: false });
    expect(parseDigestArgs(["code-189731", "--full"])).toEqual({
      id: "code-189731",
      full: true,
    });
  });

  it("uses the agreed download defaults and optional guardrail", () => {
    expect(parseDownloadArgs(["1", "2"])).toEqual({
      ids: ["1", "2"],
      format: "both",
      outDir: "osti-downloads",
      includeSupplements: false,
      concurrency: 3,
      force: false,
    });
    expect(parseDownloadArgs(["1", "--max-mb", "512", "--include-supplements"]))
      .toMatchObject({ maxMb: 512, includeSupplements: true });
  });

  it("accepts only canonical space-delimited OSTI ID lists", () => {
    expect(parseDownloadArgs(["2569708", "3367522"]).ids).toEqual([
      "2569708",
      "3367522",
    ]);
    expect(() => parseDownloadArgs(["2569708,", "3367522"])).toThrow(
      "OSTI IDs must be space-delimited; commas are not accepted",
    );
    try {
      parseDownloadArgs(["2569708,3367522"]);
    } catch (error) {
      expect(error).toMatchObject({
        code: "VALIDATION_ERROR",
        suggestions: ["Run `osti-axi download 2569708 3367522`"],
      });
    }
  });
});

import { describe, expect, it } from "vitest";
import { commandRows, nextActions, renderSections } from "../src/render.js";

describe("readable TOON rendering", () => {
  it("adds blank lines only between top-level sections", () => {
    expect(
      renderSections({
        query: "fusion",
        results: [{ id: "1", title: "First" }],
        "[AXI-NEXT]": nextActions(["Run one", "Run two"]),
      }),
    ).toBe(
      [
        "query: fusion",
        "",
        "results[1]{id,title}:",
        '  "1",First',
        "",
        '"[AXI-NEXT]"[2]{command}:',
        "  Run one",
        "  Run two",
      ].join("\n"),
    );
  });

  it("renders examples as one command per line", () => {
    expect(renderSections({
      examples: commandRows(["osti-axi search fusion", "osti-axi digest 123"]),
    })).toBe([
      "examples[2]{command}:",
      "  osti-axi search fusion",
      "  osti-axi digest 123",
    ].join("\n"));
  });
});

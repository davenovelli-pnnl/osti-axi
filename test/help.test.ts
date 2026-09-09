import { describe, expect, it } from "vitest";
import { commandHelp, TOP_LEVEL_HELP } from "../src/help.js";
import { SEARCH_FLAGS } from "../src/args.js";

describe("help", () => {
  it("top-level help advertises the search command and every search filter", () => {
    expect(TOP_LEVEL_HELP).toContain("search:");
    expect(TOP_LEVEL_HELP).toContain("search_filters:");
    for (const flag of SEARCH_FLAGS) expect(TOP_LEVEL_HELP).toContain(flag);
    expect(TOP_LEVEL_HELP).not.toContain("concept");
  });

  it("search --help documents every accepted flag", () => {
    const help = commandHelp("search");
    expect(help).toBeDefined();
    for (const flag of SEARCH_FLAGS) expect(help).toContain(flag);
    expect(commandHelp("concept")).toBeUndefined();
  });
});

import { AxiError, exitCodeForError, runAxiCli } from "axi-sdk-js";
import {
  DEFAULT_SEARCH_FIELDS,
  parseSearchArgs,
  parseDigestArgs,
  parseDownloadArgs,
  type SearchArgs,
} from "./args.js";
import { downloadRecords } from "./download.js";
import {
  abstractPreview,
  formatDigest,
  formatRecordFields,
  pruneEmpty,
  shellQuote,
} from "./format.js";
import { commandHelp, TOP_LEVEL_HELP } from "./help.js";
import { OstiClient } from "./osti.js";
import { nextActions, renderSections } from "./render.js";
import { VERSION } from "./version.js";

const DESCRIPTION = "Search OSTI.GOV, inspect records, and download selected full text";
const SEARCH_FILTER_FLAGS = [
  ["ostiId", "--osti-id"],
  ["doi", "--doi"],
  ["fulltext", "--fulltext"],
  ["biblio", "--biblio"],
  ["author", "--author"],
  ["title", "--title"],
  ["identifier", "--identifier"],
  ["sponsorOrg", "--sponsor-org"],
  ["researchOrg", "--research-org"],
  ["contributingOrg", "--contributing-org"],
  ["sourceId", "--source-id"],
  ["publicationFrom", "--publication-from"],
  ["publicationTo", "--publication-to"],
  ["entryFrom", "--entry-from"],
  ["entryTo", "--entry-to"],
  ["language", "--language"],
  ["country", "--country"],
  ["siteOwnershipCode", "--site-ownership-code"],
  ["subject", "--subject"],
] as const satisfies readonly (readonly [keyof SearchArgs, string])[];

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const client = new OstiClient();

  await runAxiCli({
    description: DESCRIPTION,
    version: VERSION,
    argv,
    topLevelHelp: TOP_LEVEL_HELP,
    getCommandHelp: commandHelp,
    formatError: (error) => formatCliError(error),
    renderUnknownCommand: (command) =>
      `${renderSections(
        command === "concept"
          ? {
              error: "`concept` was renamed; use `search` instead",
              code: "VALIDATION_ERROR",
              help: [{ command: "Run `osti-axi search --help` for the search reference" }],
            }
          : {
              error: `Unknown command: ${command}`,
              code: "VALIDATION_ERROR",
              help: [{ command: "Run `osti-axi --help` to see available commands" }],
            },
      )}\n`,
    home: async () => {
      const result = await client.search({ limit: 5, page: 1, sort: "recent-entry" });
      const records = result.records.map((record) =>
        formatRecordFields(record, DEFAULT_SEARCH_FIELDS),
      );
      return `\n${renderSections(pruneOutput({
        count: `${records.length} of ${result.total} total`,
        recent: records.length > 0 ? records : "0 recent OSTI records found",
        "[AXI-NEXT]": nextActions([
          'Run `osti-axi search "<terms>"` to search the repository',
          "Run `osti-axi digest <osti_id>` to inspect a record",
        ]),
      }))}`;
    },
    commands: {
      search: async (args) => {
        const parsed = parseSearchArgs(args);
        const { fields, ...searchOptions } = parsed;
        const result = await client.search(searchOptions);
        const records = result.records.map((record) =>
          formatRecordFields(record, fields),
        );
        const next: string[] = [];
        if (records.length > 0) {
          next.push("Run `osti-axi digest <osti_id>` for the abstract and resource links");
          next.push("Run `osti-axi download <osti_id>` to save OSTI-provided PDF and text");
        }
        if (parsed.page * parsed.limit < result.total) {
          next.push(`Run \`${nextPageCommand(parsed)}\` for the next page`);
        }
        return renderSections(pruneOutput({
          query: parsed.query,
          filters: appliedFilters(parsed),
          sort: parsed.sort === "relevance" ? undefined : parsed.sort,
          order: parsed.order,
          count: `${records.length} of ${result.total} total`,
          page: parsed.page,
          results: records.length > 0 ? records : emptySearchMessage(parsed),
          "[AXI-NEXT]": nextActions(next),
        }));
      },
      digest: async (args) => {
        const parsed = parseDigestArgs(args);
        const record = await client.record(parsed.id);
        const detail = parsed.fields
          ? formatRecordFields(record, parsed.fields, parsed.full)
          : formatDigest(record, parsed.full);
        const next: string[] = [];
        const preview =
          !parsed.fields || parsed.fields.includes("abstract")
            ? abstractPreview(record.description, parsed.full)
            : undefined;
        if (preview?.truncated) {
          next.push(`Run \`osti-axi digest ${parsed.id} --full\` for the complete abstract`);
        }
        if (formatRecordFields(record, ["has_fulltext"]).has_fulltext) {
          next.push(`Run \`osti-axi download ${parsed.id}\` to save PDF and text representations`);
        }
        return renderSections(pruneOutput({ record: detail, "[AXI-NEXT]": nextActions(next) }));
      },
      download: async (args) => {
        const parsed = parseDownloadArgs(args);
        const batch = await downloadRecords(parsed, { client });
        const saved = batch.artifacts.filter((artifact) => artifact.status === "saved").length;
        const existing = batch.artifacts.filter((artifact) => artifact.status === "existing").length;
        const output: Record<string, unknown> = {
          download: {
            requested_records: parsed.ids.length,
            saved,
            existing,
            failed: batch.failures.length,
            directory: batch.outputDirectory,
          },
          artifacts: batch.artifacts,
          failures: batch.failures,
        };
        if (batch.failures.length > 0) {
          process.exitCode = 1;
          output.error = `${batch.failures.length} requested artifact operation${batch.failures.length === 1 ? "" : "s"} failed`;
          output.code = "PARTIAL_DOWNLOAD";
        }
        return renderSections(pruneOutput(output));
      },
    },
  });
}

function appliedFilters(parsed: SearchArgs): Record<string, string | boolean> {
  const filters: Record<string, string | boolean> = {};
  for (const [option, flag] of SEARCH_FILTER_FLAGS) {
    const value = parsed[option];
    if (typeof value === "string") {
      filters[flag.slice(2).replaceAll("-", "_")] = value;
    }
  }
  if (parsed.hasFulltext !== undefined) filters.has_fulltext = parsed.hasFulltext;
  return filters;
}

function emptySearchMessage(parsed: SearchArgs): string {
  if (parsed.query) return `0 records found for ${parsed.query}`;
  if (Object.keys(appliedFilters(parsed)).length > 0) {
    return "0 records found for supplied filters";
  }
  return "0 OSTI records found";
}

function nextPageCommand(parsed: SearchArgs): string {
  const parts = ["osti-axi search"];
  if (parsed.query) parts.push(shellQuote(parsed.query));
  for (const [option, flag] of SEARCH_FILTER_FLAGS) {
    const value = parsed[option];
    if (typeof value === "string") parts.push(`${flag} ${shellQuote(value)}`);
  }
  if (parsed.hasFulltext !== undefined) {
    parts.push(`--has-fulltext ${parsed.hasFulltext}`);
  }
  if (parsed.sort && parsed.sort !== "relevance") {
    parts.push(`--sort ${shellQuote(parsed.sort)}`);
  }
  if (parsed.order) parts.push(`--order ${parsed.order}`);
  parts.push(`--page ${parsed.page + 1}`, `--limit ${parsed.limit}`);
  if (parsed.fields.join(",") !== DEFAULT_SEARCH_FIELDS.join(",")) {
    parts.push(`--fields ${parsed.fields.join(",")}`);
  }
  return parts.join(" ");
}

function pruneOutput(value: Record<string, unknown>): Record<string, unknown> {
  return (pruneEmpty(value) ?? {}) as Record<string, unknown>;
}

function formatCliError(error: unknown): { output: string; exitCode: number } {
  if (error instanceof AxiError) {
    return {
      output: `${renderSections(pruneOutput({
        error: error.message,
        code: error.code,
        help: error.suggestions.map((command) => ({ command })),
      }))}\n`,
      exitCode: exitCodeForError(error),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    output: `${renderSections({ error: message, code: "UNKNOWN" })}\n`,
    exitCode: 1,
  };
}

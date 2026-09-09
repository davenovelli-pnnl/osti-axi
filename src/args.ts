import { AxiError } from "axi-sdk-js";
import type {
  SearchField,
  DownloadFormat,
  DownloadOptions,
  SearchOptions,
} from "./types.js";

export const SEARCH_FIELDS: readonly SearchField[] = [
  "id",
  "title",
  "date",
  "has_fulltext",
  "type",
  "authors",
  "doi",
  "subjects",
  "abstract",
  "citation_url",
  "fulltext_url",
];

export const DEFAULT_SEARCH_FIELDS: readonly SearchField[] = [
  "id",
  "title",
  "date",
  "has_fulltext",
];

interface ParsedToken {
  flag: string;
  inlineValue?: string;
}

function splitFlag(token: string): ParsedToken {
  const equals = token.indexOf("=");
  if (equals === -1) return { flag: token };
  return { flag: token.slice(0, equals), inlineValue: token.slice(equals + 1) };
}

function flagValue(
  args: string[],
  index: number,
  parsed: ParsedToken,
  command: string,
): { value: string; consumed: number } {
  if (parsed.inlineValue !== undefined) {
    if (!parsed.inlineValue) usageError(`${parsed.flag} requires a value`, command);
    return { value: parsed.inlineValue, consumed: 0 };
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    usageError(`${parsed.flag} requires a value`, command);
  }
  return { value, consumed: 1 };
}

function positiveInteger(
  value: string,
  flag: string,
  command: string,
  max?: number,
): number {
  if (!/^[1-9]\d*$/.test(value)) {
    usageError(`${flag} must be a positive integer`, command);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (max !== undefined && number > max)) {
    usageError(`${flag} must be between 1 and ${max ?? Number.MAX_SAFE_INTEGER}`, command);
  }
  return number;
}

function positiveNumber(value: string, flag: string, command: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    usageError(`${flag} must be a positive number`, command);
  }
  return number;
}

function usageError(message: string, command: string): never {
  throw new AxiError(message, "VALIDATION_ERROR", [
    `Run \`osti-axi ${command} --help\` for valid arguments and examples`,
  ]);
}

function unknownFlag(flag: string, command: string, valid: string[]): never {
  throw new AxiError(`Unknown flag ${flag} for \`${command}\``, "VALIDATION_ERROR", [
    `Valid flags: ${valid.join(", ")}`,
    `Run \`osti-axi ${command} --help\` for the complete command reference`,
  ]);
}

function parseFields(value: string, command: string): SearchField[] {
  const fields = value.split(",").map((field) => field.trim()).filter(Boolean);
  if (fields.length === 0) usageError("--fields requires at least one field", command);
  const invalid = fields.filter(
    (field): field is string => !SEARCH_FIELDS.includes(field as SearchField),
  );
  if (invalid.length > 0) {
    throw new AxiError(
      `Unknown field${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}`,
      "VALIDATION_ERROR",
      [`Valid fields: ${SEARCH_FIELDS.join(", ")}`],
    );
  }
  return [...new Set(fields)] as SearchField[];
}

export interface SearchArgs extends SearchOptions {
  fields: SearchField[];
}

const SEARCH_VALUE_FLAGS = {
  "--osti-id": "ostiId",
  "--doi": "doi",
  "--fulltext": "fulltext",
  "--biblio": "biblio",
  "--author": "author",
  "--title": "title",
  "--identifier": "identifier",
  "--sponsor-org": "sponsorOrg",
  "--research-org": "researchOrg",
  "--contributing-org": "contributingOrg",
  "--source-id": "sourceId",
  "--publication-from": "publicationFrom",
  "--publication-to": "publicationTo",
  "--entry-from": "entryFrom",
  "--entry-to": "entryTo",
  "--language": "language",
  "--country": "country",
  "--site-ownership-code": "siteOwnershipCode",
  "--subject": "subject",
} as const;

type SearchValueFlag = keyof typeof SEARCH_VALUE_FLAGS;
type SearchStringOption = (typeof SEARCH_VALUE_FLAGS)[SearchValueFlag];

export const SEARCH_FLAGS = [
  "--limit",
  "--page",
  "--fields",
  "--fulltext-only",
  "--has-fulltext",
  "--sort",
  "--order",
  ...Object.keys(SEARCH_VALUE_FLAGS),
] as const;

function apiDate(value: string, flag: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  if (!match) usageError(`${flag} must use MM/DD/YYYY`, "search");
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    usageError(`${flag} must be a valid date in MM/DD/YYYY format`, "search");
  }
  return value;
}

function booleanValue(value: string, flag: string): boolean {
  if (value !== "true" && value !== "false") {
    usageError(`${flag} must be true or false`, "search");
  }
  return value === "true";
}

function assertDateRange(
  start: string | undefined,
  end: string | undefined,
  startFlag: string,
  endFlag: string,
): void {
  if (!start || !end) return;
  const toTime = (value: string): number => {
    const [month, day, year] = value.split("/").map(Number) as [number, number, number];
    return Date.UTC(year, month - 1, day);
  };
  if (toTime(start) > toTime(end)) {
    usageError(`${startFlag} must not be later than ${endFlag}`, "search");
  }
}

export function parseSearchArgs(args: string[]): SearchArgs {
  const query: string[] = [];
  let limit = 10;
  let page = 1;
  let fields = [...DEFAULT_SEARCH_FIELDS];
  const options: Partial<Record<SearchStringOption, string>> = {};
  let hasFulltext: boolean | undefined;
  let usedFulltextAlias = false;
  let sort: string | undefined;
  let order: "asc" | "desc" | undefined;
  const seen = new Set<string>();
  const valid: string[] = [...SEARCH_FLAGS];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith("--")) {
      query.push(token);
      continue;
    }
    const parsed = splitFlag(token);
    if (parsed.flag === "--fulltext-only") {
      if (parsed.inlineValue !== undefined) usageError("--fulltext-only takes no value", "search");
      if (seen.has(parsed.flag)) usageError("--fulltext-only may only be specified once", "search");
      if (seen.has("--has-fulltext")) {
        usageError("Use either --fulltext-only or --has-fulltext, not both", "search");
      }
      seen.add(parsed.flag);
      hasFulltext = true;
      usedFulltextAlias = true;
      continue;
    }
    if (!valid.includes(parsed.flag)) unknownFlag(parsed.flag, "search", valid);
    if (seen.has(parsed.flag)) usageError(`${parsed.flag} may only be specified once`, "search");
    if (parsed.flag === "--has-fulltext" && usedFulltextAlias) {
      usageError("Use either --fulltext-only or --has-fulltext, not both", "search");
    }
    seen.add(parsed.flag);
    const { value, consumed } = flagValue(args, index, parsed, "search");
    index += consumed;
    if (parsed.flag === "--limit") limit = positiveInteger(value, "--limit", "search", 100);
    if (parsed.flag === "--page") page = positiveInteger(value, "--page", "search");
    if (parsed.flag === "--fields") fields = parseFields(value, "search");
    if (parsed.flag === "--has-fulltext") hasFulltext = booleanValue(value, parsed.flag);
    if (parsed.flag === "--sort") sort = value;
    if (parsed.flag === "--order") {
      if (value !== "asc" && value !== "desc") usageError("--order must be asc or desc", "search");
      order = value;
    }
    if (parsed.flag in SEARCH_VALUE_FLAGS) {
      const option = SEARCH_VALUE_FLAGS[parsed.flag as SearchValueFlag];
      options[option] = /^(--publication|--entry)-(from|to)$/u.test(parsed.flag)
        ? apiDate(value, parsed.flag)
        : value;
    }
  }

  const joined = query.join(" ").trim();
  if (order && !sort) usageError("--order requires --sort", "search");
  if (sort === "relevance" && order) {
    usageError("--order cannot be used with --sort relevance", "search");
  }
  assertDateRange(
    options.publicationFrom,
    options.publicationTo,
    "--publication-from",
    "--publication-to",
  );
  assertDateRange(options.entryFrom, options.entryTo, "--entry-from", "--entry-to");

  const result = { limit, page, fields } as SearchArgs;
  Object.assign(result, options);
  if (joined) result.query = joined;
  if (hasFulltext !== undefined) result.hasFulltext = hasFulltext;
  if (sort !== undefined) result.sort = sort;
  if (order !== undefined) result.order = order;
  return result;
}

export interface DigestArgs {
  id: string;
  full: boolean;
  fields?: SearchField[];
}

export function validOstiId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

export function parseDigestArgs(args: string[]): DigestArgs {
  const ids: string[] = [];
  let full = false;
  let fields: SearchField[] | undefined;
  const valid = ["--full", "--fields"];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith("--")) {
      ids.push(token);
      continue;
    }
    const parsed = splitFlag(token);
    if (parsed.flag === "--full") {
      if (parsed.inlineValue !== undefined) usageError("--full takes no value", "digest");
      full = true;
      continue;
    }
    if (!valid.includes(parsed.flag)) unknownFlag(parsed.flag, "digest", valid);
    const result = flagValue(args, index, parsed, "digest");
    index += result.consumed;
    fields = parseFields(result.value, "digest");
  }

  if (ids.length !== 1) usageError("digest requires exactly one OSTI ID", "digest");
  if (!validOstiId(ids[0]!)) usageError("OSTI ID contains invalid characters", "digest");
  return fields ? { id: ids[0]!, full, fields } : { id: ids[0]!, full };
}

export function parseDownloadArgs(args: string[]): DownloadOptions {
  const idTokens: string[] = [];
  let format: DownloadFormat = "both";
  let outDir = "osti-downloads";
  let includeSupplements = false;
  let concurrency = 3;
  let maxMb: number | undefined;
  let force = false;
  const valid = [
    "--format",
    "--out",
    "--include-supplements",
    "--concurrency",
    "--max-mb",
    "--force",
  ];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith("--")) {
      idTokens.push(token);
      continue;
    }
    const parsed = splitFlag(token);
    if (parsed.flag === "--include-supplements" || parsed.flag === "--force") {
      if (parsed.inlineValue !== undefined) usageError(`${parsed.flag} takes no value`, "download");
      if (parsed.flag === "--include-supplements") includeSupplements = true;
      if (parsed.flag === "--force") force = true;
      continue;
    }
    if (!valid.includes(parsed.flag)) unknownFlag(parsed.flag, "download", valid);
    const result = flagValue(args, index, parsed, "download");
    index += result.consumed;
    if (parsed.flag === "--format") {
      if (!["pdf", "text", "both"].includes(result.value)) {
        usageError("--format must be pdf, text, or both", "download");
      }
      format = result.value as DownloadFormat;
    }
    if (parsed.flag === "--out") outDir = result.value;
    if (parsed.flag === "--concurrency") {
      concurrency = positiveInteger(result.value, "--concurrency", "download", 8);
    }
    if (parsed.flag === "--max-mb") {
      maxMb = positiveNumber(result.value, "--max-mb", "download");
    }
  }

  if (idTokens.some((id) => id.includes(","))) {
    throw new AxiError(
      "OSTI IDs must be space-delimited; commas are not accepted",
      "VALIDATION_ERROR",
      ["Run `osti-axi download 2569708 3367522`"],
    );
  }
  const ids = idTokens;
  if (ids.length === 0) usageError("download requires at least one OSTI ID", "download");
  const invalid = ids.filter((id) => !validOstiId(id));
  if (invalid.length > 0) usageError(`Invalid OSTI ID: ${invalid[0]}`, "download");

  const base = {
    ids: [...new Set(ids)],
    format,
    outDir,
    includeSupplements,
    concurrency,
    force,
  };
  return maxMb === undefined ? base : { ...base, maxMb };
}

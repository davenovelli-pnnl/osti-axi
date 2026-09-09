import type { SearchField, OstiLink, OstiRecord } from "./types.js";

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function compactText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function plainText(value: string): string {
  const withoutTags = value.replace(/<[^>]*>/gu, " ");
  return compactText(
    withoutTags.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity, token: string) => {
      const lower = token.toLowerCase();
      if (lower.startsWith("#x")) return safeCodePoint(Number.parseInt(lower.slice(2), 16), entity);
      if (lower.startsWith("#")) return safeCodePoint(Number.parseInt(lower.slice(1), 10), entity);
      return HTML_ENTITIES[lower] ?? entity;
    }),
  );
}

function safeCodePoint(value: number, fallback: string): string {
  try {
    return Number.isInteger(value) ? String.fromCodePoint(value) : fallback;
  } catch {
    return fallback;
  }
}

export function compactAuthor(value: string): string {
  return compactText(
    value
      .replace(/\s*\[[\s\S]*$/u, "")
      .replace(/\s*\(ORCID:[^)]+\)\s*$/iu, ""),
  );
}

export function dateOnly(value?: string): string | undefined {
  if (!value) return undefined;
  const match = /^\d{4}-\d{2}-\d{2}/u.exec(value);
  return match?.[0];
}

export function linkFor(record: OstiRecord, rel: string): string | undefined {
  return record.links?.find((link) => link.rel === rel && validUrl(link.href))?.href;
}

export function directSupplementLinks(record: OstiRecord): OstiLink[] {
  return (record.links ?? []).filter(
    (link) =>
      typeof link.rel === "string" &&
      /^(supplement|supplemental|attachment)(?:[_-]|$)/iu.test(link.rel) &&
      validUrl(link.href),
  );
}

function validUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export interface AbstractPreview {
  text: string;
  truncated: boolean;
  characters: number;
}

export function abstractPreview(value: string | undefined, full = false): AbstractPreview | undefined {
  if (!value) return undefined;
  const text = plainText(value);
  if (!text) return undefined;
  if (full || text.length <= 800) return { text, truncated: false, characters: text.length };
  const candidate = text.slice(0, 800);
  const boundary = candidate.lastIndexOf(" ");
  const preview = candidate.slice(0, boundary >= 650 ? boundary : 800).trimEnd();
  return {
    text: `${preview}… (truncated; ${text.length} chars total)`,
    truncated: true,
    characters: text.length,
  };
}

export function formatRecordFields(
  record: OstiRecord,
  fields: readonly SearchField[],
  full = false,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const preview = abstractPreview(record.description, full);
  const authors = (record.authors ?? []).map(compactAuthor).filter(Boolean);
  const subjects = (record.subjects ?? []).map(compactText).filter(Boolean);
  const authorLimit = full ? authors.length : 8;
  const subjectLimit = full ? subjects.length : 8;

  for (const field of fields) {
    if (field === "id") output.id = record.osti_id;
    if (field === "title") output.title = record.title ? plainText(record.title) : undefined;
    if (field === "date") output.date = dateOnly(record.publication_date);
    if (field === "has_fulltext") output.has_fulltext = Boolean(linkFor(record, "fulltext"));
    if (field === "type") output.type = record.product_type;
    if (field === "authors" && authors.length > 0) {
      output.authors = authors.slice(0, authorLimit);
      if (authors.length > authorLimit) output.authors_more = authors.length - authorLimit;
    }
    if (field === "doi") output.doi = record.doi;
    if (field === "subjects" && subjects.length > 0) {
      output.subjects = subjects.slice(0, subjectLimit);
      if (subjects.length > subjectLimit) output.subjects_more = subjects.length - subjectLimit;
    }
    if (field === "abstract" && preview) output.abstract = preview.text;
    if (field === "citation_url") output.citation_url = linkFor(record, "citation");
    if (field === "fulltext_url") output.fulltext_url = linkFor(record, "fulltext");
  }
  return pruneEmpty(output) as Record<string, unknown>;
}

export function formatDigest(record: OstiRecord, full: boolean): Record<string, unknown> {
  const fields: SearchField[] = [
    "id",
    "title",
    "date",
    "type",
    "authors",
    "abstract",
    "doi",
    "subjects",
    "citation_url",
    "fulltext_url",
  ];
  const output = formatRecordFields(record, fields, full);
  const supplements = directSupplementLinks(record).length;
  if (supplements > 0) output.supplements = supplements;
  if (!output.abstract) output.abstract = "unavailable";
  if (!output.fulltext_url) output.fulltext = "unavailable";
  return output;
}

// Token saving happens here, immediately before the SDK's TOON boundary. Null,
// undefined, empty strings, empty objects, and empty arrays carry no agent-useful
// information and would also make list schemas wider or non-uniform.
export function pruneEmpty(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map(pruneEmpty).filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === "object") {
    const object = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, pruneEmpty(item)] as const)
        .filter(([, item]) => item !== undefined),
    );
    return Object.keys(object).length > 0 ? object : undefined;
  }
  return value;
}

export function slugifyTitle(title: string | undefined, maxLength = 96): string {
  if (!title) return "";
  const slug = plainText(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (slug.length <= maxLength) return slug;
  const candidate = slug.slice(0, maxLength);
  const boundary = candidate.lastIndexOf("-");
  return candidate.slice(0, boundary >= maxLength / 2 ? boundary : maxLength).replace(/-+$/u, "");
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

import { AxiError } from "axi-sdk-js";
import type { OstiRecord, SearchOptions, SearchResult } from "./types.js";

const DEFAULT_BASE_URL = "https://www.osti.gov/api/v1";
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const SEARCH_PARAMETERS = [
  ["query", "q"],
  ["ostiId", "osti_id"],
  ["doi", "doi"],
  ["fulltext", "fulltext"],
  ["biblio", "biblio"],
  ["author", "author"],
  ["title", "title"],
  ["identifier", "identifier"],
  ["sponsorOrg", "sponsor_org"],
  ["researchOrg", "research_org"],
  ["contributingOrg", "contributing_org"],
  ["sourceId", "source_id"],
  ["publicationFrom", "publication_date_start"],
  ["publicationTo", "publication_date_end"],
  ["entryFrom", "entry_date_start"],
  ["entryTo", "entry_date_end"],
  ["language", "language"],
  ["country", "country"],
  ["siteOwnershipCode", "site_ownership_code"],
  ["subject", "subject"],
] as const satisfies readonly (readonly [keyof SearchOptions, string])[];

export interface OstiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelay?: (milliseconds: number) => Promise<void>;
}

export class OstiClient {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly retryDelay: (milliseconds: number) => Promise<void>;

  constructor(options: OstiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.retryDelay =
      options.retryDelay ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async search(options: SearchOptions): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/records`);
    for (const [option, parameter] of SEARCH_PARAMETERS) {
      const value = options[option];
      if (typeof value === "string" && value) url.searchParams.set(parameter, value);
    }
    url.searchParams.set("rows", String(options.limit));
    url.searchParams.set("page", String(options.page));
    if (options.hasFulltext !== undefined) {
      url.searchParams.set("has_fulltext", String(options.hasFulltext));
    }

    let sort = options.sort;
    let order = options.order;
    if (sort === "newest") {
      sort = "publication_date";
      order = "desc";
    } else if (sort === "oldest") {
      sort = "publication_date";
      order = "asc";
    } else if (sort === "recent-entry") {
      sort = "entry_date";
      order = "desc";
    }
    if (sort && sort !== "relevance") url.searchParams.set("sort", sort);
    if (order) url.searchParams.set("order", order);

    const response = await this.fetchJson(url);
    const payload = await parseJsonResponse(response);
    if (!Array.isArray(payload)) {
      throw new AxiError("OSTI returned an unexpected search response", "REMOTE_RESPONSE");
    }
    const records = payload.filter(isRecord);
    const headerTotal = Number(response.headers.get("x-total-count"));
    const total = Number.isSafeInteger(headerTotal) && headerTotal >= 0
      ? headerTotal
      : records.length;
    return { records, total };
  }

  async record(id: string): Promise<OstiRecord> {
    const url = new URL(`${this.baseUrl}/records/${encodeURIComponent(id)}`);
    const response = await this.fetchJson(url, id);
    const payload = await parseJsonResponse(response);
    if (!Array.isArray(payload) || payload.length === 0 || !isRecord(payload[0])) {
      throw new AxiError(`No OSTI record found for ${id}`, "NOT_FOUND", [
        `Run \`osti-axi search ${shellToken(id)}\` to search related identifiers`,
      ]);
    }
    return payload[0];
  }

  private async fetchJson(url: URL, id?: string): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "osti-axi/0.1.0",
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (attempt === 0) {
          await this.retryDelay(150);
          continue;
        }
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        throw new AxiError(
          timedOut ? "OSTI request timed out" : "Could not reach OSTI.GOV",
          timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        );
      }

      if (response.ok) return response;
      if (RETRYABLE_STATUS.has(response.status) && attempt === 0) {
        const retryAfter = retryAfterMilliseconds(response.headers.get("retry-after"));
        await response.body?.cancel();
        await this.retryDelay(retryAfter);
        continue;
      }
      const remote = await safeErrorDescription(response);
      if (response.status === 404) {
        throw new AxiError(remote ?? `No OSTI record found for ${id ?? "request"}`, "NOT_FOUND");
      }
      throw new AxiError(
        remote ?? `OSTI request failed with HTTP ${response.status}`,
        response.status === 429 ? "RATE_LIMITED" : "REMOTE_ERROR",
      );
    }
    throw new AxiError("OSTI request failed", "REMOTE_ERROR");
  }
}

function isRecord(value: unknown): value is OstiRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    await response.body?.cancel();
    throw new AxiError("OSTI returned a non-JSON metadata response", "REMOTE_RESPONSE");
  }
  try {
    return await response.json();
  } catch {
    throw new AxiError("OSTI returned malformed metadata", "REMOTE_RESPONSE");
  }
}

async function safeErrorDescription(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    const value = body.errorDescription ?? body.statusMessage;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function retryAfterMilliseconds(value: string | null): number {
  if (!value) return 250;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 2_000);
  return 250;
}

function shellToken(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

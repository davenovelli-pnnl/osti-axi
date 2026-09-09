import { describe, expect, it, vi } from "vitest";
import { OstiClient } from "../src/osti.js";

describe("OSTI API client", () => {
  it("maps intent-focused search options onto the official API", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([{ osti_id: "1", title: "Result" }]), {
        headers: { "content-type": "application/json", "x-total-count": "73" },
      }),
    );
    const client = new OstiClient({ fetchImpl: fetchImpl as typeof fetch });
    const result = await client.search({
      query: "quantum sensing",
      limit: 10,
      page: 2,
      hasFulltext: true,
      sort: "newest",
    });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: "quantum sensing",
      rows: "10",
      page: "2",
      has_fulltext: "true",
      sort: "publication_date",
      order: "desc",
    });
    expect(result).toMatchObject({ total: 73, records: [{ osti_id: "1" }] });
  });

  it("maps the complete documented filter and sort surface", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), {
        headers: { "content-type": "application/json", "x-total-count": "0" },
      }),
    );
    const client = new OstiClient({ fetchImpl: fetchImpl as typeof fetch });
    await client.search({
      limit: 7,
      page: 3,
      ostiId: "123",
      doi: "10.1000/test",
      fulltext: "neutron flux",
      biblio: "conference",
      author: "Chen, Kun",
      title: "reactor safety",
      identifier: "DE-AC05",
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
      subject: "quantum",
      hasFulltext: false,
      sort: "entry_date",
      order: "asc",
    });

    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      osti_id: "123",
      doi: "10.1000/test",
      fulltext: "neutron flux",
      biblio: "conference",
      author: "Chen, Kun",
      title: "reactor safety",
      identifier: "DE-AC05",
      sponsor_org: "DOE",
      research_org: "ORNL",
      contributing_org: "LANL",
      source_id: "S-123",
      publication_date_start: "01/01/2020",
      publication_date_end: "12/31/2024",
      entry_date_start: "02/01/2020",
      entry_date_end: "01/31/2025",
      language: "English",
      country: "United States",
      site_ownership_code: "DOE",
      subject: "quantum",
      rows: "7",
      page: "3",
      has_fulltext: "false",
      sort: "entry_date",
      order: "asc",
    });
  });

  it("translates a missing record into a structured error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ errorDescription: "No data found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new OstiClient({ fetchImpl: fetchImpl as typeof fetch });
    await expect(client.record("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("retries one transient response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          headers: { "content-type": "application/json", "x-total-count": "0" },
        }),
      );
    const client = new OstiClient({
      fetchImpl: fetchImpl as typeof fetch,
      retryDelay: async () => undefined,
    });
    await expect(client.search({ query: "x", limit: 10, page: 1 })).resolves.toMatchObject({ total: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

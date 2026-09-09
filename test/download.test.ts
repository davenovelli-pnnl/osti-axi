import { mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadRecords, prepareWorkspaceDirectory } from "../src/download.js";
import type { OstiClient } from "../src/osti.js";
import type { DownloadOptions, OstiRecord } from "../src/types.js";

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "osti-axi-test-"));
  directories.push(path);
  return path;
}

function options(overrides: Partial<DownloadOptions> = {}): DownloadOptions {
  return {
    ids: ["42"],
    format: "both",
    outDir: "osti-downloads",
    includeSupplements: false,
    concurrency: 3,
    force: false,
    ...overrides,
  };
}

function client(record: OstiRecord): OstiClient {
  return { record: vi.fn(async () => record) } as unknown as OstiClient;
}

describe("workspace artifact downloads", () => {
  it("streams OSTI PDF and text bytes to readable filenames", async () => {
    const cwd = await workspace();
    const pdf = Buffer.from("%PDF-1.7\noriginal bytes");
    const text = Buffer.from("OSTI supplied full text\n", "utf8");
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const accept = new Headers(init?.headers).get("accept");
      return accept === "application/pdf"
        ? new Response(pdf, { headers: { "content-type": "application/pdf", "content-length": String(pdf.length) } })
        : new Response(text, { headers: { "content-type": "text/plain;charset=UTF-8", "content-length": String(text.length) } });
    });
    const result = await downloadRecords(options(), {
      cwd,
      client: client({
        osti_id: "42",
        title: "A Very Useful Publication",
        links: [{ rel: "fulltext", href: "https://www.osti.gov/servlets/purl/42" }],
      }),
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.failures).toEqual([]);
    const canonicalCwd = await realpath(cwd);
    expect(result.artifacts.map((item) => item.path)).toEqual([
      join(canonicalCwd, "osti-downloads", "a-very-useful-publication.42.pdf"),
      join(canonicalCwd, "osti-downloads", "a-very-useful-publication.42.txt"),
    ]);
    expect(await readFile(result.artifacts[0]!.path)).toEqual(pdf);
    expect(await readFile(result.artifacts[1]!.path)).toEqual(text);
  });

  it("uses the bare OSTI ID when no ASCII slug can be made", async () => {
    const cwd = await workspace();
    const fetchImpl = vi.fn(async () =>
      new Response("text", { headers: { "content-type": "text/plain" } }),
    );
    const result = await downloadRecords(options({ format: "text" }), {
      cwd,
      client: client({
        osti_id: "99",
        title: "量子センシング",
        links: [{ rel: "fulltext", href: "https://www.osti.gov/servlets/purl/99" }],
      }),
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.artifacts[0]?.path).toBe(join(await realpath(cwd), "osti-downloads", "99.txt"));
  });

  it("treats an existing target as a successful no-op", async () => {
    const cwd = await workspace();
    const directory = join(cwd, "osti-downloads");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(directory);
    const path = join(directory, "title.42.txt");
    await writeFile(path, "existing");
    const fetchImpl = vi.fn();
    const result = await downloadRecords(options({ format: "text" }), {
      cwd,
      client: client({
        osti_id: "42",
        title: "Title",
        links: [{ rel: "fulltext", href: "https://www.osti.gov/servlets/purl/42" }],
      }),
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.artifacts[0]).toMatchObject({ status: "existing", bytes: 8 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects HTML masquerading as a requested representation", async () => {
    const cwd = await workspace();
    const result = await downloadRecords(options({ format: "text" }), {
      cwd,
      client: client({
        osti_id: "42",
        title: "Dataset",
        links: [{ rel: "fulltext", href: "https://www.osti.gov/servlets/purl/42" }],
      }),
      fetchImpl: vi.fn(async () =>
        new Response("<html>landing page</html>", { headers: { "content-type": "text/html" } }),
      ) as typeof fetch,
    });
    expect(result.failures[0]).toMatchObject({ code: "FORMAT_UNAVAILABLE" });
    expect(result.artifacts).toEqual([]);
  });

  it("downloads only explicitly classified direct supplements", async () => {
    const cwd = await workspace();
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const value = String(url);
      if (value.includes("supp.zip")) {
        return new Response("zipbytes", {
          headers: {
            "content-type": "application/zip",
            "content-disposition": 'attachment; filename="model-data.zip"',
          },
        });
      }
      const accept = new Headers(init?.headers).get("accept");
      return accept === "application/pdf"
        ? new Response("%PDF-1.4\n", { headers: { "content-type": "application/pdf" } })
        : new Response("plain", { headers: { "content-type": "text/plain" } });
    });
    const result = await downloadRecords(options({ includeSupplements: true }), {
      cwd,
      client: client({
        osti_id: "42",
        title: "Useful Model",
        links: [
          { rel: "fulltext", href: "https://www.osti.gov/servlets/purl/42" },
          { rel: "supplemental_data", href: "https://www.osti.gov/files/supp.zip" },
          { rel: "citation_doe_dataexplorer", href: "https://www.osti.gov/dataexplorer/42" },
        ],
      }),
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.artifacts[2]?.path).toBe(
      join(await realpath(cwd), "osti-downloads", "useful-model.42-supplements", "model-data.zip"),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("blocks lexical and symlink escapes from the workspace", async () => {
    const cwd = await workspace();
    await expect(prepareWorkspaceDirectory(cwd, "../outside")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const outside = await workspace();
    await symlink(outside, join(cwd, "escape"));
    await expect(prepareWorkspaceDirectory(cwd, "escape/files")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

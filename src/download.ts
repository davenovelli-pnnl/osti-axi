import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  realpath,
  rename,
  stat,
  statfs,
  unlink,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AxiError } from "axi-sdk-js";
import { directSupplementLinks, linkFor, slugifyTitle } from "./format.js";
import type { OstiClient } from "./osti.js";
import type {
  ArtifactFailure,
  ArtifactResult,
  DownloadOptions,
  OstiLink,
  OstiRecord,
} from "./types.js";

const DOWNLOAD_TIMEOUT_MS = 300_000;
const DISK_RESERVE_BYTES = 64 * 1024 * 1024;

export interface DownloadDependencies {
  client: OstiClient;
  fetchImpl?: typeof fetch;
  cwd?: string;
}

export interface DownloadBatchResult {
  artifacts: ArtifactResult[];
  failures: ArtifactFailure[];
  outputDirectory: string;
}

export async function downloadRecords(
  options: DownloadOptions,
  dependencies: DownloadDependencies,
): Promise<DownloadBatchResult> {
  const cwd = resolve(dependencies.cwd ?? process.cwd());
  const outputDirectory = await prepareWorkspaceDirectory(cwd, options.outDir);
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;

  const perRecord = await mapLimit(options.ids, options.concurrency, async (id) => {
    try {
      const record = await dependencies.client.record(id);
      return await downloadRecord(record, id, outputDirectory, options, fetchImpl);
    } catch (error) {
      return {
        artifacts: [],
        failures: [failureFrom(error, id, "record")],
      };
    }
  });

  return {
    artifacts: perRecord.flatMap((result) => result.artifacts),
    failures: perRecord.flatMap((result) => result.failures),
    outputDirectory,
  };
}

async function downloadRecord(
  record: OstiRecord,
  requestedId: string,
  outputDirectory: string,
  options: DownloadOptions,
  fetchImpl: typeof fetch,
): Promise<{ artifacts: ArtifactResult[]; failures: ArtifactFailure[] }> {
  const id = record.osti_id || requestedId;
  const slug = slugifyTitle(record.title);
  const stem = slug ? `${slug}.${id}` : id;
  const fulltext = linkFor(record, "fulltext");
  const artifacts: ArtifactResult[] = [];
  const failures: ArtifactFailure[] = [];

  if (!fulltext) {
    failures.push({
      id,
      format: "fulltext",
      code: "NO_FULLTEXT",
      error: "OSTI metadata has no full-text resource for this record",
    });
  } else {
    const formats = options.format === "both" ? (["pdf", "text"] as const) : [options.format];
    const results = await Promise.all(
      formats.map(async (format) => {
        try {
          return {
            artifact: await downloadPrimary(
              id,
              format,
              fulltext,
              resolve(outputDirectory, `${stem}.${format === "text" ? "txt" : "pdf"}`),
              options,
              fetchImpl,
            ),
          };
        } catch (error) {
          return { failure: failureFrom(error, id, format) };
        }
      }),
    );
    for (const result of results) {
      if (result.artifact) artifacts.push(result.artifact);
      if (result.failure) failures.push(result.failure);
    }
  }

  if (options.includeSupplements) {
    const links = directSupplementLinks(record);
    if (links.length > 0) {
      const supplementDirectory = resolve(outputDirectory, `${stem}-supplements`);
      await mkdir(supplementDirectory, { recursive: true });
      const results = await Promise.all(
        links.map(async (link, index) => {
          try {
            return {
              artifact: await downloadSupplement(
                id,
                link,
                index,
                supplementDirectory,
                options,
                fetchImpl,
              ),
            };
          } catch (error) {
            return { failure: failureFrom(error, id, `supplement-${index + 1}`) };
          }
        }),
      );
      for (const result of results) {
        if (result.artifact) artifacts.push(result.artifact);
        if (result.failure) failures.push(result.failure);
      }
    }
  }

  return { artifacts, failures };
}

async function downloadPrimary(
  id: string,
  format: "pdf" | "text",
  url: string,
  target: string,
  options: DownloadOptions,
  fetchImpl: typeof fetch,
): Promise<ArtifactResult> {
  const expectedMediaType = format === "pdf" ? "application/pdf" : "text/plain";
  const existing = await existingArtifact(id, format, target, options.force, expectedMediaType);
  if (existing) return existing;
  const accept = format === "pdf" ? "application/pdf" : "text/plain";
  const response = await fetchArtifact(url, accept, fetchImpl);
  const mediaType = baseMediaType(response.headers.get("content-type"));
  if (format === "pdf" && mediaType !== "application/pdf") {
    await response.body?.cancel();
    throw new AxiError(`OSTI did not provide a PDF (received ${mediaType || "unknown type"})`, "FORMAT_UNAVAILABLE");
  }
  if (format === "text" && mediaType !== "text/plain") {
    await response.body?.cancel();
    throw new AxiError(`OSTI did not provide plain text (received ${mediaType || "unknown type"})`, "FORMAT_UNAVAILABLE");
  }
  const bytes = await saveResponse(response, target, options, format === "pdf" ? "pdf" : "text");
  return { id, format, status: "saved", path: target, bytes, media_type: mediaType };
}

async function downloadSupplement(
  id: string,
  link: OstiLink,
  index: number,
  directory: string,
  options: DownloadOptions,
  fetchImpl: typeof fetch,
): Promise<ArtifactResult> {
  const response = await fetchArtifact(link.href!, "application/octet-stream", fetchImpl);
  const mediaType = baseMediaType(response.headers.get("content-type"));
  if (mediaType === "text/html") {
    await response.body?.cancel();
    throw new AxiError("Supplement link resolved to a landing page, not a direct artifact", "FORMAT_UNAVAILABLE");
  }
  const filename = supplementFilename(response, link.href!, index, mediaType);
  const target = resolve(directory, filename);
  const existing = await existingArtifact(
    id,
    `supplement-${index + 1}`,
    target,
    options.force,
    mediaType || undefined,
  );
  if (existing) {
    await response.body?.cancel();
    return existing;
  }
  const bytes = await saveResponse(response, target, options, "supplement");
  return {
    id,
    format: `supplement-${index + 1}`,
    status: "saved",
    path: target,
    bytes,
    ...(mediaType ? { media_type: mediaType } : {}),
  };
}

async function existingArtifact(
  id: string,
  format: string,
  target: string,
  force: boolean,
  mediaType?: string,
): Promise<ArtifactResult | undefined> {
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new AxiError(`Target exists but is not a file: ${target}`, "PATH_CONFLICT");
    if (!force) {
      return {
        id,
        format,
        status: "existing",
        path: target,
        bytes: info.size,
        ...(mediaType ? { media_type: mediaType } : {}),
      };
    }
    return undefined;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function fetchArtifact(urlValue: string, accept: string, fetchImpl: typeof fetch): Promise<Response> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new AxiError("OSTI supplied an invalid artifact URL", "REMOTE_RESPONSE");
  }
  if (url.protocol !== "https:") {
    throw new AxiError("OSTI artifact URL is not HTTPS", "REMOTE_RESPONSE");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: accept,
          "Accept-Encoding": "identity",
          "User-Agent": "osti-axi/0.1.0",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt === 0) continue;
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new AxiError(
        timedOut ? "Artifact download timed out" : "Artifact download could not reach its source",
        timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      );
    }
    if (response.ok) {
      if (response.url && new URL(response.url).protocol !== "https:") {
        await response.body?.cancel();
        throw new AxiError("Artifact redirected to a non-HTTPS URL", "REMOTE_RESPONSE");
      }
      return response;
    }
    if ([429, 502, 503, 504].includes(response.status) && attempt === 0) {
      await response.body?.cancel();
      continue;
    }
    await response.body?.cancel();
    throw new AxiError(
      response.status === 404
        ? `Requested ${accept} representation is unavailable`
        : `Artifact request failed with HTTP ${response.status}`,
      response.status === 404 ? "FORMAT_UNAVAILABLE" : "REMOTE_ERROR",
    );
  }
  throw new AxiError("Artifact download failed", "REMOTE_ERROR");
}

async function saveResponse(
  response: Response,
  target: string,
  options: DownloadOptions,
  kind: "pdf" | "text" | "supplement",
): Promise<number> {
  if (!response.body) throw new AxiError("Artifact response had no body", "REMOTE_RESPONSE");
  const declaredLength = contentLength(response.headers.get("content-length"));
  const maxBytes = options.maxMb === undefined ? undefined : Math.floor(options.maxMb * 1024 * 1024);
  if (maxBytes !== undefined && declaredLength !== undefined && declaredLength > maxBytes) {
    await response.body.cancel();
    throw new AxiError(
      `Artifact is ${declaredLength} bytes, exceeding --max-mb ${options.maxMb}`,
      "SIZE_LIMIT",
    );
  }
  await ensureDiskSpace(dirname(target), declaredLength);

  const temporary = `${target}.part-${process.pid}-${randomUUID()}`;
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  const inspector = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (prefix.length < 512) prefix = Buffer.concat([prefix, buffer.subarray(0, 512 - prefix.length)]);
      if (maxBytes !== undefined && bytes > maxBytes) {
        callback(new AxiError(`Artifact exceeded --max-mb ${options.maxMb}`, "SIZE_LIMIT"));
        return;
      }
      callback(null, buffer);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      inspector,
      createWriteStream(temporary, { flags: "wx" }),
    );
    if (kind === "pdf" && !prefix.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new AxiError("Downloaded content is not a valid PDF", "INVALID_ARTIFACT");
    }
    if (kind === "text" && /^\s*<!doctype\s+html|^\s*<html/iu.test(prefix.toString("utf8"))) {
      throw new AxiError("OSTI text response contained HTML instead of full text", "INVALID_ARTIFACT");
    }
    await replaceAtomically(temporary, target, options.force);
    return bytes;
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (isNoSpace(error)) throw new AxiError("Not enough disk space for artifact", "NO_SPACE");
    throw error;
  }
}

async function replaceAtomically(temporary: string, target: string, force: boolean): Promise<void> {
  try {
    await rename(temporary, target);
  } catch (error) {
    if (force && isAlreadyExists(error)) {
      await unlink(target);
      await rename(temporary, target);
      return;
    }
    throw error;
  }
}

export async function prepareWorkspaceDirectory(cwd: string, requested: string): Promise<string> {
  if (!requested || isAbsolute(requested)) {
    throw new AxiError("--out must be a relative path inside the current workspace", "VALIDATION_ERROR");
  }
  const output = resolve(cwd, requested);
  assertContained(cwd, output);
  const realCwd = await realpath(cwd);
  const ancestor = await nearestExistingAncestor(output);
  const realAncestor = await realpath(ancestor);
  assertContained(realCwd, realAncestor);
  await mkdir(output, { recursive: true });
  const realOutput = await realpath(output);
  assertContained(realCwd, realOutput);
  return realOutput;
}

function assertContained(parent: string, child: string): void {
  const path = relative(parent, child);
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))) return;
  throw new AxiError("--out must remain inside the current workspace", "VALIDATION_ERROR");
}

async function nearestExistingAncestor(path: string): Promise<string> {
  let current = path;
  for (;;) {
    try {
      await access(current);
      return current;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

async function ensureDiskSpace(directory: string, required?: number): Promise<void> {
  if (required === undefined) return;
  try {
    const info = await statfs(directory);
    const free = Number(info.bavail) * Number(info.bsize);
    if (Number.isFinite(free) && required + DISK_RESERVE_BYTES > free) {
      throw new AxiError("Not enough free disk space for artifact", "NO_SPACE");
    }
  } catch (error) {
    if (error instanceof AxiError) throw error;
    // Filesystems that do not support statfs will still surface ENOSPC safely
    // from the streaming write.
  }
}

function supplementFilename(response: Response, url: string, index: number, mediaType: string): string {
  const disposition = response.headers.get("content-disposition");
  const fromHeader = dispositionFilename(disposition);
  const fromUrl = basename(new URL(response.url || url).pathname);
  let filename = sanitizeFilename(fromHeader || fromUrl);
  const extension = extensionFor(mediaType);
  if (!filename) filename = `supplement-${String(index + 1).padStart(2, "0")}`;
  if (!extname(filename) && extension) filename += `.${extension}`;
  return filename.slice(0, 180).replace(/[. ]+$/u, "") || `supplement-${index + 1}.bin`;
}

function dispositionFilename(value: string | null): string {
  if (!value) return "";
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return "";
    }
  }
  return /filename="?([^";]+)"?/iu.exec(value)?.[1]?.trim() ?? "";
}

function sanitizeFilename(value: string): string {
  return basename(value)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^\.+/u, "");
}

function extensionFor(mediaType: string): string {
  const extensions: Record<string, string> = {
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/gzip": "gz",
    "application/json": "json",
    "text/plain": "txt",
    "text/csv": "csv",
  };
  return extensions[mediaType] ?? "bin";
}

function baseMediaType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function contentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

function failureFrom(error: unknown, id: string, format: string): ArtifactFailure {
  if (error instanceof AxiError) return { id, format, code: error.code, error: error.message };
  if (isNoSpace(error)) return { id, format, code: "NO_SPACE", error: "Not enough disk space for artifact" };
  const message = error instanceof Error ? error.message : "Artifact operation failed";
  return { id, format, code: "ARTIFACT_ERROR", error: message };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function nodeCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function isMissing(error: unknown): boolean {
  return nodeCode(error) === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return nodeCode(error) === "EEXIST" || nodeCode(error) === "EPERM";
}

function isNoSpace(error: unknown): boolean {
  return nodeCode(error) === "ENOSPC";
}

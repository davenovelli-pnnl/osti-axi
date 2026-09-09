export interface OstiLink {
  rel?: string;
  href?: string;
}

export interface OstiRecord {
  osti_id?: string;
  title?: string;
  description?: string;
  authors?: string[];
  subjects?: string[];
  publication_date?: string;
  entry_date?: string;
  product_type?: string;
  doi?: string;
  links?: OstiLink[];
  [key: string]: unknown;
}

export type SearchField =
  | "id"
  | "title"
  | "date"
  | "has_fulltext"
  | "type"
  | "authors"
  | "doi"
  | "subjects"
  | "abstract"
  | "citation_url"
  | "fulltext_url";

export interface SearchOptions {
  query?: string;
  limit: number;
  page: number;
  ostiId?: string;
  doi?: string;
  fulltext?: string;
  biblio?: string;
  author?: string;
  title?: string;
  identifier?: string;
  sponsorOrg?: string;
  researchOrg?: string;
  contributingOrg?: string;
  sourceId?: string;
  publicationFrom?: string;
  publicationTo?: string;
  entryFrom?: string;
  entryTo?: string;
  language?: string;
  country?: string;
  siteOwnershipCode?: string;
  subject?: string;
  hasFulltext?: boolean;
  sort?: string;
  order?: "asc" | "desc";
}

export interface SearchResult {
  records: OstiRecord[];
  total: number;
}

export type DownloadFormat = "pdf" | "text" | "both";

export interface DownloadOptions {
  ids: string[];
  format: DownloadFormat;
  outDir: string;
  includeSupplements: boolean;
  concurrency: number;
  maxMb?: number;
  force: boolean;
}

export interface ArtifactResult {
  id: string;
  format: string;
  status: "saved" | "existing";
  path: string;
  bytes: number;
  media_type?: string;
}

export interface ArtifactFailure {
  id: string;
  format: string;
  code: string;
  error: string;
}

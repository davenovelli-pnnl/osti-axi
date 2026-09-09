import { commandRows, renderSections } from "./render.js";

const renderOutput = renderSections;

export const TOP_LEVEL_HELP = `${renderOutput({
  tool: "osti-axi",
  description: "Search OSTI.GOV, inspect records, and download selected full text",
  usage: "osti-axi <command> [arguments] [flags]",
  commands: {
    search: "Search OSTI records by keywords and/or fielded filters",
    digest: "Fetch a compact record, abstract, and resource links",
    download: "Save OSTI-provided PDF/text artifacts in the current workspace",
  },
  search_filters: {
    content: "--title --author --subject --fulltext --biblio",
    identity: "--osti-id --doi --identifier",
    organizations: "--sponsor-org --research-org --contributing-org --source-id --site-ownership-code",
    scope: "--language --country --has-fulltext --fulltext-only",
    dates: "--publication-from --publication-to --entry-from --entry-to (MM/DD/YYYY)",
    results: "--sort --order --limit --page --fields",
  },
  examples: commandRows([
    'osti-axi search "quantum sensing" --fulltext-only',
    'osti-axi search --author "Chen, Kun" --publication-from 01/01/2020',
    "osti-axi search --research-org PNNL --sort publication_date --order desc",
    "osti-axi digest <osti_id>",
    "osti-axi download <osti_id> --format both",
  ]),
})}\n`;

const COMMAND_HELP: Record<string, string> = {
  search: `${renderOutput({
    command: "search",
    usage: "osti-axi search [query...] [flags]",
    content_filters: {
      "<query...>": "General search across the full record; optional when using filters",
      "--title <terms>": "Search document titles",
      "--author <name>": "Search author entries",
      "--subject <terms>": "Search subject categories and keywords",
      "--fulltext <terms>": "Search available article full text",
      "--biblio <terms>": "Search bibliographic information",
    },
    identity_filters: {
      "--osti-id <id>": "Match an OSTI identifier",
      "--doi <doi>": "Match a Digital Object Identifier",
      "--identifier <value>": "Match report, contract, and other common identifiers",
    },
    organization_filters: {
      "--sponsor-org <name>": "Search the sponsoring organization",
      "--research-org <name>": "Search the research organization",
      "--contributing-org <name>": "Search the contributing organization",
      "--source-id <code>": "Match the submitting organization's source code",
      "--site-ownership-code <code>": "Match the submitting organization's ownership code",
    },
    scope_filters: {
      "--language <value>": "Match language",
      "--country <value>": "Match country of publication",
      "--has-fulltext <bool>": "true for full text; false for citation-only records",
      "--fulltext-only": "Convenience alias for --has-fulltext true",
    },
    date_filters: {
      "--publication-from <date>": "Inclusive publication start; MM/DD/YYYY",
      "--publication-to <date>": "Inclusive publication end; MM/DD/YYYY",
      "--entry-from <date>": "Inclusive entry start; MM/DD/YYYY",
      "--entry-to <date>": "Inclusive entry end; MM/DD/YYYY",
    },
    result_flags: {
      "--sort <field|preset>": "API field, or relevance/newest/oldest/recent-entry",
      "--order <asc|desc>": "Sort direction; requires --sort",
      "--limit <1-100>": "Results per page (default 10)",
      "--page <n>": "Result page (default 1)",
      "--fields <csv>": "id,title,date,has_fulltext,type,authors,doi,subjects,abstract,citation_url,fulltext_url",
    },
    examples: commandRows([
      'osti-axi search "molten salt reactors"',
      'osti-axi search --author "Chen, Kun" --publication-from 01/01/2020',
      "osti-axi search --research-org PNNL --sort publication_date --order desc",
    ]),
  })}\n`,
  digest: `${renderOutput({
    command: "digest",
    usage: "osti-axi digest <osti_id> [flags]",
    flags: {
      "--full": "Return the complete abstract and uncapped author/subject lists",
      "--fields <csv>": "Select the same fields supported by search",
    },
    examples: commandRows([
      "osti-axi digest 3376511",
      "osti-axi digest 3376511 --full",
      "osti-axi digest 3376511 --fields id,title,abstract,fulltext_url",
    ]),
  })}\n`,
  download: `${renderOutput({
    command: "download",
    usage: "osti-axi download <osti_id...> [flags]",
    flags: {
      "--format <mode>": "pdf, text, or both (default both)",
      "--out <directory>": "Relative workspace directory (default ./osti-downloads)",
      "--include-supplements": "Download direct supplement/attachment links exposed by OSTI",
      "--concurrency <1-8>": "Records processed concurrently (default 3)",
      "--max-mb <n>": "Optional per-artifact size guard; no default cap",
      "--force": "Replace files that already exist",
    },
    examples: commandRows([
      "osti-axi download 3376511",
      "osti-axi download 2569708 3367522",
      "osti-axi download <id1> <id2> --include-supplements --out research/osti",
    ]),
  })}\n`,
};

export function commandHelp(command: string): string | undefined {
  return COMMAND_HELP[command];
}

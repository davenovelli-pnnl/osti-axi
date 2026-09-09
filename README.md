# osti-axi

`osti-axi` is a retrieval-focused [Agent eXperience Interface](https://github.com/kunchenguid/axi) for the public [OSTI.GOV](https://www.osti.gov) repository. It searches records, returns compact [TOON](https://toonformat.dev) output, and saves explicitly selected full-text artifacts into the agent's current workspace.

It is read-only against OSTI: it never publishes, edits, submits, or manages accounts. It also never extracts text from PDFs. PDF and text downloads are separate representations supplied directly by OSTI.

## Install

```sh
git clone https://github.com/davenovelli-pnnl/osti-axi.git
cd osti-axi
npm install -g .
osti-axi --version
```

Requires Node 20 or newer. Running `osti-axi` with no arguments shows the most recently added OSTI records.

## Commands

```sh
osti-axi search [query...] [filters] [result flags]
osti-axi digest <osti_id> [--full] [--fields <csv>]
osti-axi download <osti_id...> [--format pdf|text|both] [--out <dir>]
```

Run `osti-axi <command> --help` for each command's complete flag reference and examples.

### search

`search` exposes the complete documented OSTI `/records` search surface through validated flags:

```text
Content:       --title --author --subject --fulltext --biblio
Identity:      --osti-id --doi --identifier
Organizations: --sponsor-org --research-org --contributing-org
Source:        --source-id --site-ownership-code
Scope:         --language --country --has-fulltext
Publication:   --publication-from --publication-to
Entry:         --entry-from --entry-to
Results:       --sort --order --limit --page --fields
```

A positional query is optional when filters are supplied. Dates use `MM/DD/YYYY`. `--fulltext-only` is shorthand for `--has-fulltext true`. `--sort` accepts any OSTI field or the presets `relevance`, `newest`, `oldest`, and `recent-entry`.

```sh
osti-axi search "quantum sensing" --fulltext-only
osti-axi search --author "Chen, Kun" --publication-from 01/01/2020
osti-axi search --research-org PNNL --sort publication_date --order desc
```

Results default to `id,title,date,has_fulltext`. Use `--fields` to add `type`, `authors`, `doi`, `subjects`, `abstract`, `citation_url`, or `fulltext_url`.

### digest

`digest` returns one record with a truncated abstract and its resource links. Add `--full` for the complete abstract and uncapped author and subject lists.

```sh
osti-axi digest 3376511
osti-axi digest 3376511 --full
```

### download

`download` saves OSTI-provided PDF and text representations. IDs are space-delimited. Files land under `./osti-downloads/` by default:

```sh
osti-axi download 2569708 3367522 3376511
```

```text
landau-zener-transition-enhanced-quantum-sensing.3376511.pdf
landau-zener-transition-enhanced-quantum-sensing.3376511.txt
```

Flags: `--format pdf|text|both` (default `both`), `--out <dir>`, `--concurrency <1-8>`, `--max-mb <n>`, `--force`, and `--include-supplements` for direct supplement or attachment links present in OSTI metadata. The tool does not crawl external dataset, publisher, code, or product-portal pages.

## Output

All output, including errors, is TOON on stdout. Exit codes follow AXI conventions: `0` success, `1` error, `2` usage error. Each response ends with an `[AXI-NEXT]` block of suggested follow-up commands.

## Development

```sh
npm install
npm test
```

`npm test` builds `dist/` before running the suite.

## License

MIT

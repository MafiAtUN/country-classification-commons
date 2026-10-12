# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

> **Note:** This file tracks software and schema changes. Automated data refresh changelogs (country additions, membership changes, etc.) are written per-run to [`data/changelog/`](./data/changelog/).

---

## [Unreleased]

---

## [2.0.0] — 2026-10-12

A Nerd Lab experiment from this release: the site carries "Nerd Lab presents" and is listed at
[nerd-factory.github.io/nerd-lab](https://nerd-factory.github.io/nerd-lab/).

### Breaking
- **CSV files no longer start with a `# Country Classification Commons — Maintainer…` comment line.** The first line is
  now the header, so Power BI, Tableau, Qlik, Excel, DuckDB and every CSV reader load the files with default settings.
  If you skipped that line (`skiprows=1`, "remove top rows"), remove that step. `comment="#"` keeps working.
- `country_group_membership.csv` booleans are lowercase `true`/`false`, matching `countries.csv`.

### Added
- `countries.csv` / `countries.json`: analysis-ready table, one row per country or area, 31 snake_case columns.
- UN membership: `un_status` (`member_state`, `observer_state`, `non_member`), `is_un_member`, and `un_regional_group`
  (AG, APG, EEG, GRULAC, WEOG), from a curated list in `reference/` checked on every run (193 + 2).
- OECD membership (`is_oecd_member`, 38 countries), also curated in `reference/`.
- `sdg_region` (the eight SDG Progress Report regions) and `analysis_region` (intermediate region, else sub-region).
- `groups.csv`: catalogue of 121 groups with member and UN Member State counts.
- `group_id`, `country_name` and `is_un_member` columns in `country_group_membership.csv`.
- `docs/data/site.json`: compact payload for the website.
- Redesigned site: Explorer (combine and exclude groups, UN-membership scope, table, map, breakdown, comparison,
  CSV/ISO3 export, generated code for Python, R, SQL, Power Query, JavaScript and Julia), "Use it" guides for
  eleven tools, Data page with column dictionary and group catalogue, Method page, ⌘K search, light and dark themes.
- `scripts/build_shell.py` stamps the shared header and footer into every page.
- `CITATION.cff`.

### Fixed
- `world_reference.csv` "OECD member" was derived from ODA eligibility, so aid recipients such as Afghanistan were
  labelled OECD members. It now uses the OECD membership list. Added a "UN Member State" column.
- World Bank fragility list: from FY27 the file is "A1-FY27-FCV-List.pdf" with ISO3 codes and no categories. The pipeline
  finds and parses the new format; FCS data had been missing since the change.
- Nauru: UN M49 now uses "Naoero", so OECD's "Nauru" went unmatched. Alias added.
- The scheduled refresh failed from 8 October 2026 because `apt-get install` ran without `apt-get update`.
- The website served March 2026 data: refresh commits pushed with `GITHUB_TOKEN` never triggered a Pages deploy.
  Pages now redeploys after every refresh.

### Removed
- `docs/downloads.html` now redirects to the Data page; the map lives in the Explorer.
- Unused `docs/app.js` and the previous `docs/explorer.js`.

---

## [1.1.0] — 2026-03-11

### Added
- Open source governance files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- GitHub issue templates (bug report, feature request) and PR template
- SEO meta description and Open Graph tags across all docs pages
- Concurrency control on the `Update Data` GitHub Actions workflow

### Changed
- `requirements.txt` now includes upper-bound version constraints
- `.gitignore` extended to cover `*.xlsx`, `*.xls`, `notebooks/`, `.ipynb_checkpoints/`

### Removed
- Internal developer research notes (`RESEARCH_SOURCES.md`) — content superseded by `SOURCE_METHODOLOGY.md`
- 8 early debugging pipeline snapshots from `data/history/` (March 4 test runs)

---

## [1.0.0] — 2026-03-05

### Added
- **SDG Analytics Lab** (`docs/sdg-lab.html`) — SDR 2025 indicator explorer with map, charts, and country profiles
- **Government AI Readiness** (`docs/ai-readiness.html`) — GAIRI 2025 data visualised against country classifications
- **Ease of Doing Business** (`docs/ease-business.html`) — World Bank DTF rankings overlaid on classification groups
- **Example Uses** page (`docs/examples.html`) — practical use-case gallery
- `docs/data/gairi_2025.json`, `sdr2025_*.json`, `ease_doing_business_latest.json` data files
- Per-tab filtered CSV export in the Explorer
- All-Groups tab and cascading region/sub-region filters in the Explorer
- World Bank Region column and filter on the FCS tab

### Changed
- Explorer rebuilt with per-classification-system tabs and Chart.js visualisations
- Downloads page enriched with R/Python/Excel/Power BI/Tableau/SPSS/Stata code snippets
- About page enriched with data source citations and methodology details
- JSON outputs sanitised: `NaN`/`Infinity` replaced with `null` to comply with RFC 8259

### Fixed
- FCS extraction switched to `pypdf`; 38 FCS countries now correctly populated
- Explorer JSON loader normalised to handle text responses consistently

---

## [0.1.0] — 2026-03-04

### Added
- Initial pipeline (`scripts/update_data.py`) integrating UN M49, UN SDG API, World Bank API, World Bank FCS, and OECD DAC
- Outputs: `countries_master.csv/json`, `country_group_membership.csv/json`, `country_classification_library.csv/json`, `sources.csv/json`, `aggregates.csv`, `run_manifest.json`, `unmapped_external_names.csv`
- GitHub Actions workflows: `update-data.yml` (scheduled refresh) and `deploy-pages.yml` (GitHub Pages)
- Static docs site: `index.html`, `explorer.html`, `downloads.html`, `about.html`
- Documentation: `README.md`, `DATA_DICTIONARY.md`, `SOURCE_METHODOLOGY.md`, `USAGE_GUIDE.md`
- MIT License

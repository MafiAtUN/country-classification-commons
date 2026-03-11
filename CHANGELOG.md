# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

> **Note:** This file tracks software and schema changes. Automated data refresh changelogs (country additions, membership changes, etc.) are written per-run to [`data/changelog/`](./data/changelog/).

---

## [Unreleased]

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

# Country Classification Commons

[![Update Data](https://github.com/MafiAtUN/country-classification-commons/actions/workflows/update-data.yml/badge.svg)](https://github.com/MafiAtUN/country-classification-commons/actions/workflows/update-data.yml)
[![Deploy Pages](https://github.com/MafiAtUN/country-classification-commons/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/MafiAtUN/country-classification-commons/actions/workflows/deploy-pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/downloads/)

An open, auto-refreshing reference library of country classifications from the UN, World Bank, and OECD — for researchers, analysts, and practitioners who work with countries as units of analysis.

**[Live Explorer →](https://mafiatun.github.io/country-classification-commons/)**

Maintainer: [Mafizul Islam](https://github.com/MafiAtUN)

This project rebuilds country classifications in a normalized format using authoritative, updateable sources and publishes outputs that can be consumed directly as CSV/JSON.

## What This Repository Produces

- `data/latest/countries_master.csv`
  - Core country keys (`iso3`, `iso2`, `m49`) and multilingual names (UN 6 languages)
  - UN M49 geoscheme attributes
  - World Bank metadata (region, income, lending type, capital, coordinates)
  - World Bank FCS classification fields
  - OECD DAC ODA eligibility summary fields
- `data/latest/country_group_membership.csv`
  - Long-format membership table: one row per country-group assignment
- `data/latest/country_classification_library.csv`
  - Denormalized full library: one row per country classification assignment with key country metadata
- `data/latest/sources.csv`
  - Source catalog with access timestamps and provenance notes
- `data/latest/run_manifest.json`
  - Snapshot metadata, record counts, and file hashes
- `data/latest/unmapped_external_names.csv`
  - External source names that could not be mapped to ISO3 in the current run
- `data/changelog/changes_<snapshot>.md`
  - Diff report against previous snapshot
- `docs/`
  - GitHub Pages multi-page site:
    - `index.html` (overview)
    - `explorer.html` (interactive country/classification explorer)
    - `downloads.html` (direct download links + raw file links)

## Source Systems (Current)

1. UN Statistics Division (M49 multilingual overview)
2. UN SDG API (`GeoArea/List` and `GeoArea/Tree`)
3. World Bank Open Data API (`/v2/country`)
4. World Bank FCS latest FY list (official page + linked FY PDF)
5. OECD DAC ODA recipients (latest CSV from OECD webfs directory)

Detailed notes: [`SOURCE_METHODOLOGY.md`](./SOURCE_METHODOLOGY.md)

## Quick Start

```bash
cd country-classification-commons
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/update_data.py
```

## GitHub Pages Setup

This repository includes `.github/workflows/deploy-pages.yml` to deploy the `docs/` app.

1. In repository settings, open `Pages`.
2. Set `Source` to `GitHub Actions`.
3. Push to `main` (or run the workflow manually).
4. The app will serve from `https://<user>.github.io/<repo>/`.

The app reads:

- `docs/data/countries_master.json`
- `docs/data/country_group_membership.json`
- `docs/data/country_classification_library.json`
- `docs/data/sources.json`
- `docs/data/run_manifest.json`

## Update Workflow

Run:

```bash
python scripts/update_data.py
```

This performs:

1. Pull fresh data from all registered sources.
2. Rebuild normalized datasets in `data/latest/`.
3. Compare with previous snapshot and write a changelog report.
4. Archive snapshot under `data/history/<timestamp>/`.
5. Refresh `docs/data/` for GitHub Pages.

## Recommended Publishing Pattern

- Keep this as a dedicated public repository.
- Use the included scheduled workflow `.github/workflows/update-data.yml`.
- Commit `data/latest/`, `data/changelog/`, and `docs/data/` after each successful run.

## Data Contract

Schema reference: [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md)

## Tool Usage Guide

Detailed instructions for spreadsheets, BI tools, and programming environments:
[`USAGE_GUIDE.md`](./USAGE_GUIDE.md)

## Contributing

Contributions are welcome — bug reports, new data source proposals, documentation fixes, and code improvements. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for guidelines.

Please read our [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) before participating.

## Citation Guidance

When reusing the data, cite both this repository snapshot and upstream official sources listed in `data/latest/sources.csv`.

## Security

To report a security vulnerability, see [`SECURITY.md`](./SECURITY.md).

## License

MIT License. Copyright (c) 2026 Mafizul Islam.

# Source Methodology

## Authority Ranking

1. **UN Statistics (M49)** for canonical statistical country/area coding and UN geoscheme.
2. **UN SDG API** for SDG GeoArea list and SDG-oriented regional hierarchy.
3. **World Bank API** for economic and financing classifications used in development analysis.
4. **World Bank FCS official list** for latest fragility categories.
5. **OECD DAC list** for ODA recipient eligibility groupings.

## Current Sources

## UN Statistics Division - M49 Overview
- URL: <https://unstats.un.org/unsd/methodology/m49/overview/>
- Used for:
  - `m49`, `iso2`, `iso3`
  - UN region/sub-region/intermediate-region hierarchy
  - LDC/LLDC/SIDS flags
  - Country names in Arabic, Chinese, English, French, Russian, Spanish

## UN SDG API - GeoArea List
- URL: <https://unstats.un.org/SDGAPI/v1/sdg/GeoArea/List>
- Used for:
  - SDG geo area code-name mapping

## UN SDG API - GeoArea Tree
- URL: <https://unstats.un.org/SDGAPI/v1/sdg/GeoArea/Tree>
- Used for:
  - SDG regional hierarchy membership links

## World Bank API - Country Endpoint
- URL: <https://api.worldbank.org/v2/country?format=json&per_page=1000>
- Used for:
  - World Bank region, income level, lending type
  - Capital city and coordinates

## World Bank - Classification of Fragile and Conflict-affected Situations
- Landing page: <https://www.worldbank.org/en/topic/fragilityconflictviolence/brief/classification-of-fragile-and-conflict-affected-situations>
- Used for:
  - Latest FY FCS roster and FCS category (Conflict vs Institutional and Social Fragility)
- Extraction note:
  - No stable public JSON API was found for this list; the pipeline discovers the latest official FY PDF and parses it.

## OECD DAC - ODA Recipients List (webfs CSV)
- Directory: <https://webfs.oecd.org/oda/DAClists/>
- Used for:
  - ODA recipient eligibility group memberships
  - DAC group ids/names and year from latest CSV release
- Extraction note:
  - The pipeline auto-selects the most recent CSV in the official directory.

## Reconciliation Rules

1. `iso3` + `m49` from UN M49 are treated as primary keys.
2. World Bank rows are merged by `iso3`.
3. SDG rows are merged by `m49`.
4. Group memberships are emitted in long format with explicit `source` and `group_type`.
5. Empty or aggregate-only categories are ignored where code/name is unavailable.
6. External-source names are mapped to ISO3 using deterministic normalization + alias table; unmapped names are published for transparency.

## Change Tracking

Each run compares against previous `data/latest` outputs and writes:

- Added/removed countries
- Countries with changed core metadata
- Added/removed group memberships
- Unmapped external source names

Report path: `data/changelog/changes_<snapshot>.md`

## Planned Expansion

Future versions can add additional official classification systems (for example IMF WEO groups, UN regional commission rosters, and treaty-based country groupings) once stable machine-readable endpoints are validated.

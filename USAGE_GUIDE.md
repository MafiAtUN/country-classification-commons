# Country Classification Commons Usage Guide

This guide shows practical ways to use the data in spreadsheet, BI, and programming tools.

## Files to Start With

- `data/latest/countries_master.csv`: one row per country/area with core attributes.
- `data/latest/country_group_membership.csv`: long table of group memberships.
- `data/latest/sources.csv`: provenance and source access timestamps.
- `data/latest/run_manifest.json`: snapshot id, record counts, hashes.

If you are using GitHub-hosted outputs, replace local paths with raw file URLs from this repository.

## Excel

1. Open Excel.
2. Go to `Data` -> `Get Data` -> `From Text/CSV`.
3. Import `countries_master.csv`.
4. Repeat for `country_group_membership.csv`.
5. In Power Query, ensure:
   - `iso3`, `iso2`, `m49` are Text.
   - `latitude`, `longitude` are Decimal Number.
   - boolean flags are True/False (Logical) or text, consistently.
6. Load both tables.
7. Use `Data Model` relationships on `iso3` (or `m49` if preferred).
8. Build PivotTables and slicers.

Recommended analyses:
- Count countries by `wb_income_level`.
- Filter members of a selected `group_code`.
- Compare UN region vs World Bank region.

## Power BI

1. `Get Data` -> `Text/CSV` for `countries_master.csv`.
2. Load `country_group_membership.csv` similarly.
3. In Model view:
   - Relationship: `countries_master[iso3]` (one) -> `country_group_membership[iso3]` (many).
4. Create basic measures:
   - `Country Count = DISTINCTCOUNT(countries_master[iso3])`
   - `Membership Rows = COUNTROWS(country_group_membership)`
5. Build visuals:
   - Matrix by `source_system` and `group_type`.
   - Map using `latitude`, `longitude`.
   - Slicers for `is_ldc`, `is_sids`, `wb_income_level`.

Refresh options:
- Manual desktop refresh.
- Scheduled refresh in Power BI Service from GitHub raw URLs or a synced storage location.

## Tableau

1. Connect to `countries_master.csv`.
2. Add `country_group_membership.csv` as related table.
3. Relate on `iso3`.
4. Set geographic role from `latitude`/`longitude` or country names.
5. Create dashboards:
   - Country profile sheet (filter by `iso3`).
   - Group membership explorer by `source_system`.
   - Regional comparison bars.

Tip: Keep `country_group_membership` long format as-is; it works well with Tableau filters.

## Qlik (Sense/QlikView)

Example script:

```qlik
Countries:
LOAD * FROM [lib://Data/countries_master.csv]
(txt, utf8, embedded labels, delimiter is ',', msq);

Membership:
LOAD * FROM [lib://Data/country_group_membership.csv]
(txt, utf8, embedded labels, delimiter is ',', msq);
```

Because both tables share `iso3`, Qlik will associate automatically. For custom behavior, rename keys explicitly.

## Other BI/Analytics Tools

For Looker Studio, Apache Superset, Metabase, DuckDB, or similar:
- Load CSVs directly or stage into a relational table.
- Keep `countries_master` as the dimension table.
- Keep `country_group_membership` as the fact-like association table.
- Join key: `iso3` (preferred).

## Python

```python
import pandas as pd

countries = pd.read_csv("data/latest/countries_master.csv", dtype={"iso3": "string", "iso2": "string", "m49": "string"})
membership = pd.read_csv("data/latest/country_group_membership.csv", dtype={"iso3": "string", "iso2": "string", "m49": "string"})

# Example: all SIDS countries
sids = countries[countries["is_sids"] == True][["iso3", "country_name_en"]]

# Example: countries in a chosen group code
group = membership[membership["group_code"] == "SIDS"][["iso3", "group_name"]]
```

## R

```r
library(readr)
library(dplyr)

countries <- read_csv("data/latest/countries_master.csv", show_col_types = FALSE)
membership <- read_csv("data/latest/country_group_membership.csv", show_col_types = FALSE)

# Example: count countries by World Bank income level
countries %>%
  count(wb_income_level, sort = TRUE)
```

## Julia

```julia
using CSV, DataFrames

countries = CSV.read("data/latest/countries_master.csv", DataFrame)
membership = CSV.read("data/latest/country_group_membership.csv", DataFrame)

# Example: filter LDCs
ldc = filter(:is_ldc => ==(true), countries)
```

## JavaScript (Node.js)

```javascript
import fs from "node:fs";
import { parse } from "csv-parse/sync";

const countries = parse(fs.readFileSync("data/latest/countries_master.csv"), {
  columns: true,
  skip_empty_lines: true
});

const membership = parse(fs.readFileSync("data/latest/country_group_membership.csv"), {
  columns: true,
  skip_empty_lines: true
});

console.log(countries.length, membership.length);
```

## SPSS

1. `File` -> `Read Text Data`.
2. Select `countries_master.csv`.
3. Set delimiter to comma and confirm first row contains variable names.
4. Define string widths for key fields (`iso3`, `iso2`, `m49`) to avoid numeric coercion.
5. Repeat import for `country_group_membership.csv`.
6. Use `Data` -> `Merge Files` with `iso3`.

## Stata

```stata
import delimited "data/latest/countries_master.csv", clear varnames(1) stringcols(_all)
save "countries_master.dta", replace

import delimited "data/latest/country_group_membership.csv", clear varnames(1) stringcols(_all)
save "country_group_membership.dta", replace

use "countries_master.dta", clear
merge 1:m iso3 using "country_group_membership.dta"
```

## Good Practices

- Keep ISO fields as text, not numeric.
- Prefer `iso3` joins across systems.
- Track `run_manifest.json` to pin analyses to a specific snapshot.
- Rebuild dashboards after automated updates if schema changes are introduced.

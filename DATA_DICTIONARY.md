# Data Dictionary

All CSV files are UTF-8, comma-separated, with a single header row. In the files below, flags are `true`/`false`
and empty cells mean "not applicable". The same tables, with examples, are on the
[Data page](https://mafiatun.github.io/country-classification-commons/data.html).

## `countries.csv` (start here)

One row per country or area in UN M49 (248 rows).

| Column | Type | Meaning |
|---|---|---|
| `iso3` | text | ISO 3166-1 alpha-3. The join key. |
| `iso2` | text | ISO 3166-1 alpha-2. Namibia's is `NA`: read it as text, not missing. |
| `m49` | text | UN M49 / ISO 3166-1 numeric, three digits with leading zeros. |
| `name` | text | UN M49 English short name. |
| `un_status` | text | `member_state` (193), `observer_state` (Holy See, State of Palestine) or `non_member`. |
| `is_un_member` | flag | True for the 193 UN Member States. |
| `un_regional_group` | text | AG, APG, EEG, GRULAC or WEOG, for electoral purposes. Türkiye: WEOG (also participates in APG). United States: WEOG observer, counted in WEOG for elections. |
| `region`, `sub_region`, `intermediate_region` | text | UN M49 geoscheme. |
| `analysis_region` | text | Intermediate region where M49 defines one, otherwise the sub-region. |
| `sdg_region` | text | One of the eight SDG regions of the SDG Progress Report. |
| `is_ldc`, `is_lldc`, `is_sids` | flag | UN M49 development groups. SIDS includes some non-member territories. |
| `wb_region`, `wb_income_group`, `wb_lending_type` | text | World Bank classifications for the current fiscal year. |
| `is_fcs` | flag | On the World Bank list of fragile and conflict-affected situations. |
| `fcs_category` | text | Conflict, or Institutional and Social Fragility. Not published from FY27. |
| `is_oda_eligible`, `oda_recipient_group` | flag, text | OECD DAC List of ODA Recipients and its group (LDCs, Other LICs, LMICs, UMICs). |
| `is_oecd_member` | flag | One of the 38 OECD Member countries. |
| `capital`, `latitude`, `longitude` | text, number | Capital city and its coordinates (World Bank). |
| `name_ar`, `name_zh`, `name_fr`, `name_ru`, `name_es` | text | UN M49 short names in the other UN languages. |

## `country_group_membership.csv`

One row per country and group.

| Column | Meaning |
|---|---|
| `iso3`, `iso2`, `m49` | Country codes. |
| `source` | `un_membership`, `un_m49`, `un_sdg`, `world_bank`, `world_bank_fcs`, `oecd`, `oecd_dac`. |
| `group_type` | Kind of group within the source, e.g. `region`, `income_level`, `membership`, `regional_group`. |
| `group_code` | The publisher's code, where it has one. |
| `group_name` | Group name. Names repeat across systems ("Africa" is an M49 and an SDG group). |
| `group_id` | Stable id, unique across sources, e.g. `un_membership.regional_group.ag`. Use this in code. |
| `country_name` | UN M49 English short name. |
| `is_un_member` | UN Member State (`true`/`false`). |

## `groups.csv`

One row per catalogued group: `group_id`, `system`, `group_name`, `group_code`, `source`, `group_type`,
`organization`, `n_members`, `n_un_members`, `system_description`.

## Reference lists (`reference/`)

`un_membership.csv` (193 Member States, 2 observer States, regional groups) and `oecd_members.csv` (38). Curated by hand
from the publishers' pages; the pipeline stops if the counts drift. See [`reference/README.md`](./reference/README.md).

---

The files below are kept for existing users.

## `world_reference.csv`

Wide format, one row per country/area. Column names aligned with UNStats/OSAA World reference style for dashboard use (Power BI, Tableau, Excel).

- `Global Code`, `Global Name`: UN global aggregate
- `Region Code`, `Region Name`: UN M49 region
- `Sub-region Code`, `Sub-region Name`: UN M49 sub-region
- `Intermediate Region Code`, `Intermediate Region Name`: UN M49 intermediate region
- `Country or Area`: English name
- `m49`, `iso2`, `iso3`: standard codes
- `Least Developed Countries (LDC)`, `Land Locked Developing Countries (LLDC)`, `Small Island Developing States (SIDS)`: label or empty
- `High income`, `Low income`, `Lower middle income`, `Upper middle income`: one filled per row or empty
- `OECD member`, `Fragile and Conflict-Affected Situations`, `UN Member State`: label or empty. (Before 2.0.0, `OECD member` was wrongly derived from ODA eligibility.)

## `aggregates.csv`

Long format, one row per country–group pair. Columns: `Country or Area`, `M49 Code`, `iso2`, `iso3`, `country_grouping`. Matches OSAA Aggregates style.

## `countries_master.csv`

- `iso3`: ISO 3166-1 alpha-3 country/area code
- `iso2`: ISO 3166-1 alpha-2 country/area code
- `m49`: UN M49 numeric code (normalized numeric string)
- `country_name_en`: English country/area name (UN M49 table)
- `country_name_ar`: Arabic country/area name
- `country_name_zh`: Chinese country/area name
- `country_name_fr`: French country/area name
- `country_name_ru`: Russian country/area name
- `country_name_es`: Spanish country/area name
- `country_name_sdg_en`: UN SDG API GeoArea English name
- `global_code`, `global_name_en`: UN global aggregate code/name
- `region_code`, `region_name_en`: UN M49 region
- `sub_region_code`, `sub_region_name_en`: UN M49 sub-region
- `intermediate_region_code`, `intermediate_region_name_en`: UN M49 intermediate region
- `is_ldc`: Flag from UN M49 table (Least Developed Countries)
- `is_lldc`: Flag from UN M49 table (Landlocked Developing Countries)
- `is_sids`: Flag from UN M49 table (Small Island Developing States)
- `wb_country_name`: World Bank country display name
- `wb_region_code`, `wb_region_name`: World Bank region classification
- `wb_income_code`, `wb_income_name`: World Bank income group
- `wb_lending_code`, `wb_lending_name`: World Bank lending category
- `capital_city`: Capital city from World Bank API
- `longitude`, `latitude`: Coordinates from World Bank API
- `wb_fcs_status`: Boolean flag for World Bank FCS inclusion
- `wb_fcs_category`: WB FCS category (`Conflict` or `Institutional and Social Fragility`)
- `wb_fcs_fy`: Fiscal-year label parsed from the latest WB FCS list (for example `FY26`)
- `oecd_dac_eligible`: Boolean flag for OECD DAC ODA-eligibility list membership
- `oecd_dac_wb_group`: OECD DAC-provided WB income shorthand in DAC list
- `oecd_dac_reporting_year`: Reporting year from selected OECD DAC CSV

## `sources.csv`

- `source_id`: stable source key
- `title`: source title
- `url`: source URL
- `organization`: source organization
- `license_note`: usage/licensing note
- `access_utc`: UTC timestamp of data pull
- `notes`: extraction scope notes

## `run_manifest.json`

- `generated_at_utc`: snapshot generation timestamp
- `snapshot_id`: timestamp-based run id
- `record_counts`: row counts per output
- `files`: per-file hash metadata
- `changelog_file`: path to generated change report

## `unmapped_external_names.csv`

- `external_name`: Country/area name from external source that failed ISO3 mapping
- `source`: External source id (`world_bank_fcs` or `oecd_dac`)

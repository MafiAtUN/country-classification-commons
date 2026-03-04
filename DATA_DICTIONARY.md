# Data Dictionary

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

## `country_group_membership.csv`

One row per membership.

- `iso3`, `iso2`, `m49`: country keys
- `source`: source system identifier (`un_m49`, `un_sdg`, `world_bank`, `world_bank_fcs`, `oecd_dac`)
- `group_type`: classification type within source
- `group_code`: source-provided group code when available
- `group_name`: source-provided group name

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

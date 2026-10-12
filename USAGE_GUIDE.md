# Usage Guide

The full, tested guides with copy-paste code live on the website:
**[Use it in your tool](https://mafiatun.github.io/country-classification-commons/guides.html)**:
Power BI, Tableau, Qlik Sense, Excel, Google Sheets, Python, R, Julia, JavaScript, SQL (DuckDB, PostgreSQL) and Stata.

For a specific list, build it in the [Explorer](https://mafiatun.github.io/country-classification-commons/explorer.html)
and press **Get code**: it writes Python, R, SQL, Power Query, JavaScript or Julia that rebuilds exactly that list from the live files.

## The two links you need

```text
https://mafiatun.github.io/country-classification-commons/data/countries.csv
https://mafiatun.github.io/country-classification-commons/data/country_group_membership.csv
```

The same files are at `https://raw.githubusercontent.com/MafiAtUN/country-classification-commons/main/data/latest/<file>`.
For a fixed version, use `data/history/<snapshot>/<file>`.

## Four things that trip people up

1. **Namibia's ISO2 code is `NA`.** pandas (`keep_default_na=False`), readr (`na = ""`) and data.table (`na.strings = ""`) need telling.
2. **Keep codes as text.** `m49` has leading zeros (`004`). Join on `iso3` when you can.
3. **Flags are `true`/`false`.** Most tools make them booleans; if yours keeps text, compare with `"true"`.
4. **UTF-8.** Use code page 65001 in Excel and Power BI.

## The filter most people need

Only the 193 UN Member States: `is_un_member = true`. Africa then has 54 rows, as the UN General Assembly counts it.
Without the filter, UN M49 "Africa" has 60 rows, including six territories. See
[why](https://mafiatun.github.io/country-classification-commons/about.html#un-membership).

## Modelling in BI tools

- `countries[iso3]` 1 → * `your_data[iso3]`.
- For groups that are not columns (SDG groupings, OECD DAC groups), add `country_group_membership[iso3]` * → 1 `countries[iso3]`
  with filtering in both directions (Power BI) or as a relationship (Tableau). In Qlik, load only `iso3` plus the group fields
  from the membership file to avoid synthetic keys.

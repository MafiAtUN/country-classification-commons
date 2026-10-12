<div align="center">

<a href="https://nerd-factory.github.io/nerd-lab/"><img src="docs/assets/img/mark-e.svg" alt="Nerd Lab" width="44"></a>

**[Nerd Lab](https://nerd-factory.github.io/nerd-lab/) presents**

# Country Classification Commons

Every official country grouping from the UN, World Bank and OECD, in one open, auto-refreshing table.

[![Update Data](https://github.com/MafiAtUN/country-classification-commons/actions/workflows/update-data.yml/badge.svg)](https://github.com/MafiAtUN/country-classification-commons/actions/workflows/update-data.yml)
[![Deploy Pages](https://github.com/MafiAtUN/country-classification-commons/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/MafiAtUN/country-classification-commons/actions/workflows/deploy-pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

**[Explorer](https://mafiatun.github.io/country-classification-commons/explorer.html)** ·
**[Use it in your tool](https://mafiatun.github.io/country-classification-commons/guides.html)** ·
**[Data](https://mafiatun.github.io/country-classification-commons/data.html)** ·
**[Method](https://mafiatun.github.io/country-classification-commons/about.html)**

</div>

---

## How many countries are in Africa?

**54** if you ask the UN General Assembly. **60** if you ask the UN statistical standard (M49), which also lists
Réunion, Mayotte, Western Sahara and three other areas. **48** if you ask the World Bank about Sub-Saharan Africa.

Every answer is official. They answer different questions. This project publishes all of them side by side, and marks
every row with its UN membership status, so the definition you use is a choice rather than an accident.

## Get the data

| File | Shape | Use it for |
|---|---|---|
| [`countries.csv`](https://mafiatun.github.io/country-classification-commons/data/countries.csv) | one row per country or area (248) | Start here. UN membership and regional group, M49 and SDG regions, LDC/LLDC/SIDS, World Bank region/income/lending, FCS, ODA eligibility, OECD membership, names in six languages. |
| [`country_group_membership.csv`](https://mafiatun.github.io/country-classification-commons/data/country_group_membership.csv) | one row per country and group | Any grouping that is not a column, and many-to-many models in BI tools. |
| [`groups.csv`](https://mafiatun.github.io/country-classification-commons/data/groups.csv) | one row per group (121) | The catalogue: member counts and UN Member State counts per group. |

Plain CSV, one header row, `true`/`false` flags, UTF-8. The links are permanent and refresh twice every weekday.
JSON copies sit next to them. Older formats (`world_reference.csv`, `aggregates.csv`, `countries_master.csv`) are still published.

```python
import pandas as pd

url = "https://mafiatun.github.io/country-classification-commons/data/countries.csv"
countries = pd.read_csv(url, keep_default_na=False, dtype={"m49": str})  # keeps Namibia's ISO2 "NA"

countries[(countries.region == "Africa") & countries.is_un_member]  # 54 rows
```

```r
countries <- readr::read_csv("https://mafiatun.github.io/country-classification-commons/data/countries.csv",
                             na = "", col_types = readr::cols(m49 = "c"))
dplyr::filter(countries, region == "Africa", is_un_member)  # 54 rows
```

```sql
-- DuckDB
SELECT name FROM 'https://mafiatun.github.io/country-classification-commons/data/countries.csv'
WHERE region = 'Africa' AND is_un_member;  -- 54 rows
```

Step-by-step guides for **Power BI, Tableau, Qlik Sense, Excel, Google Sheets, Python, R, Julia, JavaScript, SQL and Stata**
are on the [Use it](https://mafiatun.github.io/country-classification-commons/guides.html) page. The
[Explorer](https://mafiatun.github.io/country-classification-commons/explorer.html) builds any list you need (combine,
exclude, compare, map) and writes the code to rebuild it in your tool.

## The UN membership column

| `un_status` | Rows | Meaning |
|---|---|---|
| `member_state` | 193 | UN Member States. `is_un_member` is true. |
| `observer_state` | 2 | Holy See, State of Palestine. |
| `non_member` | 53 | Territories and other areas listed in UN M49 for statistical purposes. |

`un_regional_group` gives each Member State's UN regional group (AG, APG, EEG, GRULAC, WEOG) for electoral purposes.
Notes on Türkiye, the United States and Israel are in the [method](https://mafiatun.github.io/country-classification-commons/about.html#regional-groups).

## Sources

| Publisher | What | How |
|---|---|---|
| UN Statistics Division | M49 codes, regions, LDC/LLDC/SIDS, names in six languages | [M49 overview](https://unstats.un.org/unsd/methodology/m49/overview/), all language tabs |
| UN SDG Global Database | SDG regional groupings | [SDG API](https://unstats.un.org/SDGAPI/swagger/) GeoArea list and tree |
| UN General Assembly (DGACM) | Member States, observer States, regional groups | [Regional groups](https://www.un.org/dgacm/en/content/regional-groups), curated in [`reference/`](./reference/) |
| World Bank | Region, income group, lending category, capital | [Country API](https://api.worldbank.org/v2/country?format=json) |
| World Bank | Fragile and conflict-affected situations | Current fiscal-year list, auto-discovered |
| OECD | DAC List of ODA Recipients | Latest CSV, auto-discovered |
| OECD | 38 Member countries | Curated in [`reference/`](./reference/) |

Each run checks that UN membership adds up to 193 + 2 and OECD to 38, records unmatched names in
`unmapped_external_names.csv`, keeps a dated snapshot in [`data/history/`](./data/history/) and writes a plain-language
diff to [`data/changelog/`](./data/changelog/).

## How it runs

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/update_data.py      # fetch, build, diff, snapshot, copy to docs/data/
python scripts/build_shell.py      # only after editing the shared header/footer templates
```

- [`update-data.yml`](./.github/workflows/update-data.yml) runs the pipeline at 05:17 and 17:17 UTC on weekdays and 09:42 UTC on Sundays.
- [`deploy-pages.yml`](./.github/workflows/deploy-pages.yml) publishes `docs/` after every refresh and every site change.
- The site is static HTML, CSS and JavaScript in [`docs/`](./docs/). No build step; `scripts/build_shell.py` stamps the shared header and footer into each page.

Column definitions: [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) · Source notes: [`SOURCE_METHODOLOGY.md`](./SOURCE_METHODOLOGY.md) · Version history: [`CHANGELOG.md`](./CHANGELOG.md)

## Not an official product

Country Classification Commons is an independent open-source project. It is not issued or endorsed by the United Nations,
the World Bank or the OECD; for anything formal, check the publisher's own list. The designations employed do not imply
the expression of any opinion concerning the legal status of any country, territory, city or area or of its authorities,
or concerning the delimitation of its frontiers or boundaries.

## Cite

> Islam, M. (2026). *Country Classification Commons: official country groupings from the UN, World Bank and OECD in one open table* [Data set]. Nerd Lab. https://mafiatun.github.io/country-classification-commons/

Also cite the publisher of each classification you use. Machine-readable citation: [`CITATION.cff`](./CITATION.cff).

## Contribute

Bug reports, source proposals and fixes are welcome: see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Security issues: [`SECURITY.md`](./SECURITY.md).

---

<div align="center">
<sub>A <a href="https://nerd-factory.github.io/nerd-lab/">Nerd Lab</a> experiment. Unnecessarily clever. Occasionally useful.<br>
Maintained by <a href="https://github.com/MafiAtUN">Mafizul Islam</a>. Code MIT; data under each publisher's terms.</sub>
</div>

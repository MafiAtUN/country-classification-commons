# Reference lists

Small, slow-changing lists that the official sources do not publish in a machine-readable form.
`scripts/update_data.py` reads them on every run and fails loudly if the counts drift.

| File | What | Source | Last checked |
|---|---|---|---|
| `un_membership.csv` | 193 UN Member States and 2 non-member observer States, with each Member State's regional group | [UN DGACM: Regional groups of Member States](https://www.un.org/dgacm/en/content/regional-groups) · [UN Member States](https://www.un.org/en/about-us/member-states) | 2026-10-12 |
| `oecd_members.csv` | 38 OECD Member countries | [OECD: Members and partners](https://www.oecd.org/en/about/members-partners.html) | 2026-10-12 |

`un_regional_group` is the group used for electoral purposes: AG (African Group), APG (Asia-Pacific Group),
EEG (Eastern European Group), GRULAC (Latin American and Caribbean Group), WEOG (Western European and Others Group).
Türkiye participates in both APG and WEOG (`also_participates_in`). The United States is a WEOG observer treated as a
member for electoral purposes.

When membership changes, edit the CSV, update the expected count in `scripts/update_data.py`, and update the date above.

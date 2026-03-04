# Research Notes on Country Classification Sources

Date checked: **March 4, 2026 (UTC)**.

## Integrated in Pipeline

1. **UN Statistics Division (UN M49 overview, multilingual)**
   - <https://unstats.un.org/unsd/methodology/m49/overview/>
   - Why: official UN statistical country/area coding standard; includes M49/ISO2/ISO3 and UN geoscheme plus LDC/LLDC/SIDS flags and UN-language names.

2. **UN SDG API - GeoArea list**
   - <https://unstats.un.org/SDGAPI/v1/sdg/GeoArea/List>
   - Why: official SDG API list of geo areas and codes used in SDG data APIs.

3. **UN SDG API - GeoArea hierarchy tree**
   - <https://unstats.un.org/SDGAPI/v1/sdg/GeoArea/Tree>
   - Why: machine-readable SDG region hierarchy for group membership modeling.

4. **World Bank API - Country metadata**
   - <https://api.worldbank.org/v2/country?format=json&per_page=1000>
   - Why: globally used development classifications (region, income group, lending type) and country metadata.

## High-Value Additional Sources (Candidate Integrations)

1. **World Bank Fragile and Conflict-Affected Situations (FCS) lists**
   - Landing page: <https://www.worldbank.org/en/topic/fragilityconflictviolence/brief/harmonized-list-of-fragile-situations>
   - Note: yearly XLSX links rotate and should be discovered dynamically from the page before ingest.

2. **OECD DAC list of ODA recipients**
   - Portal page: <https://www.oecd.org/en/data/datasets/oda-eligibility-and-concessionality-recipients-of-official-development-assistance-oda.html>
   - File service root observed: <https://webfs.oecd.org/oda2024/>
   - Note: path/version is year-specific and should be auto-discovered per run.

3. **UNSD M49 download artifacts (CSV/XLSX/TXT)**
   - Base page: <https://unstats.un.org/unsd/methodology/m49/>
   - Note: direct download endpoints can be session-dependent; overview table parsing is currently more stable.

## Additional Sources Confirmed in Latest Research Pass

1. **World Bank - Classification of Fragile and Conflict-Affected Situations**
   - Page: <https://www.worldbank.org/en/topic/fragilityconflictviolence/brief/classification-of-fragile-and-conflict-affected-situations>
   - Current list observed: **FY26 FCS List** (updated July 8, 2025), PDF:
     <https://thedocs.worldbank.org/en/doc/5c7e4e268baaafa6ef38d924be9279be-0090082025/original/FCSListFY26.pdf>
   - Historical FY06-FY25 PDF:
     <https://thedocs.worldbank.org/en/doc/b7176d1485821af6f7638e63e266c717-0090082025/original/FCSList-FY06toFY25.pdf>
   - Value: high-demand fragility classification used in development operations.

2. **OECD DAC - ODA recipient eligibility list**
   - Main page: <https://www.oecd.org/en/topics/sub-issues/oda-eligibility-and-conditions/dac-list-of-oda-recipients.html>
   - Historical directory (includes CSV files): <https://webfs.oecd.org/oda/DAClists/>
   - Current files observed include:
     - `DAC-List-of-ODA-Recipients-for-reporting-2024-flows.csv`
     - `DAC List of Aid Recipients - 2025 flows.pdf`
   - Value: official aid-eligibility grouping, useful for development finance analysis.

3. **IMF Data Portal - WEO Groups and Aggregates (October 2025)**
   - Dataset page: <https://data.imf.org/en/datasets/IMF.RES:WEO>
   - Groups page (updated October 2025):
     <https://data.imf.org/en/Datasets/WEO/Groups-and-Aggregates-October-2025>
   - Value: widely referenced macroeconomic country group classifications (advanced vs emerging/developing and regional blocks).

4. **UNCTAD - UN list of Least Developed Countries**
   - Page: <https://unctad.org/topic/least-developed-countries/list>
   - States currently **44 LDCs** (date marker: December 2024).
   - Value: explicit current LDC roster and policy context from UN trade/development system.

5. **World Bank Data Help Desk - Country and Lending Groups**
   - Page: <https://datahelpdesk.worldbank.org/knowledgebase/articles/906519-world-bank-country-and-lending-groups>
   - Includes links to current and historical income-classification XLSX files.
   - Value: versioned income-classification releases complement the API.

## Integration Priority Recommendation

1. Add **WB FCS FYxx** classification next (high policy relevance, annual cadence).
2. Add **OECD DAC ODA recipient eligibility** (CSV available in webfs directory).
3. Add **IMF WEO groups** (public page now on IMF Data portal; API may require sign-in token).

#!/usr/bin/env python3
"""Build country classification datasets from authoritative sources.

Outputs:
- data/latest/countries_master.csv
- data/latest/country_group_membership.csv
- data/latest/country_classification_library.csv
- data/latest/countries.csv (flagship: one row per country/area, analysis-ready)
- data/latest/groups.csv (catalogue: one row per group, with member counts)
- data/latest/aggregates.csv (long format, OSAA-style)
- data/latest/world_reference.csv (wide format, one row per country, UNStats-style)
- data/latest/sources.csv
- data/latest/run_manifest.json
- data/latest/unmapped_external_names.csv
- data/history/<timestamp>/...
- data/changelog/changes_<timestamp>.md
- docs/data/* (copies for GitHub Pages)
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import shutil
import subprocess
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
LATEST_DIR = DATA_DIR / "latest"
HISTORY_DIR = DATA_DIR / "history"
CHANGELOG_DIR = DATA_DIR / "changelog"
DOCS_DATA_DIR = ROOT / "docs" / "data"

REFERENCE_DIR = ROOT / "reference"

# CSV outputs start with the header row: no comment or attribution lines. Power BI, Tableau,
# Qlik, Excel, DuckDB and every CSV reader then load them with default settings.
# Attribution lives in README.md, CITATION.cff and sources.csv.

EXPECTED_UN_MEMBER_STATES = 193
EXPECTED_UN_OBSERVER_STATES = 2
EXPECTED_OECD_MEMBERS = 38

UN_REGIONAL_GROUP_NAMES = {
    "AG": "African Group",
    "APG": "Asia-Pacific Group",
    "EEG": "Eastern European Group",
    "GRULAC": "Latin American and Caribbean Group",
    "WEOG": "Western European and Others Group",
}

# The eight SDG regions used in the Secretary-General's SDG Progress Report (UN SDG GeoArea codes).
SDG_REGION_CODES = ["202", "747", "62", "753", "419", "53", "543", "513"]

UN_M49_OVERVIEW_URL = "https://unstats.un.org/unsd/methodology/m49/overview/"
UN_SDG_GEOAREA_LIST_URL = "https://unstats.un.org/SDGAPI/v1/sdg/GeoArea/List"
UN_SDG_GEOAREA_TREE_URL = "https://unstats.un.org/SDGAPI/v1/sdg/GeoArea/Tree"
WORLD_BANK_COUNTRY_API = "https://api.worldbank.org/v2/country"
WORLD_BANK_FCS_PAGE_URL = "https://www.worldbank.org/en/topic/fragilityconflictviolence/brief/classification-of-fragile-and-conflict-affected-situations"
OECD_DAC_DIRECTORY_URL = "https://webfs.oecd.org/oda/DAClists/"

LANG_SECTIONS = {
    "ENG_Overview": "en",
    "ARB_Overview": "ar",
    "CHN_Overview": "zh",
    "FRA_Overview": "fr",
    "RUS_Overview": "ru",
    "ESP_Overview": "es",
}

# Name aliases for external sources that do not publish ISO3 directly.
EXTERNAL_NAME_ALIASES = {
    "china peoples republic of": "CHN",
    "democratic peoples republic of korea": "PRK",
    "lao peoples democratic republic": "LAO",
    "viet nam": "VNM",
    "turkiye": "TUR",
    "gambia": "GMB",
    "congo": "COG",
    "congo republic of": "COG",
    "democratic republic of the congo": "COD",
    "congo democratic republic of": "COD",
    "west bank and gaza strip": "PSE",
    "west bank and gaza territory": "PSE",
    "syrian arab republic": "SYR",
    "micronesia": "FSM",
    "micronesia federated states of": "FSM",
    "yemen": "YEM",
    "yemen republic of": "YEM",
    "iran": "IRN",
    "venezuela": "VEN",
    "venezuela rb": "VEN",
    "sao tome and principe": "STP",
    "cote divoire": "CIV",
    "cabo verde": "CPV",
    "egypt": "EGY",
    "tanzania": "TZA",
    "kosovo": "XKX",
    "wallis and futuna": "WLF",
    "nauru": "NRU",  # UN M49 English short name is now "Naoero"
}


@dataclass
class SourceRecord:
    source_id: str
    title: str
    url: str
    organization: str
    license_note: str
    access_utc: str
    notes: str


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_bool_flag(value: str) -> bool:
    return str(value).strip().lower() == "x"


def normalize_code(raw: Any) -> str:
    if raw is None:
        return ""
    value = str(raw).strip()
    if not value:
        return ""
    if value.isdigit():
        return str(int(value))
    return value


def as_clean_str(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, float) and pd.isna(raw):
        return ""
    return str(raw).strip()


def humanize_group_name(source: str, group_type: str, group_code: str, group_name: str) -> str:
    name = as_clean_str(group_name)
    code = as_clean_str(group_code)
    if not name:
        return ""

    if source == "world_bank_fcs" and group_type == "fcs_fiscal_year":
        return f"World Bank FCS list fiscal year {name}"

    if source == "oecd_dac" and group_type == "reporting_year":
        return f"OECD DAC reporting year {name} flows"

    if source == "oecd_dac" and group_type == "wb_income_hint":
        mapping = {
            "WB-L": "World Bank low income (WB-L)",
            "WB-LM": "World Bank lower middle income (WB-LM)",
            "WB-UM": "World Bank upper middle income (WB-UM)",
            "WB-H": "World Bank high income (WB-H)",
            "WB-NC": "World Bank not classified (WB-NC)",
        }
        return mapping.get(name, f"World Bank income hint {name}")

    if source == "world_bank" and group_type == "lending_type":
        mapping = {
            "IDA": "International Development Association (IDA)",
            "IBRD": "International Bank for Reconstruction and Development (IBRD)",
            "Blend": "Blend financing (IBRD and IDA eligible)",
            "Not classified": "World Bank lending type: Not classified",
        }
        return mapping.get(name, name)

    if source == "oecd_dac" and group_type == "oda_recipient_group":
        mapping = {
            "LDCs": "OECD DAC ODA recipients: Least Developed Countries (LDCs)",
            "LMICs": "OECD DAC ODA recipients: Lower Middle Income Countries (LMICs)",
            "UMICs": "OECD DAC ODA recipients: Upper Middle Income Countries (UMICs)",
            "Other LICs": "OECD DAC ODA recipients: Other Low Income Countries (Other LICs)",
        }
        return mapping.get(name, name)

    return name


def normalize_name(raw: Any) -> str:
    text = as_clean_str(raw).lower()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("&", " and ")
    text = re.sub(r"\(.*?\)", " ", text)
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def fetch_json(session: requests.Session, url: str) -> Any:
    res = session.get(url, timeout=60)
    res.raise_for_status()
    return res.json()


def fetch_un_m49_multilingual(session: requests.Session) -> pd.DataFrame:
    res = session.get(UN_M49_OVERVIEW_URL, timeout=60)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "lxml")

    lang_tables: dict[str, pd.DataFrame] = {}
    for section_id, lang in LANG_SECTIONS.items():
        section = soup.find(id=section_id)
        if section is None:
            raise RuntimeError(f"UN M49 section not found: {section_id}")
        table = section.find_next("table")
        if table is None:
            raise RuntimeError(f"UN M49 table not found for section: {section_id}")

        rows: list[list[str]] = []
        for tr in table.select("tbody tr"):
            cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
            if len(cells) < 15:
                continue
            rows.append(cells[:15])

        df = pd.DataFrame(
            rows,
            columns=[
                "global_code",
                "global_name",
                "region_code",
                "region_name",
                "sub_region_code",
                "sub_region_name",
                "intermediate_region_code",
                "intermediate_region_name",
                "country_name",
                "m49",
                "iso2",
                "iso3",
                "is_ldc",
                "is_lldc",
                "is_sids",
            ],
        )
        df["m49"] = df["m49"].map(normalize_code)
        df["iso2"] = df["iso2"].astype(str).str.strip().str.upper()
        df["iso3"] = df["iso3"].astype(str).str.strip().str.upper()
        lang_tables[lang] = df

    eng = lang_tables["en"].copy()
    eng = eng[eng["iso3"].str.len() == 3].copy()

    eng["global_code"] = eng["global_code"].map(normalize_code)
    eng["region_code"] = eng["region_code"].map(normalize_code)
    eng["sub_region_code"] = eng["sub_region_code"].map(normalize_code)
    eng["intermediate_region_code"] = eng["intermediate_region_code"].map(normalize_code)
    eng["is_ldc"] = eng["is_ldc"].map(to_bool_flag)
    eng["is_lldc"] = eng["is_lldc"].map(to_bool_flag)
    eng["is_sids"] = eng["is_sids"].map(to_bool_flag)

    eng = eng.rename(
        columns={
            "global_name": "global_name_en",
            "region_name": "region_name_en",
            "sub_region_name": "sub_region_name_en",
            "intermediate_region_name": "intermediate_region_name_en",
            "country_name": "country_name_en",
        }
    )

    for lang in ["ar", "zh", "fr", "ru", "es"]:
        t = lang_tables[lang][["m49", "iso3", "country_name"]].copy()
        t = t[t["iso3"].str.len() == 3]
        t = t.rename(columns={"country_name": f"country_name_{lang}"})
        eng = eng.merge(t, on=["m49", "iso3"], how="left")

    eng = eng.sort_values(["country_name_en", "iso3"]).reset_index(drop=True)
    return eng


def fetch_world_bank(session: requests.Session) -> pd.DataFrame:
    page = 1
    rows: list[dict[str, Any]] = []

    while True:
        params = {"format": "json", "per_page": 1000, "page": page}
        payload = fetch_json(session, WORLD_BANK_COUNTRY_API + "?" + requests.compat.urlencode(params))
        meta = payload[0]
        data = payload[1]
        for item in data:
            iso3 = str(item.get("id", "")).strip().upper()
            iso2 = str(item.get("iso2Code", "")).strip().upper()
            if len(iso3) != 3 or len(iso2) != 2:
                continue
            rows.append(
                {
                    "iso3": iso3,
                    "iso2_wb": iso2,
                    "wb_country_name": item.get("name", ""),
                    "wb_region_code": (item.get("region") or {}).get("id", ""),
                    "wb_region_name": (item.get("region") or {}).get("value", "").strip(),
                    "wb_income_code": (item.get("incomeLevel") or {}).get("id", ""),
                    "wb_income_name": (item.get("incomeLevel") or {}).get("value", "").strip(),
                    "wb_lending_code": (item.get("lendingType") or {}).get("id", ""),
                    "wb_lending_name": (item.get("lendingType") or {}).get("value", "").strip(),
                    "capital_city": item.get("capitalCity", "").strip(),
                    "longitude": item.get("longitude", ""),
                    "latitude": item.get("latitude", ""),
                }
            )
        if page >= int(meta["pages"]):
            break
        page += 1

    wb = pd.DataFrame(rows).drop_duplicates(subset=["iso3"])
    return wb


def fetch_un_sdg_geoareas(session: requests.Session) -> tuple[pd.DataFrame, pd.DataFrame]:
    geo_list = fetch_json(session, UN_SDG_GEOAREA_LIST_URL)
    tree = fetch_json(session, UN_SDG_GEOAREA_TREE_URL)

    countries = pd.DataFrame(geo_list).rename(
        columns={"geoAreaCode": "m49", "geoAreaName": "sdg_geoarea_name_en"}
    )
    countries["m49"] = countries["m49"].map(normalize_code)

    memberships: list[dict[str, str]] = []

    def walk(nodes: list[dict[str, Any]], ancestors: list[dict[str, Any]]) -> None:
        for node in nodes:
            current = {
                "code": normalize_code(node.get("geoAreaCode")),
                "name": str(node.get("geoAreaName", "")).strip(),
                "type": str(node.get("type", "")).strip(),
            }
            node_type = current["type"].lower()
            is_leaf_country = node_type in {"country", "area", "country or area"}
            if is_leaf_country and current["code"]:
                for anc in ancestors:
                    if anc["type"].lower() == "region":
                        memberships.append(
                            {
                                "m49": current["code"],
                                "sdg_group_code": anc["code"],
                                "sdg_group_name": anc["name"],
                                "sdg_group_type": anc["type"],
                            }
                        )
            children = node.get("children") or []
            if children:
                walk(children, ancestors + [current])

    walk(tree, [])
    mdf = pd.DataFrame(memberships).drop_duplicates()
    return countries, mdf


def fetch_oecd_dac_latest(session: requests.Session) -> tuple[pd.DataFrame, str]:
    res = session.get(OECD_DAC_DIRECTORY_URL, timeout=60)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "lxml")

    candidates: list[tuple[tuple[int, int], str]] = []
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if not href.lower().endswith(".csv"):
            continue
        if "DAC-List-of-ODA-Recipients-for-reporting" not in href:
            continue
        years = [int(y) for y in re.findall(r"(20\d{2})", href)]
        score = (max(years) if years else 0, len(years))
        abs_url = requests.compat.urljoin(OECD_DAC_DIRECTORY_URL, href)
        candidates.append((score, abs_url))

    if not candidates:
        raise RuntimeError("No OECD DAC CSV candidates found in directory listing")

    _, selected_url = sorted(candidates, reverse=True)[0]
    csv_bytes = session.get(selected_url, timeout=60).content
    df = pd.read_csv(io.BytesIO(csv_bytes), encoding="latin1")
    df = df.rename(
        columns={
            "RecipientCode": "oecd_recipient_code",
            "RecipientNameE": "oecd_recipient_name_en",
            "RecipientNameF": "oecd_recipient_name_fr",
            "GroupID": "oecd_group_id",
            "GroupNameE": "oecd_group_name_en",
            "GroupNameF": "oecd_group_name_fr",
            "WBGroup": "oecd_wb_group",
            "Year": "oecd_reporting_year",
        }
    )
    keep_cols = [
        "oecd_recipient_code",
        "oecd_recipient_name_en",
        "oecd_group_id",
        "oecd_group_name_en",
        "oecd_wb_group",
        "oecd_reporting_year",
    ]
    for col in keep_cols:
        if col not in df.columns:
            df[col] = ""
    df = df[keep_cols].copy()
    df["oecd_group_id"] = df["oecd_group_id"].map(normalize_code)
    df["oecd_reporting_year"] = df["oecd_reporting_year"].map(normalize_code)
    df = df.drop_duplicates()
    return df, selected_url


def _parse_fcs_text_layout(text: str, fy_label: str) -> list[dict[str, str]]:
    """Parse FCS PDF text extracted with layout mode (two-column preserved).

    pypdf extraction_mode='layout' preserves columns as spaces, so each line
    may contain a left-column entry (Conflict) and/or a right-column entry
    (Institutional and Social Fragility) separated by many spaces.
    We detect the column split position from the header line.
    """
    rows: list[dict[str, str]] = []
    lines = text.splitlines()

    # FY27+ "Public FCV List": one table of Country | Region | ISO3c, no category split.
    if any("ISO3C" in line.upper() for line in lines):
        for line in lines:
            m = re.match(r"^\s*(\S.*?)\s{2,}.*?\s{2,}([A-Z]{3})\s*$", line)
            if m and m.group(2) != "ISO":
                rows.append({"fcs_country_name": m.group(1).strip(), "iso3": m.group(2),
                             "wb_fcs_category": "", "wb_fcs_fy": fy_label})
        return rows

    # Find the header line that contains both category names; use it to
    # determine the character-position boundary between the two columns.
    col_split = None
    header_line_idx = None
    for i, line in enumerate(lines):
        upper = line.upper()
        if "CONFLICT" in upper and "INSTITUTIONAL" in upper:
            # The split is approximately at the start of "INSTITUTIONAL"
            col_split = upper.index("INSTITUTIONAL")
            header_line_idx = i
            break

    if col_split is not None:
        # Two-column layout: split each row at the last run of 5+ spaces.
        # This is more reliable than using the header's character position.
        for line in lines[header_line_idx + 1 :]:
            stripped = line.strip()
            if not stripped:
                continue
            upper = stripped.upper()
            if upper.startswith("OFFICIAL USE") or (upper.startswith("FY") and "FRAGILE" in upper):
                break

            # Find last whitespace gap of >=5 spaces to detect column boundary.
            gap_matches = list(re.finditer(r" {5,}", line))
            if gap_matches:
                last_gap = gap_matches[-1]
                left  = line[:last_gap.start()].strip()
                right = line[last_gap.end():].strip()
            else:
                left  = stripped
                right = ""

            if left:
                rows.append({"fcs_country_name": left,  "wb_fcs_category": "Conflict",                          "wb_fcs_fy": fy_label})
            if right:
                rows.append({"fcs_country_name": right, "wb_fcs_category": "Institutional and Social Fragility", "wb_fcs_fy": fy_label})
    else:
        # Single-column layout (pdftotext output): parse sequentially.
        section = ""
        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue
            upper = line.upper()
            if upper == "CONFLICT":
                section = "Conflict"
                continue
            if upper == "INSTITUTIONAL AND SOCIAL FRAGILITY":
                section = "Institutional and Social Fragility"
                continue
            if upper.startswith("FY") and "FRAGILE" in upper:
                continue
            if upper.startswith("OFFICIAL USE"):
                break
            if not section:
                continue
            rows.append({"fcs_country_name": line, "wb_fcs_category": section, "wb_fcs_fy": fy_label})

    return rows


def fetch_world_bank_fcs_latest(session: requests.Session) -> tuple[pd.DataFrame, str, str]:
    res = session.get(WORLD_BANK_FCS_PAGE_URL, timeout=60)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "lxml")

    # File names seen so far: FCSListFY25.pdf (to FY26), A1-FY27-FCV-List.pdf (from FY27).
    # The historical file (C2-FCSList-FY06toFY26.pdf) must not match.
    patterns = [r"FCSListFY(\d{2})\.pdf$", r"FY(\d{2})-FC[SV]-List\.pdf$"]
    candidates: list[tuple[int, str]] = []
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        m = next((m for pat in patterns if (m := re.search(pat, href, re.IGNORECASE))), None)
        if not m:
            continue
        fy = int(m.group(1))
        abs_url = requests.compat.urljoin(WORLD_BANK_FCS_PAGE_URL, href)
        candidates.append((fy, abs_url))

    if not candidates:
        raise RuntimeError("No WB FCS FY PDF candidates found")

    fy, selected_url = sorted(candidates, reverse=True)[0]
    fy_label = f"FY{fy}"

    pdf_bytes = session.get(selected_url, timeout=60).content

    # Primary: pypdf with layout mode (pure Python, no system dependencies).
    text = None
    try:
        import io as _io
        from pypdf import PdfReader
        reader = PdfReader(_io.BytesIO(pdf_bytes))
        text = "\n".join(
            page.extract_text(extraction_mode="layout") or ""
            for page in reader.pages
        )
    except Exception as exc:
        print(f"pypdf extraction failed ({exc}); trying pdftotext fallback")

    # Fallback: pdftotext (requires poppler-utils installed on the system).
    if not text:
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "fcs.pdf"
            txt_path = Path(tmp) / "fcs.txt"
            pdf_path.write_bytes(pdf_bytes)
            subprocess.run(["pdftotext", str(pdf_path), str(txt_path)], check=True)
            text = txt_path.read_text(encoding="utf-8", errors="ignore")

    rows = _parse_fcs_text_layout(text, fy_label)

    if not rows:
        raise RuntimeError("Failed to parse country names from WB FCS PDF")

    return pd.DataFrame(rows).drop_duplicates(), selected_url, fy_label


def build_country_name_index(countries: pd.DataFrame) -> dict[str, set[str]]:
    index: dict[str, set[str]] = {}
    name_cols = ["country_name_en", "wb_country_name", "country_name_sdg_en"]

    for row in countries.to_dict(orient="records"):
        iso3 = row.get("iso3", "")
        if not iso3:
            continue
        for col in name_cols:
            norm = normalize_name(row.get(col, ""))
            if not norm:
                continue
            index.setdefault(norm, set()).add(iso3)

    return index


def resolve_iso3_from_name(name: str, name_index: dict[str, set[str]]) -> str:
    norm = normalize_name(name)
    if not norm:
        return ""
    if norm in EXTERNAL_NAME_ALIASES:
        return EXTERNAL_NAME_ALIASES[norm]

    candidates = name_index.get(norm, set())
    if len(candidates) == 1:
        return next(iter(candidates))

    # Secondary attempt: remove leading "the".
    norm2 = re.sub(r"^the ", "", norm)
    candidates = name_index.get(norm2, set())
    if len(candidates) == 1:
        return next(iter(candidates))

    return ""


def map_external_rows_to_iso3(
    df: pd.DataFrame,
    name_col: str,
    source_id: str,
    name_index: dict[str, set[str]],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    mapped = df.copy()
    by_name = mapped[name_col].astype(str).map(lambda x: resolve_iso3_from_name(x, name_index))
    known = set().union(*name_index.values()) if name_index else set()
    if "iso3" in mapped.columns:
        # Source publishes ISO3: trust it when it is a code we know, fall back to the name otherwise.
        mapped["iso3"] = mapped["iso3"].where(mapped["iso3"].isin(known), by_name)
    else:
        mapped["iso3"] = by_name

    unmapped = mapped[mapped["iso3"] == ""].copy()
    if not unmapped.empty:
        unmapped = unmapped[[name_col]].drop_duplicates().rename(columns={name_col: "external_name"})
        unmapped["source"] = source_id

    mapped = mapped[mapped["iso3"] != ""].copy()
    return mapped, unmapped


def build_group_memberships(
    countries: pd.DataFrame,
    sdg_groups: pd.DataFrame,
    oecd_groups: pd.DataFrame,
) -> pd.DataFrame:
    out: list[dict[str, Any]] = []

    for row in countries.to_dict(orient="records"):
        iso3 = row["iso3"]
        iso2 = row["iso2"]
        m49 = row["m49"]

        def add(source: str, group_type: str, group_code: str, group_name: str) -> None:
            name = as_clean_str(group_name)
            if not name:
                return
            display_name = humanize_group_name(source, group_type, group_code, name)
            out.append(
                {
                    "iso3": iso3,
                    "iso2": iso2,
                    "m49": m49,
                    "source": source,
                    "group_type": group_type,
                    "group_code": normalize_code(group_code),
                    "group_name": display_name,
                }
            )

        add("un_m49", "global", row.get("global_code", ""), row.get("global_name_en", ""))
        add("un_m49", "region", row.get("region_code", ""), row.get("region_name_en", ""))
        add("un_m49", "sub_region", row.get("sub_region_code", ""), row.get("sub_region_name_en", ""))
        add(
            "un_m49",
            "intermediate_region",
            row.get("intermediate_region_code", ""),
            row.get("intermediate_region_name_en", ""),
        )

        if bool(row.get("is_ldc", False)):
            add("un_m49", "special_group", "LDC", "Least Developed Countries (LDC)")
        if bool(row.get("is_lldc", False)):
            add("un_m49", "special_group", "LLDC", "Landlocked Developing Countries (LLDC)")
        if bool(row.get("is_sids", False)):
            add("un_m49", "special_group", "SIDS", "Small Island Developing States (SIDS)")

        wb_region_name = row.get("wb_region_name", "")
        wb_region_code = row.get("wb_region_code", "")
        if wb_region_name and wb_region_code not in {"", "NA"}:
            add("world_bank", "region", wb_region_code, wb_region_name)

        wb_income_name = row.get("wb_income_name", "")
        wb_income_code = row.get("wb_income_code", "")
        if wb_income_name and wb_income_code not in {"", "NA"}:
            add("world_bank", "income_level", wb_income_code, wb_income_name)

        wb_lending_name = row.get("wb_lending_name", "")
        wb_lending_code = row.get("wb_lending_code", "")
        if wb_lending_name and wb_lending_code not in {"", "NA"}:
            add("world_bank", "lending_type", wb_lending_code, wb_lending_name)

        if bool(row.get("wb_fcs_status", False)):
            add("world_bank_fcs", "fcs_status", "FCS", "Fragile and Conflict-affected Situations")
            add("world_bank_fcs", "fcs_category", row.get("wb_fcs_category", ""), row.get("wb_fcs_category", ""))
            add("world_bank_fcs", "fcs_fiscal_year", row.get("wb_fcs_fy", ""), row.get("wb_fcs_fy", ""))

        if bool(row.get("oecd_dac_eligible", False)):
            add("oecd_dac", "oda_eligibility", "ODA", "ODA-eligible recipient")
            add("oecd_dac", "wb_income_hint", row.get("oecd_dac_wb_group", ""), row.get("oecd_dac_wb_group", ""))
            add("oecd_dac", "reporting_year", row.get("oecd_dac_reporting_year", ""), row.get("oecd_dac_reporting_year", ""))

    if not sdg_groups.empty:
        merged = countries[["iso3", "iso2", "m49"]].merge(sdg_groups, on="m49", how="left")
        for row in merged.to_dict(orient="records"):
            if not row.get("sdg_group_name"):
                continue
            out.append(
                {
                    "iso3": row["iso3"],
                    "iso2": row["iso2"],
                    "m49": row["m49"],
                    "source": "un_sdg",
                    "group_type": "region",
                    "group_code": normalize_code(row.get("sdg_group_code", "")),
                    "group_name": row["sdg_group_name"],
                }
            )

    if not oecd_groups.empty:
        merged = countries[["iso3", "iso2", "m49"]].merge(oecd_groups, on="iso3", how="inner")
        for row in merged.to_dict(orient="records"):
            out.append(
                {
                    "iso3": row["iso3"],
                    "iso2": row["iso2"],
                    "m49": row["m49"],
                    "source": "oecd_dac",
                    "group_type": "oda_recipient_group",
                    "group_code": normalize_code(row.get("oecd_group_id", "")),
                    "group_name": as_clean_str(row.get("oecd_group_name_en", "")),
                }
            )

    df = pd.DataFrame(out).drop_duplicates()
    df = df[df["group_name"].astype(str).str.strip() != ""]
    df = df.sort_values(["iso3", "source", "group_type", "group_name"]).reset_index(drop=True)
    return df


def to_records_csv(path: Path, df: pd.DataFrame) -> None:
    df.to_csv(path, index=False, quoting=csv.QUOTE_MINIMAL)


def read_previous_csv(path: Path) -> pd.DataFrame:
    """Read an earlier output, skipping the attribution comment line older snapshots started with."""
    return pd.read_csv(path, dtype=str, keep_default_na=False, comment=None, skiprows=_comment_rows(path)).fillna("")


def _comment_rows(path: Path) -> int:
    with path.open(encoding="utf-8") as f:
        return 1 if f.readline().startswith("#") else 0


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def create_change_report(
    current_countries: pd.DataFrame,
    current_groups: pd.DataFrame,
    previous_countries: pd.DataFrame | None,
    previous_groups: pd.DataFrame | None,
    timestamp: str,
) -> str:
    lines: list[str] = []
    lines.append(f"# Country Classification Update - {timestamp}")
    lines.append("")

    if previous_countries is None or previous_groups is None:
        lines.append("Initial snapshot: no previous baseline available.")
        lines.append("")
        lines.append(f"Countries: {len(current_countries)}")
        lines.append(f"Group memberships: {len(current_groups)}")
        return "\n".join(lines)

    prev_iso3 = set(previous_countries["iso3"].astype(str))
    curr_iso3 = set(current_countries["iso3"].astype(str))

    added_countries = sorted(curr_iso3 - prev_iso3)
    removed_countries = sorted(prev_iso3 - curr_iso3)

    lines.append("## Country-Level Changes")
    lines.append(f"- Added countries/areas: {len(added_countries)}")
    if added_countries:
        lines.append(f"- Added ISO3: {', '.join(added_countries)}")
    lines.append(f"- Removed countries/areas: {len(removed_countries)}")
    if removed_countries:
        lines.append(f"- Removed ISO3: {', '.join(removed_countries)}")

    key_cols = [
        "iso3",
        "iso2",
        "m49",
        "country_name_en",
        "wb_income_code",
        "wb_lending_code",
        "wb_region_code",
        "wb_fcs_category",
        "oecd_dac_eligible",
    ]
    for col in key_cols:
        if col not in previous_countries.columns:
            previous_countries[col] = ""
        if col not in current_countries.columns:
            current_countries[col] = ""
    prev_keyed = previous_countries[key_cols].set_index("iso3").to_dict(orient="index")
    curr_keyed = current_countries[key_cols].set_index("iso3").to_dict(orient="index")

    changed = []
    for iso3 in sorted(prev_iso3 & curr_iso3):
        if prev_keyed.get(iso3) != curr_keyed.get(iso3):
            changed.append(iso3)

    lines.append(f"- Countries with changed core metadata: {len(changed)}")
    if changed:
        lines.append(f"- Changed ISO3 (core fields): {', '.join(changed[:50])}")

    prev_groups_set = set(
        tuple(x)
        for x in previous_groups[["iso3", "source", "group_type", "group_code", "group_name"]]
        .astype(str)
        .to_records(index=False)
    )
    curr_groups_set = set(
        tuple(x)
        for x in current_groups[["iso3", "source", "group_type", "group_code", "group_name"]]
        .astype(str)
        .to_records(index=False)
    )

    added_groups = curr_groups_set - prev_groups_set
    removed_groups = prev_groups_set - curr_groups_set

    lines.append("")
    lines.append("## Group Membership Changes")
    lines.append(f"- Added memberships: {len(added_groups)}")
    lines.append(f"- Removed memberships: {len(removed_groups)}")

    if added_groups:
        sample = sorted(list(added_groups))[:20]
        lines.append("- Sample added:")
        for iso3, source, group_type, group_code, group_name in sample:
            lines.append(f"  - {iso3}: [{source}] {group_type} -> {group_name} ({group_code})")

    if removed_groups:
        sample = sorted(list(removed_groups))[:20]
        lines.append("- Sample removed:")
        for iso3, source, group_type, group_code, group_name in sample:
            lines.append(f"  - {iso3}: [{source}] {group_type} -> {group_name} ({group_code})")

    return "\n".join(lines)


def _sanitize_json(obj: Any) -> Any:
    """Replace float NaN/Inf with None so output is valid JSON (not just valid JS)."""
    import math
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: _sanitize_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_json(v) for v in obj]
    return obj


def write_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(_sanitize_json(payload), f, ensure_ascii=False, indent=2)


_AGGREGATES_LABEL_MAP = {
    "LDC":  "Least Developed Countries (LDC)",
    "LLDC": "Land Locked Developing Countries (LLDC)",
    "SIDS": "Small Island Developing States (SIDS)",
}


def write_aggregates(countries: "pd.DataFrame", memberships: "pd.DataFrame", out_path: Path) -> None:
    """Write long-format aggregates CSV (one row per country-group) matching OSAA reference format."""
    # memberships already has iso3, iso2, m49; only need country_name_en from countries
    name_map = countries.set_index("iso3")[["country_name_en"]]
    df = memberships.merge(name_map, on="iso3", how="left")
    df["country_grouping"] = df["group_name"].map(lambda x: _AGGREGATES_LABEL_MAP.get(x, x))
    agg = df[["country_name_en", "m49", "iso2", "iso3", "country_grouping"]].copy()
    agg = agg.rename(columns={"country_name_en": "Country or Area", "m49": "M49 Code"})
    agg = agg.sort_values(["Country or Area", "country_grouping"]).reset_index(drop=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    agg.to_csv(out_path, index=False, encoding="utf-8")


def write_world_reference(countries: "pd.DataFrame", out_path: Path) -> None:
    """Write wide-format one-row-per-country CSV matching UNStats/OSAA World reference style.

    Designed for dashboards (Power BI, Tableau, Python): one row per country with
    geography, codes, and classification columns. Column names aligned with
    World_reference_UNStats.csv for familiarity.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df = countries.copy()

    def bool_to_label(series: "pd.Series", label: str) -> "pd.Series":
        return series.map(lambda v: label if (v is True or str(v).strip().lower() == "true") else "")

    # Income: one column per level (value = label or empty)
    income = df["wb_income_name"].fillna("").astype(str).str.strip()
    df["High income"] = income.where(income == "High income", "")
    df["Low income"] = income.where(income == "Low income", "")
    df["Lower middle income"] = income.where(income == "Lower middle income", "")
    df["Upper middle income"] = income.where(income == "Upper middle income", "")

    # OECD member: from the OECD membership list (not ODA eligibility, which is roughly its opposite)
    df["OECD member"] = bool_to_label(df["is_oecd_member"], "OECD member")
    df["UN Member State"] = bool_to_label(df["is_un_member"], "UN Member State")

    # FCS
    fcs = df.get("wb_fcs_status", pd.Series(dtype=object))
    if fcs.isna().all():
        fcs = pd.Series(False, index=df.index)
    df["Fragile and Conflict-Affected Situations"] = bool_to_label(fcs, "Fragile and Conflict-Affected Situations")

    # LDC / LLDC / SIDS: label or empty (match UNStats style)
    df["Least Developed Countries (LDC)"] = bool_to_label(df["is_ldc"], "Least Developed Countries (LDC)")
    df["Land Locked Developing Countries (LLDC)"] = bool_to_label(df["is_lldc"], "Land Locked Developing Countries (LLDC)")
    df["Small Island Developing States (SIDS)"] = bool_to_label(df["is_sids"], "Small Island Developing States (SIDS)")

    # Column order matching World_reference_UNStats spirit; we leave Arab states, HIPC, Oil exporting, etc. empty (not in our sources)
    cols = [
        "global_code", "global_name_en",
        "region_code", "region_name_en",
        "sub_region_code", "sub_region_name_en",
        "intermediate_region_code", "intermediate_region_name_en",
        "country_name_en", "m49", "iso2", "iso3",
        "Least Developed Countries (LDC)", "Land Locked Developing Countries (LLDC)", "Small Island Developing States (SIDS)",
        "High income", "Low income", "Lower middle income", "Upper middle income",
        "OECD member", "Fragile and Conflict-Affected Situations", "UN Member State",
    ]
    rename = {
        "global_code": "Global Code",
        "global_name_en": "Global Name",
        "region_code": "Region Code",
        "region_name_en": "Region Name",
        "sub_region_code": "Sub-region Code",
        "sub_region_name_en": "Sub-region Name",
        "intermediate_region_code": "Intermediate Region Code",
        "intermediate_region_name_en": "Intermediate Region Name",
        "country_name_en": "Country or Area",
        "m49": "m49",
        "iso2": "iso2",
        "iso3": "iso3",
    }
    out = df[cols].copy()
    out = out.rename(columns=rename)
    out = out.sort_values("Country or Area").reset_index(drop=True)
    out.to_csv(out_path, index=False, encoding="utf-8")


_DROPDOWN_GROUP_SYSTEMS = [
    {"system_id": "sdg_region", "system_label": "SDG",        "source": "un_sdg",       "group_type": "region"},
    {"system_id": "wb_region",  "system_label": "World Bank", "source": "world_bank",   "group_type": "region"},
    {"system_id": "wb_income",  "system_label": "World Bank", "source": "world_bank",   "group_type": "income_level"},
    {"system_id": "un_region",  "system_label": "UN",         "source": "un_m49",       "group_type": "region"},
    {"system_id": "un_sub_region", "system_label": "UN",      "source": "un_m49",       "group_type": "sub_region"},
    {"system_id": "un_special", "system_label": "UN",         "source": "un_m49",       "group_type": "special_group"},
    {"system_id": "oecd_dac",   "system_label": "OECD DAC",   "source": "oecd_dac",     "group_type": "oda_recipient_group"},
    {"system_id": "fcs_category", "system_label": "World Bank", "source": "world_bank_fcs", "group_type": "fcs_category"},
]


def _dropdown_system_for_row(source: str, group_type: str) -> dict[str, str] | None:
    for cfg in _DROPDOWN_GROUP_SYSTEMS:
        if cfg["source"] == source and cfg["group_type"] == group_type:
            return cfg
    return None


def _describe_dropdown_group(system_id: str, system_label: str, group_name: str) -> str:
    name = as_clean_str(group_name)
    if not name:
        return ""
    lower = name.lower()

    if system_id == "sdg_region":
        if "africa" in lower:
            return f"UN SDG regional reporting group: {name}."
        return f"UN SDG geographic region: {name}."
    if system_id == "wb_region":
        if "africa" in lower:
            return f"World Bank regional grouping for Africa: {name}."
        return f"World Bank operational region: {name}."
    if system_id == "wb_income":
        return f"World Bank income classification: {name}."
    if system_id in {"un_region", "un_sub_region"}:
        kind = "region" if system_id == "un_region" else "sub-region"
        return f"UN M49 {kind}: {name}."
    if system_id == "un_special":
        return f"UN special country group: {name}."
    if system_id == "oecd_dac":
        return f"OECD DAC ODA recipient group: {name}."
    if system_id == "fcs_category":
        return f"World Bank FCS category: {name}."
    if system_id == "africa_custom":
        if name == "Africa - All":
            return "Custom composite group covering all African countries across UN M49 African regions."
        return f"Custom aggregate group: {name}."
    return f"{system_label} group: {name}."


def write_dropdown_master(
    countries: "pd.DataFrame",
    memberships: "pd.DataFrame",
    out_path: Path,
) -> "pd.DataFrame":
    """Write long, thin dropdown-ready sheet: one row per country–group pair."""
    base = memberships.copy()
    base = base.merge(
        countries[["iso3", "iso2", "m49", "country_name_en", "region_name_en"]],
        on="iso3",
        how="left",
    )

    rows: list[dict[str, str]] = []

    for row in base.to_dict(orient="records"):
        cfg = _dropdown_system_for_row(str(row.get("source", "")), str(row.get("group_type", "")))
        if not cfg:
            continue
        group_name = as_clean_str(row.get("group_name", ""))
        if not group_name:
            continue
        system_id = cfg["system_id"]
        system_label = cfg["system_label"]
        display_label = f"{system_label} - {group_name}"
        description = _describe_dropdown_group(system_id, system_label, group_name)

        rows.append(
            {
                "iso3": as_clean_str(row.get("iso3", "")),
                "iso2": as_clean_str(row.get("iso2", "")),
                "m49": normalize_code(row.get("m49", "")),
                "country_name_en": as_clean_str(row.get("country_name_en", "")),
                "group_system": system_label,
                "group_name": group_name,
                "group_display_label": display_label,
                "group_description": description,
                "source": as_clean_str(row.get("source", "")),
                "group_type": as_clean_str(row.get("group_type", "")),
            }
        )

    # Synthetic custom group: Africa - All (UN M49 Africa)
    africa = countries[countries["region_name_en"] == "Africa"][
        ["iso3", "iso2", "m49", "country_name_en"]
    ].copy()
    if not africa.empty:
        for rec in africa.to_dict(orient="records"):
            rows.append(
                {
                    "iso3": as_clean_str(rec.get("iso3", "")),
                    "iso2": as_clean_str(rec.get("iso2", "")),
                    "m49": normalize_code(rec.get("m49", "")),
                    "country_name_en": as_clean_str(rec.get("country_name_en", "")),
                    "group_system": "Africa",
                    "group_name": "Africa - All",
                    "group_display_label": "Africa - All",
                    "group_description": _describe_dropdown_group(
                        "africa_custom", "Africa", "Africa - All"
                    ),
                    "source": "custom",
                    "group_type": "aggregate",
                }
            )

    dropdown = pd.DataFrame(rows)
    if not dropdown.empty:
        dropdown = dropdown.drop_duplicates()
        dropdown = dropdown.sort_values(["country_name_en", "group_display_label"]).reset_index(
            drop=True
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    dropdown.to_csv(out_path, index=False, encoding="utf-8")
    return dropdown


def load_reference_lists() -> tuple[pd.DataFrame, set[str]]:
    """Load the UN membership and OECD member lists from reference/ and check their counts."""
    un = pd.read_csv(REFERENCE_DIR / "un_membership.csv", dtype=str, keep_default_na=False)
    n_members = int((un["un_status"] == "member_state").sum())
    n_observers = int((un["un_status"] == "observer_state").sum())
    if n_members != EXPECTED_UN_MEMBER_STATES or n_observers != EXPECTED_UN_OBSERVER_STATES:
        raise ValueError(
            f"reference/un_membership.csv has {n_members} members and {n_observers} observers; "
            f"expected {EXPECTED_UN_MEMBER_STATES} and {EXPECTED_UN_OBSERVER_STATES}."
        )
    oecd = pd.read_csv(REFERENCE_DIR / "oecd_members.csv", dtype=str, keep_default_na=False)
    if len(oecd) != EXPECTED_OECD_MEMBERS:
        raise ValueError(f"reference/oecd_members.csv has {len(oecd)} rows; expected {EXPECTED_OECD_MEMBERS}.")
    return un, set(oecd["iso3"])


def add_membership_columns(countries: pd.DataFrame, un: pd.DataFrame, oecd_iso3: set[str]) -> pd.DataFrame:
    """Add UN membership status, UN regional group and OECD membership to the country table."""
    missing = sorted(set(un["iso3"]) - set(countries["iso3"]))
    if missing:
        raise ValueError(f"UN membership list has ISO3 codes not in UN M49: {', '.join(missing)}")
    status = un.set_index("iso3")["un_status"]
    group = un.set_index("iso3")["un_regional_group"]
    out = countries.copy()
    out["un_status"] = out["iso3"].map(status).fillna("non_member")
    out["is_un_member"] = out["un_status"] == "member_state"
    out["un_regional_group"] = out["iso3"].map(group).fillna("")
    out["is_oecd_member"] = out["iso3"].isin(oecd_iso3)
    return out


def build_reference_memberships(countries: pd.DataFrame, un: pd.DataFrame) -> pd.DataFrame:
    """Membership rows for UN membership, UN regional groups and OECD membership."""
    keys = countries[["iso3", "iso2", "m49"]]
    rows: list[dict[str, str]] = []
    for rec in un.to_dict(orient="records"):
        if rec["un_status"] == "member_state":
            rows.append({"iso3": rec["iso3"], "source": "un_membership", "group_type": "membership",
                         "group_code": "MEMBER", "group_name": "UN Member States"})
            for code in [rec["un_regional_group"], rec["also_participates_in"]]:
                if code:
                    rows.append({"iso3": rec["iso3"], "source": "un_membership", "group_type": "regional_group",
                                 "group_code": code, "group_name": UN_REGIONAL_GROUP_NAMES[code]})
        else:
            rows.append({"iso3": rec["iso3"], "source": "un_membership", "group_type": "membership",
                         "group_code": "OBSERVER", "group_name": "UN non-member observer States"})
    for iso3 in countries.loc[countries["is_oecd_member"], "iso3"]:
        rows.append({"iso3": iso3, "source": "oecd", "group_type": "membership",
                     "group_code": "OECD", "group_name": "OECD Member countries"})
    return keys.merge(pd.DataFrame(rows), on="iso3", how="inner")


def group_id(source: str, group_type: str, group_code: str, group_name: str) -> str:
    """Stable identifier for a group, e.g. un_m49.region.2 or world_bank.income_level.lmc."""
    token = as_clean_str(group_code) or as_clean_str(group_name)
    token = re.sub(r"[^a-z0-9]+", "-", normalize_name(token) if not token.isdigit() else token).strip("-")
    return f"{source}.{group_type}.{token}"


# How each (source, group_type) pair is presented in groups.csv and on the website.
# Pairs not listed here stay in the long membership table but are left out of the catalogue.
GROUP_SYSTEMS = [
    ("un_membership", "membership", "UN membership", "UN Member and observer States (UN Charter membership)."),
    ("un_membership", "regional_group", "UN regional groups", "Groups of Member States used for elections and seat allocation in UN bodies."),
    ("un_m49", "region", "UN M49 regions", "UN Statistics Division standard regions. Includes territories, not only States."),
    ("un_m49", "sub_region", "UN M49 sub-regions", "UN Statistics Division standard sub-regions."),
    ("un_m49", "intermediate_region", "UN M49 intermediate regions", "Finer M49 regions used in parts of Africa and the Americas."),
    ("un_m49", "special_group", "UN development groups", "Least Developed Countries, Landlocked Developing Countries and Small Island Developing States (UN-OHRLLS)."),
    ("un_sdg", "region", "UN SDG regional groupings", "Groupings used by the UN SDG Global Database and the SDG Progress Report."),
    ("world_bank", "region", "World Bank regions", "World Bank analytical regions."),
    ("world_bank", "income_level", "World Bank income groups", "World Bank income classification by GNI per capita (Atlas method), revised each 1 July."),
    ("world_bank", "lending_type", "World Bank lending categories", "IDA, IBRD and Blend eligibility."),
    ("world_bank_fcs", "fcs_status", "World Bank FCS", "Fragile and Conflict-affected Situations, current fiscal year list."),
    ("world_bank_fcs", "fcs_category", "World Bank FCS", "Fragile and Conflict-affected Situations, by category."),
    ("oecd", "membership", "OECD membership", "Member countries of the OECD."),
    ("oecd_dac", "oda_eligibility", "OECD DAC ODA recipients", "Countries and territories eligible to receive official development assistance."),
    ("oecd_dac", "oda_recipient_group", "OECD DAC ODA recipients", "DAC List of ODA Recipients by group."),
]

SOURCE_ORGS = {
    "un_membership": "United Nations",
    "un_m49": "UN Statistics Division",
    "un_sdg": "UN Statistics Division",
    "world_bank": "World Bank",
    "world_bank_fcs": "World Bank",
    "oecd": "OECD",
    "oecd_dac": "OECD",
}


def finalize_memberships(memberships: pd.DataFrame, countries: pd.DataFrame) -> pd.DataFrame:
    """Add group_id, country name and UN membership to every membership row."""
    out = memberships.copy()
    out["group_id"] = [
        group_id(r.source, r.group_type, r.group_code, r.group_name) for r in out.itertuples(index=False)
    ]
    # Some publishers reuse a code for several groups (the SDG API gives code 1 to three "World (total)"
    # groupings). Those ids fall back to the group name so no membership is lost.
    names_per_id = out.groupby("group_id")["group_name"].nunique()
    clash = out["group_id"].isin(names_per_id[names_per_id > 1].index)
    out.loc[clash, "group_id"] = [
        group_id(r.source, r.group_type, "", r.group_name) for r in out[clash].itertuples(index=False)
    ]
    out = out.merge(countries[["iso3", "country_name_en", "is_un_member"]], on="iso3", how="left")
    out = out.rename(columns={"country_name_en": "country_name"})
    out = out.drop_duplicates(subset=["iso3", "group_id"])
    cols = ["iso3", "iso2", "m49", "source", "group_type", "group_code", "group_name", "group_id", "country_name", "is_un_member"]
    return out[cols].sort_values(["iso3", "source", "group_type", "group_name"]).reset_index(drop=True)


def build_groups_catalogue(memberships: pd.DataFrame) -> pd.DataFrame:
    """One row per group with its system, description and member counts."""
    order = {(src, gt): i for i, (src, gt, _, _) in enumerate(GROUP_SYSTEMS)}
    labels = {(src, gt): (label, desc) for src, gt, label, desc in GROUP_SYSTEMS}
    rows = []
    for (gid, src, gt, code, name), g in memberships.groupby(
        ["group_id", "source", "group_type", "group_code", "group_name"], sort=False
    ):
        if (src, gt) not in labels:
            continue
        label, desc = labels[(src, gt)]
        rows.append({
            "group_id": gid,
            "system": label,
            "group_name": name,
            "group_code": code,
            "source": src,
            "group_type": gt,
            "organization": SOURCE_ORGS.get(src, ""),
            "n_members": int(g["iso3"].nunique()),
            "n_un_members": int(g.loc[g["is_un_member"].astype(bool), "iso3"].nunique()),
            "system_description": desc,
            "_order": order[(src, gt)],
        })
    cat = pd.DataFrame(rows).sort_values(["_order", "group_name"]).drop(columns="_order")
    return cat.reset_index(drop=True)


def _sdg_region_lookup(memberships: pd.DataFrame) -> dict[str, str]:
    sdg = memberships[(memberships["source"] == "un_sdg") & memberships["group_code"].isin(SDG_REGION_CODES)]
    return dict(zip(sdg["iso3"], sdg["group_name"]))


def build_flagship(countries: pd.DataFrame, memberships: pd.DataFrame) -> pd.DataFrame:
    """The analysis-ready table: one row per country or area, plain snake_case columns, true/false flags."""
    c = countries
    sdg_region = _sdg_region_lookup(memberships)
    oda_group = (
        memberships[(memberships["source"] == "oecd_dac") & (memberships["group_type"] == "oda_recipient_group")]
        .groupby("iso3")["group_name"].first()
    )
    inter = c["intermediate_region_name_en"].fillna("").astype(str)
    sub = c["sub_region_name_en"].fillna("").astype(str)
    flag = lambda col: c[col].map(lambda v: v is True or str(v).strip().lower() == "true")  # noqa: E731
    out = pd.DataFrame({
        "iso3": c["iso3"],
        "iso2": c["iso2"],
        "m49": c["m49"].map(lambda v: str(v).zfill(3) if str(v).isdigit() else v),
        "name": c["country_name_en"],
        "un_status": c["un_status"],
        "is_un_member": c["is_un_member"],
        "un_regional_group": c["un_regional_group"],
        "region": c["region_name_en"],
        "sub_region": sub,
        "intermediate_region": inter,
        "analysis_region": inter.where(inter != "", sub),
        "sdg_region": c["iso3"].map(sdg_region).fillna(""),
        "is_ldc": flag("is_ldc"),
        "is_lldc": flag("is_lldc"),
        "is_sids": flag("is_sids"),
        "wb_region": c["wb_region_name"].fillna(""),
        "wb_income_group": c["wb_income_name"].fillna(""),
        "wb_lending_type": c["wb_lending_name"].fillna(""),
        "is_fcs": flag("wb_fcs_status"),
        "fcs_category": c["wb_fcs_category"].fillna(""),
        "is_oda_eligible": flag("oecd_dac_eligible"),
        "oda_recipient_group": c["iso3"].map(oda_group).fillna(""),
        "is_oecd_member": c["is_oecd_member"],
        "capital": c["capital_city"].fillna(""),
        "latitude": c["latitude"],
        "longitude": c["longitude"],
        "name_ar": c["country_name_ar"],
        "name_zh": c["country_name_zh"],
        "name_fr": c["country_name_fr"],
        "name_ru": c["country_name_ru"],
        "name_es": c["country_name_es"],
    })
    return out.sort_values("name").reset_index(drop=True)


def write_tidy_csv(path: Path, df: pd.DataFrame) -> None:
    """CSV with a clean header row and lowercase true/false for boolean columns."""
    out = df.copy()
    for col in out.columns:
        if out[col].dtype == bool:
            out[col] = out[col].map({True: "true", False: "false"})
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(path, index=False, encoding="utf-8", lineterminator="\n")


def site_payload(flagship: pd.DataFrame, groups: pd.DataFrame, memberships: pd.DataFrame) -> dict[str, Any]:
    """Compact JSON for the website: countries plus each catalogued group's member list."""
    members = memberships.groupby("group_id")["iso3"].apply(lambda s: sorted(set(s))).to_dict()
    group_rows = []
    for g in groups.to_dict(orient="records"):
        g = {k: v for k, v in g.items() if k in {"group_id", "system", "group_name", "group_code", "organization", "n_members", "n_un_members"}}
        g["members"] = members.get(g["group_id"], [])
        group_rows.append(g)
    countries = flagship.drop(columns=["name_ar", "name_zh", "name_ru"]).to_dict(orient="records")
    return {"countries": countries, "groups": group_rows}


def main() -> None:
    for d in [LATEST_DIR, HISTORY_DIR, CHANGELOG_DIR, DOCS_DATA_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    un_reference, oecd_iso3 = load_reference_lists()

    timestamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
    access_utc = utc_now().isoformat()

    session = requests.Session()
    session.headers.update({"User-Agent": "country-classification-commons/1.1 (+github-pages-static)"})

    m49_df = fetch_un_m49_multilingual(session)
    wb_df = fetch_world_bank(session)
    sdg_country_df, sdg_group_df = fetch_un_sdg_geoareas(session)

    countries = m49_df.merge(wb_df, on="iso3", how="left")
    countries = countries.merge(sdg_country_df, on="m49", how="left")

    countries["iso2"] = countries["iso2"].fillna(countries["iso2_wb"]).astype(str)
    countries["country_name_sdg_en"] = countries["sdg_geoarea_name_en"].fillna("")

    countries["wb_fcs_status"] = False
    countries["wb_fcs_category"] = ""
    countries["wb_fcs_fy"] = ""
    countries["oecd_dac_eligible"] = False
    countries["oecd_dac_wb_group"] = ""
    countries["oecd_dac_reporting_year"] = ""

    name_index = build_country_name_index(countries)

    unmapped_frames: list[pd.DataFrame] = []

    oecd_groups = pd.DataFrame()
    oecd_url_used = ""
    try:
        oecd_raw, oecd_url_used = fetch_oecd_dac_latest(session)
        oecd_groups, oecd_unmapped = map_external_rows_to_iso3(
            oecd_raw, "oecd_recipient_name_en", "oecd_dac", name_index
        )
        if not oecd_unmapped.empty:
            unmapped_frames.append(oecd_unmapped)

        if not oecd_groups.empty:
            oecd_summary = (
                oecd_groups.sort_values(["oecd_reporting_year", "oecd_group_id"])
                .groupby("iso3", as_index=False)
                .agg(
                    oecd_dac_eligible=("iso3", lambda x: True),
                    oecd_dac_wb_group=("oecd_wb_group", "first"),
                    oecd_dac_reporting_year=("oecd_reporting_year", "max"),
                )
            )
            countries = countries.merge(oecd_summary, on="iso3", how="left", suffixes=("", "_new"))
            for col in ["oecd_dac_eligible", "oecd_dac_wb_group", "oecd_dac_reporting_year"]:
                new_col = f"{col}_new"
                if new_col in countries.columns:
                    countries[col] = countries[new_col].where(countries[new_col].notna(), countries[col])
                    countries = countries.drop(columns=[new_col])
            countries["oecd_dac_eligible"] = countries["oecd_dac_eligible"].map(
                lambda v: v if isinstance(v, bool) else str(v).strip().lower() == "true"
            )
            countries["oecd_dac_wb_group"] = countries["oecd_dac_wb_group"].fillna("")
            countries["oecd_dac_reporting_year"] = countries["oecd_dac_reporting_year"].fillna("")

    except Exception as exc:
        print(f"WARN: OECD DAC integration skipped: {exc}")

    wb_fcs_url_used = ""
    wb_fcs_fy_used = ""
    try:
        fcs_raw, wb_fcs_url_used, wb_fcs_fy_used = fetch_world_bank_fcs_latest(session)
        fcs_mapped, fcs_unmapped = map_external_rows_to_iso3(
            fcs_raw, "fcs_country_name", "world_bank_fcs", name_index
        )
        if not fcs_unmapped.empty:
            unmapped_frames.append(fcs_unmapped)

        if not fcs_mapped.empty:
            fcs_summary = (
                fcs_mapped.groupby("iso3", as_index=False)
                .agg(
                    wb_fcs_category=("wb_fcs_category", "first"),
                    wb_fcs_fy=("wb_fcs_fy", "first"),
                )
                .copy()
            )
            fcs_summary["wb_fcs_status"] = True
            countries = countries.merge(fcs_summary, on="iso3", how="left", suffixes=("", "_new"))
            for col in ["wb_fcs_status", "wb_fcs_category", "wb_fcs_fy"]:
                new_col = f"{col}_new"
                if new_col in countries.columns:
                    countries[col] = countries[new_col].where(countries[new_col].notna(), countries[col])
                    countries = countries.drop(columns=[new_col])
            countries["wb_fcs_status"] = countries["wb_fcs_status"].map(
                lambda v: v if isinstance(v, bool) else str(v).strip().lower() == "true"
            )
            countries["wb_fcs_category"] = countries["wb_fcs_category"].fillna("")
            countries["wb_fcs_fy"] = countries["wb_fcs_fy"].fillna("")

    except Exception as exc:
        print(f"WARN: WB FCS integration skipped: {exc}")

    countries = countries[
        [
            "iso3",
            "iso2",
            "m49",
            "country_name_en",
            "country_name_ar",
            "country_name_zh",
            "country_name_fr",
            "country_name_ru",
            "country_name_es",
            "country_name_sdg_en",
            "global_code",
            "global_name_en",
            "region_code",
            "region_name_en",
            "sub_region_code",
            "sub_region_name_en",
            "intermediate_region_code",
            "intermediate_region_name_en",
            "is_ldc",
            "is_lldc",
            "is_sids",
            "wb_country_name",
            "wb_region_code",
            "wb_region_name",
            "wb_income_code",
            "wb_income_name",
            "wb_lending_code",
            "wb_lending_name",
            "capital_city",
            "longitude",
            "latitude",
            "wb_fcs_status",
            "wb_fcs_category",
            "wb_fcs_fy",
            "oecd_dac_eligible",
            "oecd_dac_wb_group",
            "oecd_dac_reporting_year",
        ]
    ].copy()

    countries = add_membership_columns(countries, un_reference, oecd_iso3)
    countries = countries.sort_values(["country_name_en", "iso3"]).reset_index(drop=True)
    memberships = pd.concat(
        [
            build_group_memberships(countries, sdg_group_df, oecd_groups),
            build_reference_memberships(countries, un_reference),
        ],
        ignore_index=True,
    )
    memberships = finalize_memberships(memberships, countries)
    flagship = build_flagship(countries, memberships)
    groups = build_groups_catalogue(memberships)
    library = memberships.merge(
        countries[
            [
                "iso3",
                "iso2",
                "m49",
                "country_name_en",
                "country_name_ar",
                "country_name_zh",
                "country_name_fr",
                "country_name_ru",
                "country_name_es",
                "global_name_en",
                "region_name_en",
                "sub_region_name_en",
                "intermediate_region_name_en",
                "wb_region_name",
                "wb_income_name",
                "wb_lending_name",
                "wb_fcs_status",
                "wb_fcs_category",
                "oecd_dac_eligible",
            ]
        ],
        on=["iso3", "iso2", "m49"],
        how="left",
    )
    library = library[
        [
            "iso3",
            "iso2",
            "m49",
            "country_name_en",
            "country_name_ar",
            "country_name_zh",
            "country_name_fr",
            "country_name_ru",
            "country_name_es",
            "global_name_en",
            "region_name_en",
            "sub_region_name_en",
            "intermediate_region_name_en",
            "wb_region_name",
            "wb_income_name",
            "wb_lending_name",
            "wb_fcs_status",
            "wb_fcs_category",
            "oecd_dac_eligible",
            "source",
            "group_type",
            "group_code",
            "group_name",
        ]
    ].copy()
    library = library.sort_values(["iso3", "source", "group_type", "group_name"]).reset_index(drop=True)

    if unmapped_frames:
        unmapped = pd.concat(unmapped_frames, ignore_index=True).drop_duplicates()
    else:
        unmapped = pd.DataFrame(columns=["external_name", "source"])

    sources_rows = [
        SourceRecord(
            source_id="un_m49_overview",
            title="UN M49 Standard country or area codes for statistical use (multilingual overview)",
            url=UN_M49_OVERVIEW_URL,
            organization="United Nations Statistics Division (UNSD)",
            license_note="UN website terms",
            access_utc=access_utc,
            notes="Primary source for M49, ISO2/ISO3 mappings, UN geoscheme, LDC/LLDC/SIDS flags, and UN-language names.",
        ).__dict__,
        SourceRecord(
            source_id="un_sdg_geoarea_list",
            title="UN SDG API GeoArea List",
            url=UN_SDG_GEOAREA_LIST_URL,
            organization="United Nations SDG Global Database",
            license_note="UN SDG API terms",
            access_utc=access_utc,
            notes="GeoArea code-name mapping used in SDG API.",
        ).__dict__,
        SourceRecord(
            source_id="un_sdg_geoarea_tree",
            title="UN SDG API GeoArea Tree",
            url=UN_SDG_GEOAREA_TREE_URL,
            organization="United Nations SDG Global Database",
            license_note="UN SDG API terms",
            access_utc=access_utc,
            notes="Hierarchy for SDG regional groupings.",
        ).__dict__,
        SourceRecord(
            source_id="world_bank_country_api",
            title="World Bank API v2 - Country metadata",
            url=f"{WORLD_BANK_COUNTRY_API}?format=json&per_page=1000",
            organization="World Bank Open Data",
            license_note="World Bank data terms",
            access_utc=access_utc,
            notes="Income level, lending type, region, capital city and coordinates.",
        ).__dict__,
        SourceRecord(
            source_id="world_bank_fcs",
            title="World Bank Classification of Fragile and Conflict-affected Situations",
            url=wb_fcs_url_used or WORLD_BANK_FCS_PAGE_URL,
            organization="World Bank",
            license_note="World Bank website terms",
            access_utc=access_utc,
            notes=f"Parsed latest FY list from official page (selected: {wb_fcs_fy_used or 'n/a'}).",
        ).__dict__,
        SourceRecord(
            source_id="oecd_dac_oda_recipients",
            title="OECD DAC List of ODA Recipients (CSV)",
            url=oecd_url_used or OECD_DAC_DIRECTORY_URL,
            organization="OECD",
            license_note="OECD terms",
            access_utc=access_utc,
            notes="Latest CSV auto-selected from official OECD webfs directory.",
        ).__dict__,
    ]
    sources_rows += [
        SourceRecord(
            source_id="un_membership",
            title="UN Member States and regional groups of Member States",
            url="https://www.un.org/dgacm/en/content/regional-groups",
            organization="United Nations (DGACM)",
            license_note="UN website terms",
            access_utc=access_utc,
            notes="Curated list in reference/un_membership.csv: 193 Member States, 2 observer States, regional groups.",
        ).__dict__,
        SourceRecord(
            source_id="oecd_members",
            title="OECD Member countries",
            url="https://www.oecd.org/en/about/members-partners.html",
            organization="OECD",
            license_note="OECD terms",
            access_utc=access_utc,
            notes="Curated list in reference/oecd_members.csv: 38 Member countries.",
        ).__dict__,
    ]
    sources = pd.DataFrame(sources_rows)

    prev_countries = None
    prev_groups = None
    prev_country_path = LATEST_DIR / "countries_master.csv"
    prev_group_path = LATEST_DIR / "country_group_membership.csv"
    if prev_country_path.exists() and prev_group_path.exists():
        prev_countries = read_previous_csv(prev_country_path)
        prev_groups = read_previous_csv(prev_group_path)

    current_country_path = LATEST_DIR / "countries_master.csv"
    current_group_path = LATEST_DIR / "country_group_membership.csv"
    current_library_path = LATEST_DIR / "country_classification_library.csv"
    current_sources_path = LATEST_DIR / "sources.csv"
    current_unmapped_path = LATEST_DIR / "unmapped_external_names.csv"
    current_dropdown_path = LATEST_DIR / "country_group_dropdown_master.csv"
    current_flagship_path = LATEST_DIR / "countries.csv"
    current_groups_path = LATEST_DIR / "groups.csv"

    to_records_csv(current_country_path, countries)
    write_tidy_csv(current_group_path, memberships)
    to_records_csv(current_library_path, library)
    to_records_csv(current_sources_path, sources)
    to_records_csv(current_unmapped_path, unmapped)
    write_tidy_csv(current_flagship_path, flagship)
    write_tidy_csv(current_groups_path, groups)
    dropdown_master = write_dropdown_master(countries, memberships, current_dropdown_path)
    current_aggregates_path = LATEST_DIR / "aggregates.csv"
    current_world_reference_path = LATEST_DIR / "world_reference.csv"
    write_aggregates(countries, memberships, current_aggregates_path)
    write_world_reference(countries, current_world_reference_path)

    change_report = create_change_report(
        current_countries=countries.fillna("").astype(str),
        current_groups=memberships.fillna("").astype(str),
        previous_countries=prev_countries,
        previous_groups=prev_groups,
        timestamp=timestamp,
    )
    change_report_path = CHANGELOG_DIR / f"changes_{timestamp}.md"
    change_report_path.write_text(change_report, encoding="utf-8")

    run_manifest = {
        "generated_at_utc": access_utc,
        "snapshot_id": timestamp,
        "record_counts": {
            "countries": int(len(flagship)),
            "un_member_states": int(flagship["is_un_member"].sum()),
            "groups": int(len(groups)),
            "countries_master": int(len(countries)),
            "country_group_membership": int(len(memberships)),
            "country_classification_library": int(len(library)),
            "country_group_dropdown_master": int(len(dropdown_master)),
            "aggregates": int(len(memberships)),
            "world_reference": int(len(countries)),
            "sources": int(len(sources)),
            "unmapped_external_names": int(len(unmapped)),
        },
        "files": {
            "countries.csv": {"sha256": sha256_file(current_flagship_path)},
            "groups.csv": {"sha256": sha256_file(current_groups_path)},
            "countries_master.csv": {"sha256": sha256_file(current_country_path)},
            "country_group_membership.csv": {"sha256": sha256_file(current_group_path)},
            "country_classification_library.csv": {"sha256": sha256_file(current_library_path)},
            "country_group_dropdown_master.csv": {"sha256": sha256_file(current_dropdown_path)},
            "aggregates.csv": {"sha256": sha256_file(current_aggregates_path)},
            "world_reference.csv": {"sha256": sha256_file(current_world_reference_path)},
            "sources.csv": {"sha256": sha256_file(current_sources_path)},
            "unmapped_external_names.csv": {"sha256": sha256_file(current_unmapped_path)},
        },
        "changelog_file": str(change_report_path.relative_to(ROOT)),
    }
    write_json(LATEST_DIR / "run_manifest.json", run_manifest)

    snapshot_dir = HISTORY_DIR / timestamp
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    for f in [
        current_flagship_path,
        current_groups_path,
        current_country_path,
        current_group_path,
        current_library_path,
        current_sources_path,
        current_unmapped_path,
        current_dropdown_path,
        current_aggregates_path,
        current_world_reference_path,
        LATEST_DIR / "run_manifest.json",
        change_report_path,
    ]:
        shutil.copy2(f, snapshot_dir / f.name)

    shutil.copy2(current_flagship_path, DOCS_DATA_DIR / "countries.csv")
    shutil.copy2(current_groups_path, DOCS_DATA_DIR / "groups.csv")
    shutil.copy2(current_country_path, DOCS_DATA_DIR / "countries_master.csv")
    shutil.copy2(current_group_path, DOCS_DATA_DIR / "country_group_membership.csv")
    shutil.copy2(current_library_path, DOCS_DATA_DIR / "country_classification_library.csv")
    shutil.copy2(current_sources_path, DOCS_DATA_DIR / "sources.csv")
    shutil.copy2(current_unmapped_path, DOCS_DATA_DIR / "unmapped_external_names.csv")
    shutil.copy2(current_dropdown_path, DOCS_DATA_DIR / "country_group_dropdown_master.csv")
    shutil.copy2(current_aggregates_path, DOCS_DATA_DIR / "aggregates.csv")
    shutil.copy2(current_world_reference_path, DOCS_DATA_DIR / "world_reference.csv")
    shutil.copy2(LATEST_DIR / "run_manifest.json", DOCS_DATA_DIR / "run_manifest.json")

    write_json(DOCS_DATA_DIR / "countries_master.json", countries.to_dict(orient="records"))
    write_json(DOCS_DATA_DIR / "country_group_membership.json", memberships.to_dict(orient="records"))
    write_json(DOCS_DATA_DIR / "country_classification_library.json", library.to_dict(orient="records"))
    write_json(DOCS_DATA_DIR / "sources.json", sources.to_dict(orient="records"))
    write_json(DOCS_DATA_DIR / "unmapped_external_names.json", unmapped.to_dict(orient="records"))

    write_json(DOCS_DATA_DIR / "countries.json", flagship.to_dict(orient="records"))
    with (DOCS_DATA_DIR / "site.json").open("w", encoding="utf-8") as f:
        json.dump(_sanitize_json(site_payload(flagship, groups, memberships)), f, ensure_ascii=False, separators=(",", ":"))

    print(f"Built dataset snapshot: {timestamp}")
    print(f"Countries: {len(countries)} ({int(flagship['is_un_member'].sum())} UN Member States)")
    print(f"Groups catalogued: {len(groups)}")
    print(f"Group memberships: {len(memberships)}")
    print(f"Library rows: {len(library)}")
    print(f"Unmapped external names: {len(unmapped)}")
    print(f"Changelog: {change_report_path}")


if __name__ == "__main__":
    main()

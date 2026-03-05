#!/usr/bin/env python3
"""Build country classification datasets from authoritative sources.

Outputs:
- data/latest/countries_master.csv
- data/latest/country_group_membership.csv
- data/latest/country_classification_library.csv
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

    candidates: list[tuple[int, str]] = []
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if "FCSListFY" not in href or not href.lower().endswith(".pdf"):
            continue
        m = re.search(r"FCSListFY(\d{2})\.pdf", href, re.IGNORECASE)
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
    mapped["iso3"] = mapped[name_col].astype(str).map(lambda x: resolve_iso3_from_name(x, name_index))

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


def main() -> None:
    for d in [LATEST_DIR, HISTORY_DIR, CHANGELOG_DIR, DOCS_DATA_DIR]:
        d.mkdir(parents=True, exist_ok=True)

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

    countries = countries.sort_values(["country_name_en", "iso3"]).reset_index(drop=True)
    memberships = build_group_memberships(countries, sdg_group_df, oecd_groups)
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
    sources = pd.DataFrame(sources_rows)

    prev_countries = None
    prev_groups = None
    prev_country_path = LATEST_DIR / "countries_master.csv"
    prev_group_path = LATEST_DIR / "country_group_membership.csv"
    if prev_country_path.exists() and prev_group_path.exists():
        prev_countries = pd.read_csv(prev_country_path, dtype=str, keep_default_na=False).fillna("")
        prev_groups = pd.read_csv(prev_group_path, dtype=str, keep_default_na=False).fillna("")

    current_country_path = LATEST_DIR / "countries_master.csv"
    current_group_path = LATEST_DIR / "country_group_membership.csv"
    current_library_path = LATEST_DIR / "country_classification_library.csv"
    current_sources_path = LATEST_DIR / "sources.csv"
    current_unmapped_path = LATEST_DIR / "unmapped_external_names.csv"

    to_records_csv(current_country_path, countries)
    to_records_csv(current_group_path, memberships)
    to_records_csv(current_library_path, library)
    to_records_csv(current_sources_path, sources)
    to_records_csv(current_unmapped_path, unmapped)

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
            "countries_master": int(len(countries)),
            "country_group_membership": int(len(memberships)),
            "country_classification_library": int(len(library)),
            "sources": int(len(sources)),
            "unmapped_external_names": int(len(unmapped)),
        },
        "files": {
            "countries_master.csv": {"sha256": sha256_file(current_country_path)},
            "country_group_membership.csv": {"sha256": sha256_file(current_group_path)},
            "country_classification_library.csv": {"sha256": sha256_file(current_library_path)},
            "sources.csv": {"sha256": sha256_file(current_sources_path)},
            "unmapped_external_names.csv": {"sha256": sha256_file(current_unmapped_path)},
        },
        "changelog_file": str(change_report_path.relative_to(ROOT)),
    }
    write_json(LATEST_DIR / "run_manifest.json", run_manifest)

    snapshot_dir = HISTORY_DIR / timestamp
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    for f in [
        current_country_path,
        current_group_path,
        current_library_path,
        current_sources_path,
        current_unmapped_path,
        LATEST_DIR / "run_manifest.json",
        change_report_path,
    ]:
        shutil.copy2(f, snapshot_dir / f.name)

    shutil.copy2(current_country_path, DOCS_DATA_DIR / "countries_master.csv")
    shutil.copy2(current_group_path, DOCS_DATA_DIR / "country_group_membership.csv")
    shutil.copy2(current_library_path, DOCS_DATA_DIR / "country_classification_library.csv")
    shutil.copy2(current_sources_path, DOCS_DATA_DIR / "sources.csv")
    shutil.copy2(current_unmapped_path, DOCS_DATA_DIR / "unmapped_external_names.csv")
    shutil.copy2(LATEST_DIR / "run_manifest.json", DOCS_DATA_DIR / "run_manifest.json")

    write_json(DOCS_DATA_DIR / "countries_master.json", countries.to_dict(orient="records"))
    write_json(DOCS_DATA_DIR / "country_group_membership.json", memberships.to_dict(orient="records"))
    write_json(DOCS_DATA_DIR / "country_classification_library.json", library.to_dict(orient="records"))
    write_json(DOCS_DATA_DIR / "sources.json", sources.to_dict(orient="records"))
    write_json(DOCS_DATA_DIR / "unmapped_external_names.json", unmapped.to_dict(orient="records"))

    write_aggregates(countries, memberships, DOCS_DATA_DIR / "aggregates.csv")
    write_aggregates(countries, memberships, LATEST_DIR / "aggregates.csv")

    print(f"Built dataset snapshot: {timestamp}")
    print(f"Countries: {len(countries)}")
    print(f"Group memberships: {len(memberships)}")
    print(f"Library rows: {len(library)}")
    print(f"Unmapped external names: {len(unmapped)}")
    print(f"Changelog: {change_report_path}")


if __name__ == "__main__":
    main()

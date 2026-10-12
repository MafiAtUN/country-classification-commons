#!/usr/bin/env python3
"""Stamp the shared head, header and footer into every page in docs/.

Each page marks the regions to fill:

    <!-- shell:head -->      ... <!-- /shell:head -->
    <!-- shell:header -->    ... <!-- /shell:header -->
    <!-- shell:footer -->    ... <!-- /shell:footer -->

Run after editing the templates below: python scripts/build_shell.py
The output is plain static HTML, so pages work without a build step on GitHub Pages.
"""

from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(__file__).resolve().parents[1] / "docs"
VERSION = "20261012"

NAV = [
    ("explorer.html", "Explorer"),
    ("guides.html", "Use it"),
    ("data.html", "Data"),
    ("about.html", "Method"),
    ("examples.html", "Labs"),
]

LAB_PAGES = {"examples.html", "map.html", "sdg-lab.html", "ai-readiness.html", "ease-business.html"}
# Lab dashboards keep their own stylesheet and render light only.
LEGACY_STYLED = {"map.html", "sdg-lab.html", "ai-readiness.html", "ease-business.html"}

NERD_LAB_WORDMARK = """<svg class="nl-word" viewBox="32 30 638 116" role="img" aria-label="Nerd Lab"><g fill="none" stroke="currentColor" stroke-width="24"><path transform="translate(38,38)" d="M12 100 L12 0 L64 100 L64 0"/><g transform="translate(128,38)" fill="currentColor" stroke="none"><rect x="6" y="0" width="56" height="24"/><rect x="20" y="38" width="56" height="24"/><rect x="6" y="76" width="56" height="24"/></g><path transform="translate(210,38)" d="M12 100 L12 0 M12 12 H40 Q64 12 64 33 Q64 54 40 54 H12 M40 54 L66 100"/><path transform="translate(302,38)" d="M12 100 L12 0 M12 12 H38 Q66 12 66 50 Q66 88 38 88 H12"/><path transform="translate(422,38)" d="M12 0 L12 88 L56 88"/><path transform="translate(496,38)" d="M6 100 L38 0 L70 100 M22 64 H54"/><path transform="translate(586,38)" d="M12 100 L12 0 M12 12 H36 Q58 12 58 30 Q58 48 36 48 H12 M12 48 H38 Q64 48 64 68 Q64 88 38 88 H12"/></g></svg>"""

BRAND_MARK = """<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#141419"/><circle cx="16" cy="16" r="9.5" fill="none" stroke="#C8F531" stroke-width="2"/><ellipse cx="16" cy="16" rx="4.2" ry="9.5" fill="none" stroke="#C8F531" stroke-width="2"/><path d="M6.5 16h19" stroke="#C8F531" stroke-width="2"/></svg>"""

ICON = {
    "search": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    "moon": '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
    "sun": '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    "github": '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.41-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>',
    "menu": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
}

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@400;500&amp;family=Jost:wght@500;600;700&amp;display=swap" rel="stylesheet">'
)

THEME_INIT = (
    "<script>(function(){try{var t=localStorage.getItem('cc-theme');"
    "if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>"
)


def head(page: str) -> str:
    parts = [
        '<meta name="theme-color" content="#141419">',
        '<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">',
        FONTS,
    ]
    if page in LEGACY_STYLED:
        parts.append("<script>document.documentElement.setAttribute('data-theme','light');</script>")
        parts.append(f'<link rel="stylesheet" href="assets/css/shell.css?v={VERSION}">')
    else:
        parts.append(THEME_INIT)
        parts.append(f'<link rel="stylesheet" href="assets/css/shell.css?v={VERSION}">')
        parts.append(f'<link rel="stylesheet" href="assets/css/cc.css?v={VERSION}">')
    parts.append(f'<script src="assets/js/core.js?v={VERSION}" defer></script>')
    return "\n".join(parts)


def header(page: str) -> str:
    current = "examples.html" if page in LAB_PAGES else page
    current_attr = ' aria-current="page"'
    links = "\n".join(
        f'      <a href="{href}"{current_attr if href == current else ""}>{label}</a>' for href, label in NAV
    )
    theme_btn = (
        ""
        if page in LEGACY_STYLED
        else f'      <button class="icon-btn theme-toggle" type="button" aria-label="Switch light or dark theme">{ICON["moon"]}{ICON["sun"]}</button>\n'
    )
    return f"""<a class="skip-link" href="#main">Skip to content</a>
<div class="nl-bar">
  <div class="wrap">
    <a class="nl-presents" href="https://nerd-factory.github.io/nerd-lab/" aria-label="Nerd Lab presents">
      <img class="nl-mark" src="assets/img/mark-e.svg" alt="" width="16" height="16">
      {NERD_LAB_WORDMARK}
      <span class="nl-verb">presents</span>
    </a>
    <span class="nl-bar-note">An open experiment. <b>Unnecessarily clever.</b> Occasionally useful.</span>
  </div>
</div>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="index.html">
      {BRAND_MARK}
      <span class="brand-name">Country Classification Commons<small>Every official country grouping</small></span>
    </a>
    <nav class="site-nav" id="site-nav" aria-label="Main">
{links}
    </nav>
    <div class="header-actions">
      <button class="search-trigger" type="button" aria-label="Search countries and groups">{ICON["search"]}<span class="st-label">Search countries, groups</span><span class="kbd">⌘K</span></button>
{theme_btn}      <a class="icon-btn" href="https://github.com/MafiAtUN/country-classification-commons" aria-label="Source on GitHub">{ICON["github"]}</a>
      <button class="icon-btn menu-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav">{ICON["menu"]}</button>
    </div>
  </div>
</header>"""


FOOTER = f"""<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-about">
        <a class="footer-nl" href="https://nerd-factory.github.io/nerd-lab/">
          <img src="assets/img/mark-e.svg" alt="" width="18" height="18">
          {NERD_LAB_WORDMARK}
          <span>experiment</span>
        </a>
        <p>Country Classification Commons rebuilds the official country groupings of the UN, World Bank and OECD
        into one open, auto-refreshing table. Built in public by <a href="https://github.com/MafiAtUN">Mafizul Islam</a>
        for <a href="https://github.com/nerd-factory">Nerd Lab</a>.</p>
      </div>
      <div>
        <h2>Use</h2>
        <ul>
          <li><a href="explorer.html">Explorer</a></li>
          <li><a href="guides.html">Power BI, Tableau, Qlik</a></li>
          <li><a href="guides.html#python">Python, R, Julia, JS</a></li>
          <li><a href="data.html">Files and columns</a></li>
        </ul>
      </div>
      <div>
        <h2>Learn</h2>
        <ul>
          <li><a href="about.html#un-membership">Why Africa has 54, or 60</a></li>
          <li><a href="about.html#sources">Sources</a></li>
          <li><a href="about.html#cite">How to cite</a></li>
          <li><a href="examples.html">Labs</a></li>
        </ul>
      </div>
      <div>
        <h2>Project</h2>
        <ul>
          <li><a href="https://github.com/MafiAtUN/country-classification-commons">Source code</a></li>
          <li><a href="https://github.com/MafiAtUN/country-classification-commons/issues">Report a problem</a></li>
          <li><a href="https://github.com/MafiAtUN/country-classification-commons/tree/main/data/changelog">Changelog</a></li>
          <li><a href="https://nerd-factory.github.io/nerd-lab/">Nerd Lab</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-base">
      <p>Code MIT. Data from the UN, World Bank and OECD under their terms. Last refreshed <span data-fresh>recently</span>.</p>
      <p>The designations used do not imply any opinion on the legal status of any country, territory or area.</p>
    </div>
  </div>
</footer>"""


def fill(text: str, name: str, content: str) -> str:
    pattern = re.compile(rf"(<!-- shell:{name} -->)(.*?)(<!-- /shell:{name} -->)", re.S)
    if not pattern.search(text):
        return text
    return pattern.sub(lambda m: f"{m.group(1)}\n{content}\n{m.group(3)}", text)


def main() -> None:
    for path in sorted(DOCS.glob("*.html")):
        text = path.read_text(encoding="utf-8")
        new = fill(text, "head", head(path.name))
        new = fill(new, "header", header(path.name))
        new = fill(new, "footer", FOOTER)
        if new != text:
            path.write_text(new, encoding="utf-8")
            print(f"stamped {path.name}")


if __name__ == "__main__":
    main()

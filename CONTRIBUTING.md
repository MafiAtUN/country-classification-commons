# Contributing to Country Classification Commons

Thank you for your interest in contributing. This project automates country classification data from authoritative international sources and publishes it as open, reusable datasets.

## Ways to Contribute

### Report a Bug
Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml) issue template. Include:
- What you expected vs. what you saw
- Steps to reproduce
- Any relevant data (country code, group name, snapshot ID from `run_manifest.json`)

### Propose a New Data Source
Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml) template. A good source proposal includes:
- Name and URL of the official source
- What classification or group it adds (not already covered)
- Evidence that the source offers a stable, machine-readable endpoint (JSON, CSV, or a consistent PDF)
- License or usage terms

Priority is given to sources that are authoritative, freely accessible, and updated on a regular schedule.

### Improve Documentation
Corrections, clarifications, and additions to any `.md` file or the `docs/` site are welcome. For small fixes, open a PR directly. For larger structural changes, open an issue first.

### Submit Code Changes
Code contributions must go through a pull request. Please follow the process below.

---

## Development Setup

```bash
git clone https://github.com/MafiAtUN/country-classification-commons.git
cd country-classification-commons
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Run the pipeline locally:

```bash
python scripts/update_data.py
```

Outputs are written to `data/latest/`, `data/changelog/`, and `docs/data/`. Review them before committing.

**System requirement:** `poppler-utils` must be installed for PDF extraction (World Bank FCS list).

```bash
# Ubuntu/Debian
sudo apt-get install poppler-utils

# macOS
brew install poppler
```

---

## Commit Message Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

| Prefix | Use for |
|--------|---------|
| `feat` | New feature or data source |
| `fix` | Bug fix |
| `chore` | Maintenance (dep updates, CI changes) |
| `docs` | Documentation only |
| `refactor` | Code restructuring without behaviour change |

Examples:

```
feat(pipeline): add IMF WEO country group source
fix(fcs): handle missing fiscal-year label in PDF header
docs: clarify ISO3 join recommendation in USAGE_GUIDE
chore(deps): update pypdf to 5.x
```

---

## Pull Request Process

1. Fork the repository and create a branch from `main`.
2. Make your changes. Keep commits focused and atomic.
3. Verify the pipeline still runs cleanly end-to-end.
4. Update documentation (`DATA_DICTIONARY.md`, `SOURCE_METHODOLOGY.md`, etc.) if your change affects schema or sources.
5. Open a PR against `main` using the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
6. A maintainer will review within a reasonable timeframe. Feedback may be requested before merging.

---

## Data Integrity Standards

- **No hard-coded country lists.** All country sets must be derived from upstream sources.
- **Preserve ISO3 as the primary join key.** Do not introduce alternative join paths without discussion.
- **External names that cannot be mapped to ISO3 must be reported** in `unmapped_external_names.csv`, not silently dropped.
- **JSON outputs must not contain bare `NaN` or `Infinity`** values — use `null` instead.

---

## Code Style

- Python 3.11+
- Follow [PEP 8](https://peps.python.org/pep-0008/). Aim for clear, readable code over brevity.
- Use `pathlib.Path` for file paths, not string concatenation.
- Prefer explicit error messages over silent failures.

---

## Questions

Open a [GitHub Discussion](https://github.com/MafiAtUN/country-classification-commons/discussions) for questions that are not bugs or feature requests.

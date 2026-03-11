# Security Policy

## Supported Versions

This project produces data outputs, not versioned software releases. The `main` branch is always the supported state.

| Branch | Supported |
|--------|-----------|
| `main` | Yes |
| older commits | No |

## Reporting a Vulnerability

If you discover a security issue in this project — such as a script that could execute arbitrary code when processing upstream source data, an exposed credential, or a supply-chain concern with a dependency — please **do not open a public issue**.

Report it privately by emailing the maintainer:

**Mafizul Islam** — open a [private security advisory](https://github.com/MafiAtUN/country-classification-commons/security/advisories/new) on GitHub.

### What to include

- A description of the issue and its potential impact
- Steps to reproduce or a proof of concept
- Any suggested remediation if known

### Response timeline

- **Acknowledgement:** within 5 business days
- **Assessment and triage:** within 10 business days
- **Resolution or workaround:** as soon as reasonably possible, dependent on severity

## Scope

This project:
- Fetches data from public international APIs (UN, World Bank, OECD)
- Parses publicly available PDFs
- Runs as a scheduled GitHub Actions workflow with `contents: write` permission scoped to this repository only

No user credentials, personal data, or private endpoints are involved.

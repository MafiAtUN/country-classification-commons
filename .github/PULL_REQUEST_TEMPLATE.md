## Summary

<!-- Describe what this PR changes and why. Reference any related issues. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New data source
- [ ] Schema change (adds or removes fields)
- [ ] Pipeline improvement
- [ ] Docs / documentation only
- [ ] Chore (deps, CI, tooling)

## Checklist

- [ ] Pipeline runs end-to-end without errors (`python scripts/update_data.py`)
- [ ] Output files in `data/latest/` look correct (spot-checked key countries and groups)
- [ ] No bare `NaN` or `Infinity` values in any JSON output
- [ ] `DATA_DICTIONARY.md` updated if fields were added or removed
- [ ] `SOURCE_METHODOLOGY.md` updated if a source was added or changed
- [ ] `CHANGELOG.md` entry added under `[Unreleased]`
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)

## Notes for reviewer

<!-- Anything the reviewer should pay special attention to. -->

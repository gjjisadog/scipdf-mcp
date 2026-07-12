# Test Report — scipdf-mcp v0.3.0

**Date:** 2026-07-12  
**Commit:** `50fc18b` (+ this report)  
**Environment:** macOS, Node.js local, network enabled

## Unit tests

```text
npm run build  → OK
npm test       → 17/17 passed
  - tests/doi.test.ts (7)
  - tests/citations.test.ts (4)
  - tests/scihub.parse.test.ts (4)
  - tests/unpaywall.test.ts (2)
```

## CLI integration

| Step | Result |
|------|--------|
| `version` | `0.3.0` |
| `resolve` title → DOI | `10.1038/nature12373` ✓ |
| `download --force` (default) | `source: scihub`, 943776 bytes ✓ |
| `download` again | `source: cache`, `cached: true` ✓ |
| OA opt-in (`EMAIL` + `PREFER_OA=true`) | `source: unpaywall` for PLOS paper ✓ |
| `unpaywall <doi>` (email only) | lookup OA metadata ✓ |
| `parse` bibtex | extracts DOI ✓ |
| `batch` | succeeded ✓ |
| `list` | 2 PDFs under `~/Documents/Papers` ✓ |

## Behavior checks

| Case | Expected | Actual |
|------|----------|--------|
| No Unpaywall config | Sci-Hub only | `source: scihub` ✓ |
| Email + `PREFER_OA=true` | OA first | `source: unpaywall` ✓ |
| Unpaywall not mandatory | default works without email | ✓ |

## Notes

- `.github/workflows/ci.yml` kept local only (OAuth lacks `workflow` scope to push Actions).
- To enable OA: `SCIPDF_UNPAYWALL_EMAIL` + `SCIPDF_PREFER_OA=true` (real email required).

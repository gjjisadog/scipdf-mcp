# Test Report — scipdf-mcp v0.2.0

**Date:** 2026-07-12  
**Environment:** macOS, Node.js (local), network enabled

## Unit tests

```text
npm run build  → OK
npm test       → 15/15 passed
  - tests/doi.test.ts (7)
  - tests/citations.test.ts (4)
  - tests/scihub.parse.test.ts (4)
```

## CLI integration

| Command | Result |
|---------|--------|
| `node dist/index.js version` | `0.2.0` |
| `resolve "Nanometre-scale thermometry in a living cell"` | `ok: true`, DOI `10.1038/nature12373` |
| `download --force 10.1038/nature12373` | `ok: true`, 943776 bytes, mirror `sci.bban.top` |
| `download 10.1038/nature12373` (2nd) | `cached: true` |
| `list` | 1 file under `~/Documents/Papers` |
| `parse -` (bibtex with doi) | extracts `10.1038/nature12373` |
| `batch 10.1038/nature12373` | succeeded=1, index=0 |
| `check-mirrors` | ren/red/ee OK; st/ru/box/se blocked or timeout (expected) |

## Artifacts

- PDF: `~/Documents/Papers/10.1038_nature12373.pdf` (PDF 1.5, ~922 KB)
- Citations returned (APA / GB/T / BibTeX)

## Notes

- HTML Sci-Hub mirrors may return 403/CF; direct PDF host path remains the reliable path.
- GitHub Actions workflow file lives at `.github/workflows/ci.yml` (requires `workflow` OAuth scope to push).

# Changelog

Notable changes to NoxaPlus PDF Desk are recorded here. Version numbers follow Semantic Versioning. Dates use `YYYY-MM-DD`.

## 1.0.2 - 2026-11-16

Brand update.

- The top bar now shows the original NoxaPlus logo, with a light variant for
  the dark theme, replacing the generic file mark.
- The README uses the official NoxaPlus brand banner.
- Version labels now read 1.0.2.

## [1.0.1] - 2026-11-13

### Changed

- Rewrote the Persian interface copy for a more natural, human tone: a new hero headline and description, clearer workspace and tool hints, and warmer privacy and download messages. No functional changes.
- Regenerated the desktop and mobile screenshots and refreshed the version shown in the header.

## [1.0.0] - 2026-11-13

### Added

- Initial Persian RTL, local-first PDF workspace with light and dark themes, file-picker and drag-and-drop import, and a locally generated demo.
- Merge and arrange included pages in workspace order; selection by individual checkbox or current workspace range.
- Split included, ordered pages into individual PDFs or custom, nonoverlapping groups, with individual downloads and multi-output ZIP downloads.
- Per-page and included-page quarter-turn rotation, preserving source rotation and adding workspace adjustments.
- Persian and Latin page numbering with six positions, custom start, point-based size and margins, optional skipped cover, and plain or fraction labels. Numbering is added only to final PDFs; fraction counts are independent of a custom start and exclude a skipped cover.
- Rotation-aware numbering placement in the visible crop/media intersection, including page-box offsets and font metrics.
- Embedded standalone HTML build for `file://`, with a separate development entry at `app/index.html`, embedded libraries/fonts/resources, and a Blob-backed PDF.js worker. PDF.js is pinned to 6.5.438.
- Web-only PWA application-shell caching, without caching PDF documents; only the theme preference is persisted as user settings.
- In-memory previews, progress reporting, cancellation between processing stages, and explicit output download reminders.
- Automated model and real-PDF regression tests, English repository documentation, and the MIT license for NoxaPlus-authored code.
- Build-time embedded third-party notices and a distribution notice file at `dist/THIRD-PARTY-LICENSES.txt`; dependency and font licenses remain separate.

### Validation and boundaries

- Strict input header/EOF checks and supported page-structure validation; encrypted, corrupt, truncated, and unsupported/nonstandard PDFs are rejected.
- Limits: 50 MiB per file, 150 MiB combined input, 30 input files, 300 workspace pages, 100 split outputs, and 200 MiB combined generated PDF bytes.
- Original files remain unchanged. Closing or reloading loses the memory-only workspace; creating an output is not a substitute for downloading it.
- No password unlocking, OCR, compression, text editing, or PDF sanitization. Input previews omit annotations.
- No preservation guarantee for signatures, PDF/A, forms, bookmarks, attachments, or tagged accessibility; downloaded PDFs remain untrusted, source-derived files.
- Modern Chromium/Edge are the browser targets. The 1.0.0 release was smoke-tested in Google Chrome at desktop and mobile viewport sizes and through the standalone `file://` build. No broader browser support or audited accessibility claim is made.

[1.0.1]: https://github.com/noxaplus-star/noxaplus-pdf-desk/releases/tag/v1.0.1
[1.0.0]: https://github.com/noxaplus-star/noxaplus-pdf-desk/releases/tag/v1.0.0
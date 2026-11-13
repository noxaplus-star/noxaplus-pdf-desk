# Contributing to NoxaPlus PDF Desk

Thank you for helping improve a private, local-first PDF workspace. The application interface is Persian RTL; repository documentation, issue descriptions, and technical explanations should be in English where practical.

Use the exact brand **NoxaPlus**, the official website **https://www.noxaplus.ir**, and contact **NoxaPlus2025@gmail.com**. Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Issues and proposals

Use [GitHub issues](https://github.com/noxaplus-star/noxaplus-pdf-desk/issues) for reproducible bugs and focused feature proposals. Check existing issues first. Include:

- App version or commit, Node version if relevant, browser/version, operating system, and whether you used the development server, hosted build, or standalone `file://` HTML.
- Steps, expected behavior, actual behavior, and sanitized error details.
- For page problems: page count, inclusion/order, split expression, source rotation, page boxes, and numbering settings where relevant.
- A minimal synthetic PDF or locally generated demo reproduction when possible. Never post private documents, identifying file names, or confidential screenshots.

Report suspected vulnerabilities privately using [SECURITY.md](SECURITY.md), not a public issue. Discuss substantial feature or dependency changes before implementing them.

## Local setup

Use Node.js **22.13 or newer** and npm:

```sh
git clone https://github.com/noxaplus-star/noxaplus-pdf-desk.git
cd noxaplus-pdf-desk
npm ci
npm run dev
```

No backend credentials or environment secrets are required. See [README.md](README.md) for architecture and all commands. `npm run test:watch` is available while working; `npm run preview` serves the production build. Run `npm run icons` when intentionally updating application icons.

## Keep changes focused

- Prefer small changes to existing modules, with a regression test for each behavior fix. Explain the problem and trade-offs rather than unrelated cleanup.
- Preserve TypeScript types and keep page/range rules in `src/core/model.ts`, PDF validation/export in `src/core/pdf.ts`, and preview/resource lifecycle in `src/preview.ts`.
- Maintain Persian RTL layout, useful accessible names, keyboard operation, focus handling, readable feedback, and both themes. Implemented controls are not a substitute for an accessibility audit.
- Keep the workspace memory-only. Do not add uploads, analytics, remote fonts/CDNs, PDF caching, or persistent document state as an incidental change.
- Preserve source bytes, inclusion/order semantics, disjoint split groups, source rotation plus delta, and output-only numbering. Selection ranges use all workspace cards; split groups use only included, ordered pages.
- Keep errors understandable and retain validation, resource limits, and cancellation checks. Cancellation is cooperative between processing stages, not guaranteed to interrupt every library operation immediately.
- Do not hand-edit generated root `index.html` or `dist/`. Change authored sources or build scripts and regenerate the outputs according to the pull request's scope.
- Do not claim sanitization, guaranteed structural preservation, unsupported browser compatibility, or certified accessibility.

### Dependencies and notices

Use the lockfile and `npm ci` for reproducible installs. When dependencies change, update `package.json` and `package-lock.json` deliberately and review their actual licenses.

PDF.js is pinned to **6.5.438**. Its embedded worker adapts a decoder import in the distributed worker source; an upgrade must review that adaptation and retest embedded character maps, standard fonts, and decoders with no network access. A passing type check alone is insufficient.

Preserve third-party notices embedded by the build and `dist/THIRD-PARTY-LICENSES.txt`. NoxaPlus's MIT license does not replace PDF.js's Apache-2.0 license, the SIL Open Font License for Vazirmatn, or other dependency licenses. Do not copy code or assets without redistribution rights.

## Test before committing

Run these checks locally before creating a commit:

```sh
npm test
npm run typecheck
npm run build
```

Do not bypass failing checks. Existing tests exercise real PDF output as well as pure model rules; extend them without depending on private documents, network services, or a fixed total test count.

For UI, preview, PDF, or build changes, also check:

- [ ] Served production output with `npm run preview`, and generated root `index.html` opened directly through `file://` in a current Chromium-based browser or Edge. Record the exact browser/version; release verification is not assumed complete.
- [ ] Multi-file imports, invalid/encrypted inputs, cancellation, and preservation of the existing workspace after a failed import batch.
- [ ] Reordering, exclusions, range selection, individual splits, disjoint grouped splits, and omitted pages. Confirm actual downloaded PDF order and ZIP contents.
- [ ] Existing quarter-turn source rotation plus adjustments, including nonzero crop/media offsets and all final rotations.
- [ ] Persian and Latin multi-digit labels, plain/fraction styles, custom start, skipped cover, six positions, tiny pages, and point-based margins. Inspect final PDFs: input cards intentionally do not show new labels.
- [ ] Limits and error feedback; clearing/reloading discards work but never changes originals. Confirm download handoff rather than assuming a file was saved.
- [ ] Hosted offline shell after cache installation, standalone use without network access, and absence of PDF/name/workspace data in storage or caches. Only theme settings should persist.
- [ ] Responsive RTL layouts, both themes, keyboard tabs, dialog focus/closing, and preview cleanup. Use synthetic documents in generated screenshots under `docs/`.
- [ ] Embedded third-party notices and `dist/THIRD-PARTY-LICENSES.txt` are present in the resulting distribution.

Automated tests do not establish viewer fidelity, preservation of signatures/PDF-A/forms/bookmarks/attachments/tags, browser compatibility, or sanitization. Open downloaded outputs in an updated PDF viewer and document remaining limitations.

## Pull requests

Create a topic branch and use concise commits explaining why a change is needed. Submit a pull request to [the repository](https://github.com/noxaplus-star/noxaplus-pdf-desk) with:

1. The problem, intended behavior, and related issue, if any.
2. A short description of the solution and privacy/security implications.
3. Commands run, results, and manual browser/version checks; explicitly identify checks not run.
4. Synthetic before/after screenshots for visible changes and relevant regression tests.

Exclude secrets, private PDFs, `node_modules/`, and unrelated generated artifacts. Update existing documentation when user-visible behavior changes. Contributions to NoxaPlus-authored code are submitted under the repository's MIT license; third-party material retains its own license.

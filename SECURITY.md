# Security Policy

## Supported version

Security fixes target the latest NoxaPlus PDF Desk release, currently **1.0.0**. Older releases and modified third-party distributions are not promised backported fixes. Keep the application, browser, operating system, and PDF viewer updated.

Official repository: https://github.com/noxaplus-star/noxaplus-pdf-desk

Official web app: https://noxaplus-star.github.io/noxaplus-pdf-desk/

Official NoxaPlus website: https://www.noxaplus.ir

## Report a vulnerability privately

Email **NoxaPlus2025@gmail.com** with the subject `NoxaPlus PDF Desk security report`. Do not publish an exploit, sensitive PDF, or identifying document details in a public issue or pull request.

Include, where possible:

- Affected version/commit, browser/version, operating system, and whether the issue occurs on the hosted app or standalone `file://` build.
- Reproduction steps, expected boundary, observed behavior, and likely impact.
- A minimal synthetic PDF or safe proof of concept. Describe potentially harmful samples before sending them; do not send personal or confidential documents.
- Relevant sanitized logs, source locations, and any suggested fix.
- Whether and where the issue has already been disclosed.

Initial email is not a secure channel for highly sensitive attachments. Ask to agree on a suitable exchange method first if necessary. Maintainers will investigate and coordinate an appropriate fix and disclosure when possible; no guaranteed response time, resolution deadline, or bounty is offered. Please allow coordination before public disclosure.

## Privacy boundary

NoxaPlus PDF Desk is a client-side tool. It has no PDF upload endpoint or account-based document service.

- Original PDF bytes, file names, page selections/order, and generated outputs are handled in tab memory, not written to local storage, IndexedDB, or the service-worker cache by the application.
- Only the theme preference is persisted as a user setting. The hosted web version separately caches application-shell assets for offline execution, never PDFs.
- Standalone root `index.html` embeds code, libraries, fonts, character maps, and decoders. PDF.js uses a Blob-backed worker; document processing does not need a runtime CDN.
- Closing or reloading discards the workspace; outputs must be explicitly downloaded. Original local files are not overwritten or deleted.
- Downloads leave the workspace boundary and are saved under the browser's normal behavior. Hosting requests, browser extensions, operating-system storage, swap, crash reporting, and external links are outside the app's control.

These are application-design boundaries, not a guarantee of forensic erasure or protection on a compromised device. A compromised host, modified standalone HTML, malicious extension, browser vulnerability, or dependency vulnerability can invalidate them. Use trusted builds and updated software; do not assume that opening an arbitrary HTML copy is safe.

## Untrusted PDFs and outputs

**The app is not a PDF sanitizer, malware scanner, redaction tool, or safe-content certification service.** Input header/EOF checks, page validation, and local rendering do not prove that a document is harmless.

PDF output copies source-derived page content and may retain unsafe links, actions, annotations, or other reachable structures. Downloaded PDFs must remain classified as **untrusted source-derived files** and handled with your usual document-security policy. Use an updated PDF viewer; do not enable unsafe actions merely because a file passed through this app.

Input previews omit annotations and disable XFA rendering. Those preview choices do not establish that comparable content was removed from exported PDFs. A successful thumbnail is not an output-safety check or fidelity guarantee.

The app rejects encrypted files rather than unlocking passwords, and rejects detected corrupt, truncated, or unsupported/nonstandard input. It offers no OCR, compression, or text editing. Some PDFs accepted by tolerant viewers may be rejected here.

Exports are newly created PDFs. Digital signatures, PDF/A compliance, interactive forms, bookmarks, attachments, and tagged accessibility are not guaranteed to survive. Do not rely on the tool to preserve legal validity, archive compliance, form functionality, or accessibility structure; verify outputs independently.

## Resource use and cancellation

The enforced limits are 50 MiB per input file, 150 MiB combined input, 30 files, 300 workspace pages including excluded pages, 100 split outputs, and 200 MiB combined generated PDF bytes. ZIP overhead is additional. Memory use can exceed these byte totals.

Complex or hostile PDFs can still consume significant CPU or memory within those limits. Cancellation is cooperative between processing stages; a library operation may take time to finish before cancellation is observed. If necessary, close the tab, knowing that unsaved work will be lost.

## Dependencies and verification

PDF.js is pinned to **6.5.438**. Worker code, decoder imports, embedded resources, PDF-writing dependencies, and font handling are part of the security review surface. Updates require regression and offline browser checks, not merely a version bump.

Third-party components retain their own licenses and notices, including PDF.js under Apache-2.0 and Vazirmatn under the SIL Open Font License. Actual distribution notices are embedded during the build and included in `dist/THIRD-PARTY-LICENSES.txt`. The MIT license covers NoxaPlus-authored code, not a relicensing of dependencies.

Modern Chromium/Edge are the browser targets. Release smoke tests were performed in Google Chrome at desktop and mobile viewport sizes and through the standalone `file://` build. No independent security audit, universal browser compatibility, or audited accessibility claim is made. Tests and strict input checks reduce some failure modes but are not a security certification.

---
schema_version: 2
id: wb_01M0NYNG00XA7WJ9D36C74RJZW
number: 144
title: "Adopt Wowbagger image on GitHub and npm"
kind: task
priority: 1
status: done
created: 2026-08-23
updated: 2026-08-23
completed: 2026-08-23
provenance:
  source: "brand-asset-adoption"
  recorded_at: "2026-08-23T12:00:00Z"
depends_on: [ wb_01M0NYNG00MVXRSQFD7E182YBA ]
related: []
decisions:
  - action: accept
    date: 2026-08-23
    summary: "Accept the published image adoption work."
    rationale: "The accepted v5 asset is now in the shared README surface and the alpha9 npm package, with GitHub and tarball verification complete."
  - action: complete
    date: 2026-08-23
    summary: "Complete image adoption on GitHub and npm."
    rationale: "The accepted image is visible from the pushed GitHub README and included in the published alpha9 README/package tarball. Asset dimensions, size, and package paths were verified."
---

Adopt the accepted v5 robotic typing-agent Wowbagger image on the GitHub repository page and npm package page. The repository README is the shared presentation surface; npm renders the published README.

Asset:
- `assets/wowbagger-v5-typing-cats-circuit-staff.jpg`

Acceptance criteria:
- Add the accepted asset to the README branding area with concise accessible alt text and a stable relative or version-safe URL.
- Include the asset in the npm package's published files, or document and verify an equally stable public asset URL if npm cannot render the relative path.
- Run `npm pack --dry-run` and verify the image and README are included.
- Verify the README renders correctly on GitHub and the npm package page after publication.
- Preserve the 1024px square asset and its <=500 KB size target.
- Do not regenerate or replace the accepted v5 image.


Implementation outcome (2026-08-23):
- Added the accepted v5 asset to the README branding area with accessible alt text and a stable GitHub raw URL.
- Added `assets/` to the npm package file set.
- Published the README and all five image candidates in `wowbagger@0.1.0-alpha.9`.
- Verified GitHub main README contains the image, npm tarball contains `package/README.md` and `package/assets/wowbagger-v5-typing-cats-circuit-staff.jpg`, and the asset remains 1024x1024 at 328658 bytes.
- Release: `v0.1.0-alpha.9`, commit `da49db6`; image adoption commit `7dc823a`.

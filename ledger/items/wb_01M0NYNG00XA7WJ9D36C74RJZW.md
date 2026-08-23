---
schema_version: 2
id: wb_01M0NYNG00XA7WJ9D36C74RJZW
number: 144
title: "Adopt Wowbagger image on GitHub and npm"
kind: task
priority: 1
status: triage
created: 2026-08-23
updated: 2026-08-23
provenance:
  source: "brand-asset-adoption"
  recorded_at: "2026-08-23T12:00:00Z"
depends_on: [wb_01M0NYNG00MVXRSQFD7E182YBA]
related: []
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

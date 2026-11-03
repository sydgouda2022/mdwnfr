# Deployment — one production route

- GitHub source authority: `sydgouda2022/mdwnfr` branch `main`.
- Cloudflare application: https://mdwnfr.sydgouda.workers.dev/.
- Cloudflare Worker: `worker.mjs`, serving `dist/` assets directly.
- No alternate build publishers, alternate editor UI bundles or compatibility
  editions are maintained.

The core workflow validates the pinned keyboard API, Unicode glyph/font
assets, Python document transactions and layout, and the offline publication
manifest. The browser workflow verifies touch editing using Chromium/WebKit.
`tools/build_static.py` computes a fingerprint from every packaged file.
A production release requires explicit `[deploy-cloudflare]` or manual
dispatch and is accepted only after the public build hash and offline asset
inventory match the local package.

The PWA keeps the prior verified cache during atomic activation. Locally
stored documents are not synchronized to a server or backed up externally.

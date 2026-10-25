# MdwNfr — Hieroglyphic Writing Editor

Standalone, offline-first browser editor. **MdwNfr owns documents and layout;
[sydgouda2022/hieroglyphic-keyboard](https://github.com/sydgouda2022/hieroglyphic-keyboard)
owns native sign input, the verified Late Egyptian lexicon and predictions.**

## Source boundaries

- `core/mdwnfr/`: Python document model, reversible transactions, font-based
  quadrat composition, silhouette-safe page layout and JSON RPC.
- `web/app.js`: iPhone/iPad UI, clipboard, local editor state and rendering.
- `web/vendor/hieroglyphic/`: *unaltered*, pinned API v1 modules imported
  from the independent keyboard repository. Do not edit upstream files here.
- `web/lexicon/`: the independent keyboard's published data and manifest.
  No second MdwNfr Python predictor or SQLite lexicon is bundled.
- `web/storage.js`: device-local documents and recovery snapshots.
  Portable JSON export/import is available in the Documents library.
- `tools/`: reproducible offline publication and dependency verification.

The exact upstream keyboard Git commit, release manifest, lexicon checksum and
each vendored API module SHA-256 appear in `keyboard-lock.json`.

## Local build

Use Python 3.12. The CI workflows rebuild the pinned font, generate glyph
geometry, self-host Pyodide and package the static editor:

```bash
python tools/sync_keyboards.py --verify
python tools/vendor_runtime.py
python tools/build_static.py
```

The font generation step requires the pinned Google Fonts Noto source and
fontTools, Pillow, Brotli (see the CI workflow). The browser uses only glyphs
supported by its installed Noto font; a Unicode sign is not deemed renderable
merely because its codepoint exists in a newer Unicode standard.

Documents remain in IndexedDB on the current browser/device. Backups exported
as JSON are portable but **not encrypted**; retain copies separately.
Revision-checked saving prevents silent overwrites by another open tab.
An offline publication only replaces a working cache after all listed assets
are downloaded and verified.

## Deployment

Production remains owned by the original `aaa` deployment until an explicit
cutover. New-repository Cloudflare deployment is gated behind
`CUTOVER_ENABLED=true`; this refactor does not enable it. See `CUTOVER.md`.

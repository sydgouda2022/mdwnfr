# Keyboard integration

MdwNfr consumes the separately maintained headless Hieroglyphic Keyboard API. The embedded files under `web/vendor/hieroglyphic/` are a pinned, locally hosted copy, not an independent implementation. The app owns all UI, editing, geometry and persistence; the keyboard owns signs, search, prediction and dictionary installation. Its API uses native Egyptian Unicode. Source: `sydgouda2022/hieroglyphic-keyboard`, API 2.0.1.

The browser editor uses `createKeyboardFromData()` for sign keys and runs `createHieroglyphicKeyboard()` in a dedicated prediction worker. The lexicon is pinned with `keyboard-release-pin.json`; upgrade API modules and the associated dictionary lock together and run Chromium/WebKit acceptance before deploying.

MdwNfr documents can be exported as `.mdwnfr.json` files from the document library and re-imported after Python validation. The importer intentionally refuses an ID that already exists, rather than overwriting it. Browser IndexedDB and snapshots are not independent backups.

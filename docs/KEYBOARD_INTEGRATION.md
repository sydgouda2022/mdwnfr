# Keyboard integration

MdwNfr consumes the separately maintained headless Hieroglyphic Keyboard API. The embedded files under `web/vendor/hieroglyphic/` are a pinned, locally hosted copy, not an independent implementation. The app owns all UI, editing, geometry and persistence; the keyboard owns signs, search, prediction and dictionary installation. Its API uses native Egyptian Unicode. Source: `sydgouda2022/hieroglyphic-keyboard`, API 2.0.1.

The browser editor uses `createKeyboardFromData()` for sign keys and runs `createHieroglyphicKeyboard()` in a dedicated prediction worker. The lexicon is pinned with `keyboard-release-pin.json`; upgrade API modules and the associated dictionary lock together and run Chromium/WebKit acceptance before deploying.

The Documents library deliberately provides no general Import or Export commands. An emergency **Export unsaved** download appears only after an autosave problem. The current UI cannot re-import this file; preserving a downloaded copy is not a substitute for a supported restore procedure. Documents and internal snapshots are local to browser IndexedDB and cannot recover from cleared site data or device loss.

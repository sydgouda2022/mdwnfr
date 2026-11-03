# Canonical keyboard integration

The only sign/lexicon/prediction authority is the independently maintained
headless Hieroglyphic Keyboard API under `web/vendor/hieroglyphic/`.
The vendored source and single Unicode corpus are pinned by
`keyboard-lock.json`, with the browser release pin created by the build.

`web/app.js` owns the user interface, while
`web/keyboard-prediction-worker.mjs` consumes the headless prediction API.
The app has three sign groups (uniliteral, biliteral, triliteral) and a
persistent 15-key Egyptian numeral strip. All glyph input contexts must share
one key-layout implementation; a separate prediction engine is prohibited.
The keyboard has no independent application or network service.

The editor owns all document object IDs, revisions, geometry and persistence.
Changes to the dictionary require reviewing both the API version and checksum,
then testing with Chromium and WebKit before publication.

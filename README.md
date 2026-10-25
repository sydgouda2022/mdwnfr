# MdwNfr — Hieroglyphic Writing Editor

Independently owned Python document model, hieroglyphic text
compositor, page geometry, iPad/iPhone editor and offline PWA,
migrated from `sydgouda2022/aaa/mdwnfr`.

Native hieroglyphic predictive input and its lexicon are imported
exclusively from `sydgouda2022/hieroglyphic-keyboard`, with exact
source commit and SHA-256 checksum in `keyboard-lock.json`.
Neither MdwNfr nor Renpet edits the keyboard's source database.
Production Cloudflare deployment remains with the original
repository until an explicit migration cutover.

## Headless keyboard API

The public Hieroglyphic Keyboard API v2 is pinned in `web/vendor/hieroglyphic/` and supplies sign lookup. The existing Python prediction bridge remains until the consumer migration is tested. MdwNfr still owns editing, documents and layout. The lexicon is incomplete. Local recovery snapshots are not external backups.

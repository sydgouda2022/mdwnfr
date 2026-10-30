# MdwNfr — Hieroglyphic Writing Editor

Independently owned Python document model, hieroglyphic text
compositor, page geometry, iPad/iPhone editor and offline PWA,
migrated from `sydgouda2022/aaa/mdwnfr`.

Native hieroglyphic predictive input and its lexicon are imported
exclusively from `sydgouda2022/hieroglyphic-keyboard`, with exact
source commit and SHA-256 checksum in `keyboard-lock.json`.
Neither MdwNfr nor Renpet edits the keyboard's source database.
Production Cloudflare deployment is owned by this repository. Automatic
publication from the old `aaa` repository is disabled. Releasing a verified
`main` build to the public URL requires an explicit deployment gate.

## Headless keyboard API

The pinned headless Hieroglyphic Keyboard API v2 lives under `web/vendor/hieroglyphic/` and owns sign lookup, native Unicode predictions and dictionary integrity. It runs in `web/keyboard-prediction-worker.mjs`. Python owns document validation, transactions and quadrat layout only; no duplicate prediction implementation is bundled. The historical corpus remains incomplete, and local recovery history is not an external backup.

## Documents and local storage

The Documents library presents New Document and the basic Rename/Delete actions. Import, Export, and document-history controls are deliberately excluded from this interface. Documents are saved locally in IndexedDB, with internal rotating recovery snapshots; those local snapshots are not external backups and do not survive cleared browser data or device loss. An emergency download is available only when an unsaved document cannot be committed.

Keyboard dependency upgrades require a reviewed change; CI verifies the pinned release without pushing automatically to main.

The iPhone/iPad drawing surface uses 44 CSS-pixel resize handles; document margins now govern papyrus viewport lookup and image drag geometry. All imported/pasted document glyphs must be supported by the bundled rendering font.

The production browser build derives `keyboard-release-pin.json` from the reviewed `keyboard-lock.json`, validates the published lexicon bytes, and precaches the exact pin for offline keyboard initialization. The API's source notices are included under `web/vendor/hieroglyphic/`.

Deleting a document also removes its per-document prediction preferences. CI runs storage-recovery, facing, and layout-detail guard tests in addition to the browser suite.

The headless API v2 caps one prediction result window at 80 entries. The editor labels expanded results accordingly; it does not claim that 80 predictions exhaust the 41,330-record corpus.

Document library order reflects successful IndexedDB save times. Keyboard Enter/Space works on cartouches and table cells, and the layout worker can be restarted after fatal initialization errors without a permanently pending layout request.

## Packaged browser assets

The PWA and source now contain a single pinned prediction implementation: the independent headless keyboard API with one browser lexicon. Redundant Python predictor, duplicate database, standalone legacy sign catalog, and legacy lexicon installer have been removed from MdwNfr. Independent keyboard development and dataset compilation belong in `sydgouda2022/hieroglyphic-keyboard`. The verified editor still runs entirely offline after its complete runtime installs. See `docs/RECOVERY_AND_CLIPBOARD.md` for data-safety limits.


## Reliability and responsive editing

- Autosave uses persisted-revision checks. Failed saves expose a recovery export and uncommitted changes warn on tab close.
- My Words can be added, browsed, edited, and deleted. Profile updates are serialized by IndexedDB across tabs.
- Table-cell and cartouche formatting is undoable through Python-validated replace operations; replacing nested text retains existing word styles.
- Pages show bounded miniatures derived from actual Python layout coordinates. The v2 unified compositor recomposes changed streams from persistent IDs; identical inputs reuse geometry. No separate wrap-before/after-object algorithms remain.
- The isolated Pyodide layout worker is started on demand and released after 45 seconds idle. Returning to Documents releases it immediately. Detail requests restore authoritative layout when needed.
- The inspector exposes page margins, while its sole bundled font is displayed as a label rather than a nonfunctional menu.
- CI verifies native formatting, recovery transactions, pinned keyboard source, Chromium/WebKit touch workflows and offline startup. Production deployment remains explicitly gated and is separate from CI.


## Layout Engine 2 — one stream, one compositor

The document is an ordered sequence of uniquely identified objects; paper, columns and x/y positions are only layout results. Words are quadrats containing ordered glyph atoms, each with a persistent symbol ID. Tables and cartouches contain their own nested quadrats. Images and clip art expose measured silhouettes and quarter-column clearance through the same geometry contract.

- Changing A3 to A4, removing earlier/later words or resizing artwork never reassigns object IDs or changes logical sequence.
- The Python compositor derives columns and page placement from currently available writing space. The UI mirrors Python-projected glyph geometry rather than constructing a second flow.
- Existing documents without symbol atom IDs remain compatible; symbols get deterministic IDs based on their word IDs until edited.
- The old special-case text-before/after-artwork, table-wrap and cartouche-wrap paths have been replaced by one object/obstacle placement flow.
- Editing currently recomposes the changed stream using cached quadrats, instead of the previous completed-column incremental cache. The compact browser layout still supports lazy viewport pages.

Read [Layout Engine 2 contract](docs/LAYOUT_ENGINE_V2.md) for the object identity, text order and silhouette rules.

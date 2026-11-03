# MdwNfr — Hieroglyphic Writer

MdwNfr is a device-local hieroglyphic writing PWA for iPhone and iPad.
The single production source is this repository's `main` branch and the
published application is https://mdwnfr.sydgouda.workers.dev/.

## Canonical application

The Documents library is the initial view: an iPhone list and iPad document
grid, a floating lower-right + to create a document, and contextual ellipsis
actions for Rename and Delete. Documents and learning preferences are saved
locally in IndexedDB. Clear-browser-data actions permanently erase them.

The editor stores a sequence of identified quadrats and other objects. Python
authorizes every transaction and determines page, column, silhouette and glyph
geometry. The browser renders the resulting positions and handles touch.
Creation and editing of images, artwork, tables and cartouches belong to the
four respective Insert screens. The Format inspector owns typography, color,
paper, direction, history and selected-object controls.

Native hieroglyphic signs and predictions are consumed from the separately
maintained `hieroglyphic-keyboard` headless API, pinned by
`keyboard-lock.json`. No second lexicon database or prediction engine is
authored here. `web/worker.js` is the one Python RPC adapter, instantiated in
independent edit and layout workers to keep the writing surface responsive.

## Run and publish

CI requires Python 3.12, Node 24, pinned Pyodide, and the licensed hieroglyph
font. The build fingerprints **all** packaged assets and refuses incomplete
offline installation manifests. All application editing and prediction happen
on-device, including while offline after a complete install.

Cloudflare Workers publishes the `main` build only via the explicit
`[deploy-cloudflare]` gate or manual deployment dispatch. Publication is
verified against the current hash and complete offline inventory. A git push
or successful CI check alone does not mean a new build is live.

See `docs/EDITOR_UX.md`, `docs/KEYBOARD_INTEGRATION.md`,
`docs/LAYOUT_ENGINE_V2.md`, `docs/RECOVERY_AND_CLIPBOARD.md`, and
`docs/DEPLOYMENT.md` for current contracts and limitations.

Emergency unsaved JSON downloads do not currently have a restore/import UI.
Internal recovery checkpoints are device-local, not external backups.

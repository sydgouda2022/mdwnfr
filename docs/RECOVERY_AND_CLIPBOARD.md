# Recovery, backups and clipboard

MdwNfr stores documents locally in IndexedDB. It does not sync or upload them. Export documents regularly from the Documents library; local history alone is **not** an independent backup.

## Multiple tabs

Saves, renames, deletions and restores compare the exact stored document revision within an IndexedDB readwrite transaction. On conflict the newer saved copy is preserved. If an editor cannot save when navigating back to the library, it offers a separate JSON recovery download with a new document ID. Do not discard unsaved edits before exporting a copy.

## Snapshot size

Automatic snapshots are thinned by age, count (48) and an approximately 40 MiB per-document budget; a large automatic snapshot may be skipped. On explicit history restoration, MdwNfr first writes a **full** pre-restore rollback checkpoint even when the document exceeds that automatic budget. The most recent pre-restore checkpoint is protected from routine pruning. This is bounded to one exceptional oversized checkpoint. The browser's real IndexedDB quota still applies: if the transaction fails, the existing document remains unchanged. Export a separate file for large illustrated documents.

## Clipboard provenance

Native paste events and successful system clipboard reads are treated as external **plain native Egyptian Unicode**, even if the text matches an earlier internal copy. Rich MdwNfr objects can be pasted only when the browser denies system clipboard access and the editor deliberately uses its own session clipboard. The browser may allow local-only cut/copy even when its system clipboard permissions are denied; the app reports that restriction.

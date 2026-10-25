# Document recovery and clipboard contract

MdwNfr stores documents locally in IndexedDB, not in a remote account. Export `.mdwnfr.json` backups to another device or storage location; on-device history is not an independent backup.

## Revision safety

Document saves, renames, deletes, and restores compare exact persisted revisions inside IndexedDB readwrite transactions. Stale tabs cannot overwrite newer committed content. Spelling preferences and My Words instead use atomic intent-based profile updates so a second tab cannot erase a first tab's new choices. Preference maps retain the highest-weighted 2048 spellings; My Words supports up to 5000 entries.

Uncommitted editor changes trigger a before-unload warning, and a failed autosave exposes an **Export unsaved** button. Use it before closing or reloading. The exported recovery copy receives a fresh document ID and can be imported without overwriting the saved original.

## History for large documents

Normal automatic history has a 40 MiB budget and 48-point aging policy. Documents larger than the budget, up to a 120 MiB upper bound, receive **best-effort** automatic oversized checkpoints in a separate transaction. A backup-quota failure cannot cancel an otherwise valid document save. Only the latest oversized auto checkpoint is retained. A history restore always attempts a full reversible pre-restore checkpoint, regardless of the automatic budget.

No browser storage technique can promise recovery after full quota exhaustion, cleared site data, device loss, or crash before a checkpoint completes. Large illustrated documents should be exported regularly.

## Clipboard provenance

MdwNfr uses Unicode plain text for external programs and its private rich-fragment format when the browser supports clipboard custom data. Native clipboard events use `application/x-mdwnfr-fragment+json`; the asynchronous Clipboard API uses the browser's `web ` custom-format prefix. Unknown clipboard content is treated as plain Unicode, and matching text alone never triggers a hidden rich-object paste. Browser permission denial can fall back to the current tab's internal clipboard; the app reports when content is only available inside MdwNfr.

Imported documents and rich clipboard objects are validated by the Python core. Object IDs are regenerated on paste.

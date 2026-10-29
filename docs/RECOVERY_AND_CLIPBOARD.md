# Document recovery and clipboard contract

MdwNfr stores documents locally in IndexedDB, not in a remote account. The Documents library intentionally does not expose Import, Export, or History actions. Internal recovery checkpoints are not independent backups and cannot survive browser data clearing or device loss.

## Revision safety

Document saves, renames, deletes, and internal restore transactions compare exact persisted revisions inside IndexedDB readwrite transactions. Stale tabs cannot overwrite newer committed content. Spelling preferences and My Words instead use atomic intent-based profile updates so a second tab cannot erase a first tab's new choices. Preference maps retain the highest-weighted 2048 spellings; My Words supports up to 5000 entries.

Uncommitted editor changes trigger a before-unload warning, and a failed autosave exposes an emergency **Export unsaved** button. Use it before closing or reloading and keep the downloaded copy safely; the minimal Documents library currently has no general-purpose Import control. The emergency copy has a fresh document ID to avoid overwriting the original.

## Internal recovery checkpoints for large documents

Normal automatic history has a 40 MiB budget and 48-point aging policy. Documents larger than the budget, up to a 120 MiB upper bound, receive **best-effort** automatic oversized checkpoints in a separate transaction. A backup-quota failure cannot cancel an otherwise valid document save. Only the latest oversized auto checkpoint is retained. The internal restore primitive attempts a reversible pre-restore checkpoint, regardless of the automatic budget. There is intentionally no document History interface in this release.

No browser storage technique can promise recovery after full quota exhaustion, cleared site data, device loss, or crash before a checkpoint completes. Removing visible Import/Export controls limits portability; don't clear site storage or uninstall the app if it contains irreplaceable documents.

## Clipboard provenance

MdwNfr uses Unicode plain text for external programs and its private rich-fragment format when the browser supports clipboard custom data. Native clipboard events use `application/x-mdwnfr-fragment+json`; the asynchronous Clipboard API uses the browser's `web ` custom-format prefix. Unknown clipboard content is treated as plain Unicode, and matching text alone never triggers a hidden rich-object paste. Browser permission denial can fall back to the current tab's internal clipboard; the app reports when content is only available inside MdwNfr.

Rich clipboard objects and any documents processed through the Python validation core are validated before use. Object IDs are regenerated on paste.

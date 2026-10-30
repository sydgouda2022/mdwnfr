# MdwNfr editor UX contract

MdwNfr is an **Egyptian hieroglyphic document editor**, not desktop
publishing software. Its interaction model should be familiar to someone
who uses Google Docs on a phone or tablet. This is a usability reference,
not a copy of Google branding, cloud collaboration, or rich-text internals.

## Interaction principles

1. **The page is the main workspace.** A tap selects a word or object;
   a second intentional action edits it. Never obscure the document
   with a second miniature page preview.
2. **Contextual before global.** A selected illustration, image, table or
   cartouche gets a compact Edit / Copy / Delete strip. Selecting whole
   hieroglyphic words shows Edit, Bold, black/red ink, Copy and Delete; for
   multi-word selection the singular Edit action disappears. The full Format
   inspector is optional. Empty-space taps dismiss transient UI.
3. **Touch is first-class.** Resize handles are at least 44 CSS pixels
   regardless of the page zoom. A stationary tap is not a resize,
   and a cancelled gesture never saves an edit.
4. **One document model.** All edits use the same revisioned Python
   object transactions. The UI never creates alternate geometry or
   stores page/column coordinates.
5. **Familiar editing history.** Cut, Copy, Paste, Undo and Redo work on
   logical object IDs. Delete is reversible; no hidden destructive edits.
6. **Local only.** Documents, fonts, keyboard predictions and recovery
   remain on device. No account, cloud synchronization or tracking is
   introduced to imitate a Docs-style workflow.
7. **Egyptian-first typography.** Quadrats, glyph direction, cartouches
   and silhouette clearance are authored by the compositor. Familiar
   touch controls must never distort signs or invent spacing.

## Acceptance boundaries

- Phone viewports: 375 and 390 CSS px; tablet: 1024 CSS px; both
  Chromium and WebKit where supported by CI.
- Selection actions must be accessible without requiring double tap,
  and must not cover the first/second object tap or resize handle.
- Cancelling a property inspector leaves document revision and object
  identity unchanged.
- A3/A4/A2, LTR/RTL, deletion and inserted-object resizes must preserve
  the logical sequence. Full and compact geometry must agree.
- Existing word long-press menu retains Cut / Copy / Paste / Select All /
  Delete; no separate clipboard implementation is permitted.

Future improvements should prioritize the writing surface, familiar
navigation and safe local editing over additional floating panels.

Word selection remains quadrat-based rather than character-based. A tap selects
one whole word; Shift+tap or the existing range handles extend the selection.
Edit opens the familiar glyph keyboard on that word, while the quick actions
reuse the same revisioned style and clipboard commands as Format.

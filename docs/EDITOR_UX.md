# MdwNfr UI/UX — active contract

MdwNfr is a touch-first, local hieroglyphic document editor, not a desktop
publishing suite. The document is the canvas; Python owns its geometry.

- **Documents:** compact list on iPhone, preview grid on iPad, floating +
  for creation, and ellipsis for Rename/Delete.
- **Editor:** one selected object/word at a time or a defined multi-word
  selection; contextual Edit/Copy/Delete actions appear only when relevant.
- **Format:** typography, Egyptian colors, writing surface, direction, and
  undo/redo. It must not create a competing document or layout model.
- **Insert:** four separate touch-friendly sheets for artwork, images,
  tables and cartouches. A draft uses the actual writing surface and saves
  only on Done. Cancel and outside-tap discard the draft.
- **Keyboard:** three symbol pages with centered rows and persistent
  numerals at the top. On phones it must leave writing space visible.
  The movable launcher retains reliable tap versus drag behavior.
- **Object manipulation:** use on-page gestures and 44px handles with the
  quarter-column silhouette clearance contract. No UI-only wrap decisions. Every image has one exact 256×256 opacity mask; old row-envelope approximations are not supported.
- **Offline:** a complete Pyodide/font/lexicon installation is required.
  No account or remote user-document storage exists.

Test touch, cancellation, revision conflicts, nested text entry, keyboard
placement and compact/full geometry parity on phone (375/390 px) and tablet
(1024 px) widths using Chromium and WebKit.

The read-only live user-journey audit exercises the Insert sheet for both
creation and editing of existing tables, with actual on-page drag/resize checks.

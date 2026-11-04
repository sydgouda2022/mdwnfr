# Hieroglyph shape and relative-size inventory (first pass)

This is a **mechanically generated provisional classification of all 1,072 signs** in the one installed Noto Sans Egyptian Hieroglyphs glyph catalogue. It is not yet a historical composition rule, and it does not change the editor compositor.

## Two independent metrics

- **Shape** uses actual visible ink width divided by visible ink height, never an abstract character cell: **tall** below 0.70, **square-ish / semi-square** from 0.70 through 1.40, and **wide** above 1.40.
- **Relative size** uses the longer visible ink dimension, in the font's em units: **compact** below 0.70 em, **normal** otherwise. We deliberately do **not** classify size by ink area; that would mark naturally wide, short signs as tiny.

Every sign has exactly one shape and one size label. The two labels are independent; for example a sign can be **wide + compact**, or **tall + normal**. `needs_review` flags a measurement close to a cutoff; it does **not** mean that all other entries have been reviewed by an Egyptologist.

## First-pass distribution

| Shape | Normal | Compact | Total |
| --- | ---: | ---: | ---: |
| Square-ish / semi-square | 429 | 55 | 484 |
| Tall / thin | 284 | 16 | 300 |
| Wide / short | 276 | 12 | 288 |
| **Total** | **989** | **83** | **1,072** |

There are **229 threshold-adjacent signs** flagged for visual review. The remaining classifications are also provisional until the glyph examples have been checked.

## Examples

| Gardiner sign | Unicode | Shape | Size |
| --- | --- | --- | --- |
| G17 | 𓅓 | square-ish | normal |
| M17 | 𓇋 | tall | normal |
| N35 | 𓈖 | wide | normal |
| I9 | 𓆑 | wide | normal |
| Q3 | 𓊪 | square-ish | compact |

Q3 illustrates why size cannot be inferred from shape. It has semi-square proportions but is much smaller in the current font's natural ink dimensions.

## What these labels **do not** mean yet

- **Every sign can still appear by itself.** Compact does not mean that the compositor must pair it with something else.
- The labels do not force vertical or horizontal stacking, enlarge a glyph, or override the word's reading sequence.
- A sign's permissions to share space **horizontally**, share space **vertically**, or serve as a **tall host** remain a separate next-stage rule, after visual inspection. This avoids repeating the error of equating "narrow" with "the only sign eligible for pairing".
- Placement still requires an actual silhouette collision and balance test; the catalog is descriptive metadata, not layout instructions.

## Single inventory source

- Input: `core/mdwnfr/data/glyph_geometry.json` (the measured glyph outlines).
- Generated classification: `core/mdwnfr/data/sign_profiles.json`.
- Generator: `python tools/build_sign_profiles.py`.
- Check for any stale inventory: `python tools/build_sign_profiles.py --check`.
- Integrity and canonical examples: `qa/test_sign_profiles.py`.

This stage **does not modify** `core/mdwnfr/quadrat.py` or production rendering. The next task is to review borderline and visually exceptional signs, then define composition eligibility using the approved shape and size catalogue.

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

- Runtime input: `core/mdwnfr/data/glyph_geometry.json` (the validated measured glyph outlines).
- Authoritative thresholds and classification: `core/mdwnfr/quadrat.py` (`classify_sign_bounds`).
- Review-only generated classification: `core/mdwnfr/data/sign_profiles.json` (not loaded by Pyodide).
- Generator: `python tools/build_sign_profiles.py`.
- Check for any stale inventory: `python tools/build_sign_profiles.py --check`.
- Integrity and canonical examples: `qa/test_sign_profiles.py`.

## Implemented composition rules

The compositor in `core/mdwnfr/quadrat.py` computes the same classification directly from its already-verified `glyph_geometry.json` data. The generated `sign_profiles.json` is a reviewable export, **not a second runtime dependency**. This prevents older browser workers from failing when they load updated compositor code before acquiring a new optional classification file. Placement uses these rules:

1. Every sign may stand alone, centered at natural visible proportions.
2. Two consecutive signs may share a horizontal row when one is compact or both are tall, provided the actual silhouettes fit.
3. A normal-sized tall host followed by two compact or wide companions can form a top/bottom-aligned stack beside the host; the reverse input order is supported as well. The companions fill the host height proportionally to their natural ink heights.
4. Every internal pair of nearby visible outlines maintains **at least 5% of the column width** as clearance (with scan resolution allowance). The **20% visible-height gap between finished rows** is a separate existing rule.
5. Every candidate preserves glyph aspect ratios and is centered inside the column. A small, bounded whole-group scale reduction is allowed when a proposed grouping slightly exceeds the column width.
6. The compositor chooses the valid grouping minimizing total written height for the entire ordered word. If no pairing fits, it uses consecutive standalone rows. The editor does not enforce mandatory pairing or rewrite sign order.

For a 20 mm column, M17 + Q3 + Q3 now uses a 15 mm host, a 1 mm vertical internal gap, and two 7 mm-high Q3 companions, retaining Q3's actual width/height ratio and aligned top/bottom edges.

**Scope:** These are deterministic automatic layout heuristics based on measured font geometry, not a claim that every generated grouping is a historically attested spelling. The 229 boundary-adjacent classifications still merit expert visual review. The existing document model, local storage, table/cartouche layout, and page/column justification are unchanged.

To run the composition regression suite:

```sh
PYTHONPATH=core python -m unittest qa.test_silhouette_spacing qa.test_sign_profiles -v
```


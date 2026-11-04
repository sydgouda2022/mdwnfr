# Hieroglyph shape, relative size and quadrat classes

This is a **mechanically measured inventory of all 1,072 signs** in the one installed Noto Sans Egyptian Hieroglyphs font. It gives the compositor a consistent starting description of each sign. It is not a claim that every sign has one fixed size or one mandatory historical placement.

## Two independent measurements

- **Shape** is the visible-ink width divided by visible-ink height. Tall signs are below 0.70; square-ish signs are from 0.70 through 1.40; wide signs are above 1.40.
- **Relative size** is the longer visible-ink dimension measured in font em units. A sign is compact below 0.70 em and normal-sized otherwise. Size is not measured by bounding-box area: a naturally wide, short sign must not be mistaken for a tiny sign.

The two measurements remain available separately. The four convenient quadrat classes are derived from them:

| Quadrat class | Measurement rule | Signs |
| --- | --- | ---: |
| **Square / full** | Square-ish + normal | 429 |
| **Tall / narrow** | Tall + normal | 284 |
| **Wide / low** | Wide + normal | 276 |
| **Small / compact** | Compact, regardless of aspect ratio | 83 |
| **Total** | | **1,072** |

This preserves the distinction between shape and size while giving the composition engine the four classes used in Egyptological descriptions of quadrat proportions.

## Canonical examples

| Gardiner sign | Unicode | Shape | Size | Quadrat class |
| --- | --- | --- | --- | --- |
| G17 | 𓅓 | Square-ish | Normal | Square |
| M17 | 𓇋 | Tall | Normal | Tall |
| N35 | 𓈖 | Wide | Normal | Wide |
| I9 | 𓆑 | Wide | Normal | Wide |
| Q3 | 𓊪 | Square-ish | Compact | Small |

Additional examples from the published four-shape typology are covered by tests: G14 and W17 (full/square), P6, R8 and S34 (tall/narrow), D21, T11 and V31 (low/broad), and Q3 and W11 (low/narrow).

## Historical basis and limits

Stéphane Polis describes four basic sign shapes relative to an ideal quadrat: tall-and-broad, tall-and-narrow, low-and-broad, and low-and-narrow. He also notes that actual sign sizes vary with the available writing space, that some tall-narrow signs can stand alone, and that the goal is balanced, legible composition. See [Polis, “The Functions and Toposyntax of Ancient Egyptian Hieroglyphs” (2018), pp. 294–295](https://doi.org/10.4000/signata.1920).

James P. Allen's introduction likewise describes tall, flat and small signs, noting that tall signs often stand alone while other signs are commonly grouped; flat or small signs can also stand alone when centered. See [Allen, *Middle Egyptian*, §1.7 (Cambridge University Press)](https://assets.cambridge.org/97805215/17966/excerpt/9780521517966_excerpt.pdf).

These sources support the four broad visual classes, **not a universal permission table**. A shape label alone cannot prove that a sign must be alone, must be paired, or may only occupy one side of a group. Actual inscriptions show multiple arrangements, insertion and kerning; scribes adapt sign size and position to the surrounding signs and the writing surface.

The 229 entries marked `needs_review` lie near one of the mechanical cutoffs and should receive priority in visual review. The remaining entries are also machine-classified; absence of the flag is not Egyptological approval. The font's standardized outlines are a measurement source, not a substitute for period-specific epigraphic examples.

## What the classes mean for the editor

- Every sign remains eligible to appear alone. A standalone sign is centered in its available quadrat.
- The four classes describe geometry. They do not by themselves force grouping or change the spelling order.
- A small sign is a potential companion or insert, not a sign that must always be attached to a neighbor.
- A tall sign may be a standalone sign or a host for a smaller sign, depending on its actual outline and the evidence for the arrangement.
- A wide sign may participate in a vertical stack, but its class alone does not guarantee that the combination fits.
- Any future sign-specific restriction such as “always alone” must be supported by inspected historical examples, not inferred solely from its aspect ratio.

## Single inventory source

- Runtime measurements: `core/mdwnfr/data/glyph_geometry.json`.
- Authoritative classifier: `core/mdwnfr/quadrat.py`, `classify_sign_bounds`.
- Reviewable export: `core/mdwnfr/data/sign_profiles.json` (not a second runtime dependency).
- Generator: `python tools/build_sign_profiles.py`.
- Consistency check: `python tools/build_sign_profiles.py --check`.
- Regression tests and canonical examples: `qa/test_sign_profiles.py`.

The four-class label is derived from the two metrics:

- `square` = square-ish + normal.
- `tall` = tall + normal.
- `wide` = wide + normal.
- `small` = compact, regardless of aspect ratio.

## Current automatic composition subset

The compositor currently supports:

1. A sign on its own row.
2. Two consecutive signs sharing a horizontal row when the class rules and actual measured silhouettes permit it.
3. A normal tall host beside two small or wide companions stacked vertically; the companions are proportionally sized to fill the host's height.

Every candidate preserves input order, visible aspect ratio and measured ink clearance. Internal clearance is 5% of column width. The separate natural gap after a finished row is 20% of that row's visible height.

These three automatic patterns are an intentionally limited implementation, **not a complete model of all historically attested hieroglyphic grouping**. The scholarly literature also describes insertion, more general stacking, connecting, combining and kerning. Those require separate design decisions and evidence-based rules before being added to automatic layout.

For a 20 mm column, M17 + Q3 + Q3 uses a 15 mm host, two 7 mm-high Q3 signs, and a 1 mm internal gap (5% of column width). The top and bottom of the stacked Q3 group align with the host.

To run the composition regression suite:

```sh
PYTHONPATH=core python -m unittest qa.test_silhouette_spacing qa.test_sign_profiles -v
```

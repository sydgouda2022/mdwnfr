# Hieroglyph shape, size and quadrat classes

This is a **mechanically measured inventory of all 1,072 signs** in the installed Noto Sans Egyptian Hieroglyphs font. It gives the compositor a consistent geometric starting point. It is not a claim that every sign has one fixed size or one mandatory historical placement.

## The two primary measurements

Each sign is measured from its actual visible ink bounds in font-em units:

- **Width**: visible-ink width relative to one em.
- **Height**: visible-ink height relative to one em.

These two dimensions are compared independently with a 0.70 em threshold. That maps directly to the four broad shapes described relative to an ideal quadrat:

| Quadrat class | Width | Height | Signs |
| --- | --- | --- | ---: |
| **Square / full** | At least 0.70 em | At least 0.70 em | 494 |
| **Tall / narrow** | Below 0.70 em | At least 0.70 em | 275 |
| **Wide / low** | At least 0.70 em | Below 0.70 em | 220 |
| **Small / compact** | Below 0.70 em | Below 0.70 em | 83 |
| **Total** | | | **1,072** |

The profile also retains two secondary diagnostics: aspect-ratio shape (`tall`, `squareish`, `wide`) and longest-ink extent (`compact`, `normal`). Those summaries are useful for inspection, but **they do not determine the four quadrat classes**. A sign is small only when both its measured width and height are below the threshold. A narrow sign that is still tall is a tall sign, not a small one.

## Canonical examples

| Gardiner sign | Unicode | Width × height (em) | Quadrat class |
| --- | --- | ---: | --- |
| G17 | 𓅓 | 1.018 × 1.019 | Square |
| M17 | 𓇋 | 0.244 × 1.001 | Tall |
| N35 | 𓈖 | 1.099 × 0.196 | Wide |
| I9 | 𓆑 | 1.405 × 0.394 | Wide |
| Q3 | 𓊪 | 0.305 × 0.369 | Small |

The regression suite also checks published exemplars: G14 and W17 (full/square), P6, R8 and S34 (tall/narrow), D21, T11 and V31 (low/broad), and Q3 and W11 (low/narrow).

## Historical basis and limits

Stéphane Polis describes four basic sign shapes relative to an ideal quadrat: tall-and-broad (roughly full quadrat), tall-and-narrow (roughly a vertical half), low-and-broad (roughly a horizontal half), and low-and-narrow (roughly a quarter). He also notes that actual sign sizes vary with the available writing space, that some tall-narrow signs can stand alone, and that the goal is balanced, legible composition. See [Polis, “The Functions and Toposyntax of Ancient Egyptian Hieroglyphs” (2018), pp. 294–295](https://doi.org/10.4000/signata.1920).

The source explicitly cautions that the typology is influenced by standardized fonts and modern typographic habits. The 0.70 em threshold is therefore an engineering boundary for this font, not an ancient fixed measurement. It must be checked against the sign's visible outline and historical examples.

James P. Allen's introduction likewise describes tall, flat and small signs, noting that tall signs often stand alone while other signs are commonly grouped; flat or small signs can also stand alone when centered. See [Allen, *Middle Egyptian*, §1.7 (Cambridge University Press)](https://assets.cambridge.org/97805215/17966/excerpt/9780521517966_excerpt.pdf).

These sources support the four broad visual classes, **not a universal permission table**. A shape label alone cannot prove that a sign must be alone, must be paired, or may only occupy one side of a group. Actual inscriptions show multiple arrangements, insertion and kerning; scribes adapt sign size and position to the surrounding signs and the writing surface.

The 203 entries marked `needs_review` lie within 0.07 em of either 0.70 em dimension boundary. They have now received a visual geometry pass; the flag remains a proximity-to-threshold indicator, not an indication that the outline is uninspected. The remaining entries are also machine-classified; absence of the flag is not Egyptological approval. See `SIGN_SHAPE_VISUAL_AUDIT.md` for the method and findings. The font's standardized outlines are a measurement source, not a substitute for period-specific epigraphic examples.

## What the classes mean for the editor

- Every sign remains eligible to appear alone. A standalone sign is centered in its available quadrat.
- The four classes describe the space a sign can approximately occupy. They do not by themselves force grouping or change spelling order.
- A small sign can potentially occupy a quarter-quadrat or accompany another sign, but it is not required to attach to a neighbor.
- A tall sign can stand alone or share a quadrat with smaller signs if the actual silhouettes and historical arrangement permit it.
- A wide sign can potentially be stacked with another wide sign or combined with smaller signs; its class alone does not guarantee that a particular combination fits.
- Any future sign-specific restriction such as “always alone” must be supported by inspected historical examples, not inferred solely from its dimensions.

## Single inventory source

- Runtime measurements: `core/mdwnfr/data/glyph_geometry.json`.
- Authoritative classifier: `core/mdwnfr/quadrat.py`, `classify_sign_bounds`.
- Reviewable export: `core/mdwnfr/data/sign_profiles.json` (not a second runtime dependency).
- Generator: `python tools/build_sign_profiles.py`.
- Consistency check: `python tools/build_sign_profiles.py --check`.
- Regression tests and canonical examples: `qa/test_sign_profiles.py`.

The four-class label is derived from the two primary measurements:

- `square` = width ≥ 0.70 em and height ≥ 0.70 em.
- `tall` = width < 0.70 em and height ≥ 0.70 em.
- `wide` = width ≥ 0.70 em and height < 0.70 em.
- `small` = width < 0.70 em and height < 0.70 em.

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

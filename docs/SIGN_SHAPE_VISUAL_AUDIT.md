# Visual audit of the 203 near-threshold glyphs

## Scope

The audit covers all 203 signs flagged by the 0.70 em quadrat boundary margin in
`core/mdwnfr/data/sign_profiles.json`. The review set contains:

| Existing quadrat class | Signs reviewed |
| --- | ---: |
| Square / full | 91 |
| Tall / narrow | 45 |
| Wide / low | 45 |
| Small / compact | 22 |
| **Total** | **203** |

The source is the installed Noto Sans Egyptian Hieroglyphs font with SHA-256:

`b792accc6207ca9caa59fc67f53926b6985a99d255dd432d7c68b68a6dfd62f8`

## Method

1. Rendered all 203 actual font outlines into class-grouped contact sheets, sorted
   by distance from the nearest width or height boundary.
2. Visually checked the silhouettes for missing, clipped, unexpectedly empty, or
   obviously inconsistent ink extents.
3. Independently recalculated each glyph's outline bounds from the source TTF
   using fontTools' `BoundsPen`, normalized by units-per-em, and compared the
   result with `glyph_geometry.json` at six decimal places.

## Findings

- **203 / 203** stored outline bounds match the independent font-outline
  calculation exactly at six decimal places.
- No missing glyph outlines, clipping, or obvious visible-ink/bounds mismatch
  was found in this visual pass.
- No manual class overrides were justified by the geometry review.
- The four existing classes and their counts remain unchanged:
  494 square, 275 tall, 220 wide, and 83 small across all 1,072 signs.

## Threshold decision

Keep **0.70 em** as the current engineering boundary. It produces a coherent
four-way geometric classification and is covered by exact-boundary regression
tests. However, the threshold is not a historically fixed Egyptian unit and
the visual audit does not establish it as a universal epigraphic rule.

The classification is sensitive near the boundary: changing it to 0.68 em
would reclassify 26 signs; changing it to 0.72 em would reclassify 46. There is
no evidence in the font outlines alone that one of those alternatives is more
historically correct. Do not tune the threshold merely to reduce the number of
borderline signs.

The `needs_review` flag remains a proximity-to-threshold indicator. It does
not mean that the glyph's outline has not been visually inspected, and it does
not mean that its historical grouping permissions have been approved.

## Limits

This is a font-geometry and rendering audit, not an Egyptological validation of
each sign's historical function, period-specific form, or permissible
composition. Those questions require identified signs and comparison with
dated inscriptional examples. The 0.70 em classes remain descriptive geometric
inputs; they must not be treated as mandatory pairing or placement rules.

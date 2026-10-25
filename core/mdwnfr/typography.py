"""Authoritative proportional ink weights for document typography.

Unicode hieroglyph outlines scale with their rendered font size already. These
rules do not resize signs, recompose quadrats or simulate arbitrary font stems.
The reference stem is an explicit *design metric*: one CSS pixel at 22 pt,
NOT an assertion that every sign in every font has an identical measured stem.
Divider strokes are precisely six times this nominal reference weight
(double the earlier three-stem design thickness).

A tiny optical compensation (0.9% of the actual displayed glyph em) is painted
outside the existing font outline by the view, with the original fill painted
on top. It is intentionally much smaller than the nominal stem and does not
alter sign positions, silhouette calculations, or quadrat measurements.
"""
from __future__ import annotations

from math import isfinite

PT_TO_MM = 25.4 / 72.0
REFERENCE_SIZE_PT = 22.0
REFERENCE_STEM_MM = 25.4 / 96.0  # one CSS px at the reference point size
REFERENCE_STEM_EM = REFERENCE_STEM_MM / (REFERENCE_SIZE_PT * PT_TO_MM)
DIVIDER_TO_STEM_RATIO = 6.0
OPTICAL_CORRECTION_EM = 0.009


def glyph_reference_stroke_mm(font_size_pt: float) -> float:
    """Nominal stroke weight for global document font size, in page millimetres."""
    size = float(font_size_pt)
    if not isfinite(size) or size <= 0:
        raise ValueError('Font size must be finite and positive')
    return size * PT_TO_MM * REFERENCE_STEM_EM


def divider_stroke_mm(font_size_pt: float) -> float:
    """Divider is six nominal glyph stems (2x previous width)."""
    return round(DIVIDER_TO_STEM_RATIO * glyph_reference_stroke_mm(font_size_pt), 5)


def optical_stroke_mm(rendered_glyph_em_mm: float) -> float:
    """Paint-only adjustment based on actual visible glyph em, not zoom."""
    size = float(rendered_glyph_em_mm)
    if not isfinite(size) or size <= 0:
        raise ValueError('Rendered glyph em must be finite and positive')
    return size * OPTICAL_CORRECTION_EM

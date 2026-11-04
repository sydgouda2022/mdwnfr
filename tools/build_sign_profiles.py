"""Classify each shipped hieroglyph by independently measured shape and size.

This is a preliminary mechanical inventory, not a historical placement rule.
The composition engine must not infer mandatory pairings from these labels.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "core/mdwnfr/data/glyph_geometry.json"
TARGET = ROOT / "core/mdwnfr/data/sign_profiles.json"
TALL_BELOW = 0.70
WIDE_ABOVE = 1.40
COMPACT_BELOW_EM = 0.70
TALL_REVIEW_MARGIN = 0.07
WIDE_REVIEW_MARGIN = 0.14
SIZE_REVIEW_MARGIN_EM = 0.07


def classify(bounds: list[float]) -> dict:
    left, bottom, right, top = bounds
    width = right - left
    height = top - bottom
    if width <= 0 or height <= 0:
        raise ValueError("Invalid hieroglyph ink outline")
    aspect = width / height
    extent = max(width, height)
    shape = "tall" if aspect < TALL_BELOW else "wide" if aspect > WIDE_ABOVE else "squareish"
    size = "compact" if extent < COMPACT_BELOW_EM else "normal"
    # Borderline cutoffs are automatically marked for visual review.
    review = (abs(aspect - TALL_BELOW) <= TALL_REVIEW_MARGIN or
              abs(aspect - WIDE_ABOVE) <= WIDE_REVIEW_MARGIN or
              abs(extent - COMPACT_BELOW_EM) <= SIZE_REVIEW_MARGIN_EM)
    return {"shape": shape, "size": size, "needs_review": review}


def inventory() -> dict:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    glyphs = source.get("glyphs")
    if source.get("format") != "mdwnfr-glyph-ink-v2" or not isinstance(glyphs, dict) or len(glyphs) != 1072:
        raise ValueError("Expected the 1,072 measured hieroglyph outlines")
    return {
        "format": "mdwnfr-sign-shape-size-v1",
        "font_sha256": source["font_sha256"],
        "rules": {
            "shape": {"tall_below_aspect": TALL_BELOW, "wide_above_aspect": WIDE_ABOVE},
            "size": {"compact_below_longest_ink_dimension_em": COMPACT_BELOW_EM},
            "review": {
                "tall_aspect_margin": TALL_REVIEW_MARGIN,
                "wide_aspect_margin": WIDE_REVIEW_MARGIN,
                "extent_em_margin": SIZE_REVIEW_MARGIN_EM
            },
        },
        "profiles": {sign: classify(bounds) for sign, bounds in sorted(glyphs.items())},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check catalogue exactly matches glyph geometry")
    args = parser.parse_args()
    expected = inventory()
    if args.check:
        actual = json.loads(TARGET.read_text(encoding="utf-8"))
        if actual != expected:
            raise SystemExit("Sign profiles are missing, stale, or inconsistent with the shipped glyph geometry")
        print("Verified", len(actual["profiles"]), "shape/size profiles")
    else:
        TARGET.write_text(json.dumps(expected, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                          encoding="utf-8")
        print("Wrote", len(expected["profiles"]), "shape/size profiles:", TARGET)


if __name__ == "__main__":
    main()

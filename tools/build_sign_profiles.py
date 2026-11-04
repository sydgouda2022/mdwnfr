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
# The compositor owns these rules; the JSON catalogue is a reviewable export.
import sys
sys.path.insert(0,str(ROOT / "core"))
from mdwnfr.quadrat import (classify_sign_bounds,
    TALL_BELOW_ASPECT, WIDE_ABOVE_ASPECT, COMPACT_BELOW_EXTENT_EM,
    QUADRAT_MIN_DIMENSION_EM, QUADRAT_REVIEW_MARGIN_EM)


def classify(bounds: list[float]) -> dict:
    return classify_sign_bounds(bounds)


def inventory() -> dict:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    glyphs = source.get("glyphs")
    if source.get("format") != "mdwnfr-glyph-ink-v2" or not isinstance(glyphs, dict) or len(glyphs) != 1072:
        raise ValueError("Expected the 1,072 measured hieroglyph outlines")
    return {
        "format": "mdwnfr-sign-shape-size-v2",
        "font_sha256": source["font_sha256"],
        "rules": {
            "shape": {"tall_below_aspect": TALL_BELOW_ASPECT, "wide_above_aspect": WIDE_ABOVE_ASPECT},
            "size": {"compact_below_longest_ink_dimension_em": COMPACT_BELOW_EXTENT_EM},
            "quadrat_class": {
                "minimum_width_em": QUADRAT_MIN_DIMENSION_EM,
                "minimum_height_em": QUADRAT_MIN_DIMENSION_EM,
                "square": "width >= threshold and height >= threshold",
                "tall": "width < threshold and height >= threshold",
                "wide": "width >= threshold and height < threshold",
                "small": "width < threshold and height < threshold",
            },
            "review": {
                "width_height_margin_em": QUADRAT_REVIEW_MARGIN_EM
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

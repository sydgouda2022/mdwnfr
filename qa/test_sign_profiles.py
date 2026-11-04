"""Preliminary glyph classification is complete, deterministic, and independent of layout."""
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "core/mdwnfr/data/sign_profiles.json"
GEOMETRY = ROOT / "core/mdwnfr/data/glyph_geometry.json"


class SignShapeSizeProfiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(CATALOGUE.read_text(encoding="utf-8"))
        cls.source = json.loads(GEOMETRY.read_text(encoding="utf-8"))

    def test_all_1072_signs_are_independently_classified(self):
        self.assertEqual(self.data["format"], "mdwnfr-sign-shape-size-v1")
        self.assertEqual(self.data["font_sha256"], self.source["font_sha256"])
        profiles = self.data["profiles"]
        self.assertEqual(len(profiles), 1072)
        self.assertEqual(set(profiles), set(self.source["glyphs"]))
        for profile in profiles.values():
            self.assertIn(profile["shape"], {"squareish", "tall", "wide"})
            self.assertIn(profile["size"], {"normal", "compact"})
            self.assertIs(type(profile["needs_review"]), bool)
            self.assertEqual(set(profile), {"shape", "size", "needs_review"})

    def test_user_examples_have_expected_shape_and_size(self):
        profiles = self.data["profiles"]
        for sign, shape, size in [
            ("𓅓", "squareish", "normal"),  # G17
            ("𓇋", "tall", "normal"),       # M17
            ("𓈖", "wide", "normal"),       # N35
            ("𓆑", "wide", "normal"),       # I9
            ("𓊪", "squareish", "compact"), # Q3
        ]:
            with self.subTest(sign=sign):
                self.assertEqual((profiles[sign]["shape"], profiles[sign]["size"]),
                                 (shape, size))

    def test_catalogue_matches_measured_outlines(self):
        check = subprocess.run(
            [sys.executable, str(ROOT / "tools/build_sign_profiles.py"), "--check"],
            cwd=ROOT, capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(check.returncode, 0, check.stderr + check.stdout)

    def test_size_is_longest_extent_not_bbox_area(self):
        profiles = self.data["profiles"]
        # A very thin, wide glyph must not be called compact just because its
        # bounding-box area is small. Compactness and aspect ratio are separate.
        self.assertEqual(profiles["𓈖"]["size"], "normal")
        self.assertEqual(profiles["𓊪"]["size"], "compact")


if __name__ == "__main__":
    unittest.main()

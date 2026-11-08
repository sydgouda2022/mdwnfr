"""Preliminary glyph classification is complete, deterministic, and independent of layout."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
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
        self.assertEqual(self.data["format"], "mdwnfr-sign-shape-size-v2")
        self.assertEqual(self.data["font_sha256"], self.source["font_sha256"])
        profiles = self.data["profiles"]
        self.assertEqual(len(profiles), 1072)
        self.assertEqual(set(profiles), set(self.source["glyphs"]))
        for profile in profiles.values():
            self.assertGreater(profile["width_em"], 0)
            self.assertGreater(profile["height_em"], 0)
            self.assertEqual(profile["width_em"], round(profile["width_em"], 6))
            self.assertEqual(profile["height_em"], round(profile["height_em"], 6))
            self.assertIn(profile["shape"], {"squareish", "tall", "wide"})
            self.assertIn(profile["size"], {"normal", "compact"})
            self.assertIn(profile["quadrat_class"], {"square", "tall", "wide", "small"})
            self.assertIs(type(profile["needs_review"]), bool)
            self.assertEqual(set(profile), {"width_em", "height_em", "shape", "size",
                                            "quadrat_class", "needs_review"})

    def test_user_examples_have_expected_shape_and_size(self):
        profiles = self.data["profiles"]
        for sign, shape, size, quadrat_class in [
            ("𓅓", "squareish", "normal", "square"),  # G17
            ("𓇋", "tall", "normal", "tall"),        # M17
            ("𓈖", "wide", "normal", "wide"),        # N35
            ("𓆑", "wide", "normal", "wide"),        # I9
            ("𓊪", "squareish", "compact", "small"), # Q3
        ]:
            with self.subTest(sign=sign):
                self.assertEqual((profiles[sign]["shape"], profiles[sign]["size"]),
                                 (shape, size))
                self.assertEqual(profiles[sign]["quadrat_class"], quadrat_class)

    def test_four_quadrat_classes_match_published_shape_examples(self):
        # The four-way typology follows Polis (2018), pp. 294–295:
        # tall/broad, tall/narrow, low/broad and low/narrow signs.
        profiles = self.data["profiles"]
        examples = [
            ("𓅐", "square"),  # G14: tall and broad / full quadrat
            ("𓏃", "square"),  # W17: tall and broad / full quadrat
            ("𓊢", "tall"),    # P6: tall and narrow
            ("𓊹", "tall"),    # R8: tall and narrow
            ("𓋹", "tall"),    # S34: tall and narrow
            ("𓂋", "wide"),    # D21: low and broad
            ("𓌕", "wide"),    # T11: low and broad
            ("𓎡", "wide"),    # V31: low and broad
            ("𓊪", "small"),   # Q3: low and narrow
            ("𓎼", "small"),   # W11: low and narrow
        ]
        for sign, expected in examples:
            with self.subTest(sign=sign):
                self.assertEqual(profiles[sign]["quadrat_class"], expected)
        counts = {}
        for profile in profiles.values():
            key = profile["quadrat_class"]
            counts[key] = counts.get(key, 0) + 1
        self.assertEqual(counts, {
            "square": 494, "tall": 275, "wide": 220, "small": 83
        })
        self.assertEqual(sum(p["needs_review"] for p in profiles.values()), 203)

    def test_classifier_uses_independent_width_and_height_thresholds(self):
        from mdwnfr.quadrat import classify_sign_bounds
        self.assertEqual(classify_sign_bounds((0, 0, .70, 1.0))["quadrat_class"], "square")
        self.assertEqual(classify_sign_bounds((0, 0, .699, 1.0))["quadrat_class"], "tall")
        self.assertEqual(classify_sign_bounds((0, 0, 1.0, .70))["quadrat_class"], "square")
        self.assertEqual(classify_sign_bounds((0, 0, 1.0, .699))["quadrat_class"], "wide")
        self.assertEqual(classify_sign_bounds((0, 0, .699, .699))["quadrat_class"], "small")
        # One small dimension does not make a tall/wide sign a small sign.
        self.assertEqual(classify_sign_bounds((0, 0, .30, 1.0))["quadrat_class"], "tall")
        self.assertEqual(classify_sign_bounds((0, 0, 1.0, .30))["quadrat_class"], "wide")
        self.assertTrue(classify_sign_bounds((0, 0, .70, 1.0))["needs_review"])

    def test_catalogue_matches_measured_outlines(self):
        check = subprocess.run(
            [sys.executable, str(ROOT / "tools/build_sign_profiles.py"), "--check"],
            cwd=ROOT, capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(check.returncode, 0, check.stderr + check.stdout)

    def test_export_exactly_matches_runtime_classification(self):
        from mdwnfr.quadrat import glyph_profiles
        self.assertEqual(glyph_profiles(), self.data["profiles"])

    def test_python_runtime_needs_only_verified_glyph_geometry(self):
        # Reproduce the user-reported mixed-release browser state: a Python
        # compositor installed by an older worker which knows nothing about
        # sign_profiles.json. A missing audit export must not break editing.
        with tempfile.TemporaryDirectory() as temp:
            package=Path(temp)/"mdwnfr"
            (package/"data").mkdir(parents=True)
            (package/"__init__.py").write_text("",encoding="utf-8")
            shutil.copyfile(ROOT/"core/mdwnfr/quadrat.py",package/"quadrat.py")
            shutil.copyfile(GEOMETRY,package/"data/glyph_geometry.json")
            self.assertFalse((package/"data/sign_profiles.json").exists())
            script=(
                "from mdwnfr.quadrat import compose,glyph_profiles;"
                "a,b,c=compose(['𓇋','𓊪','𓊪'],20).signs;"
                "assert abs(a.height-15)<1e-6;"
                "assert abs(b.height-6.5)<1e-6;"
                "assert abs(c.height-6.5)<1e-6;"
                "assert len(glyph_profiles())==1072"
            )
            environment={**os.environ,"PYTHONPATH":temp}
            check=subprocess.run([sys.executable,"-c",script],cwd=temp,
                env=environment,capture_output=True,text=True,timeout=20)
            self.assertEqual(check.returncode,0,check.stdout+check.stderr)

    def test_pwa_worker_and_offline_release_need_one_ink_source(self):
        worker=(ROOT/"web/worker.js").read_text(encoding="utf-8")
        publication=(ROOT/"tools/offline_publication.py").read_text(encoding="utf-8")
        self.assertIn("/home/pyodide/mdwnfr/data/glyph_geometry.json",worker)
        self.assertIn("core/mdwnfr/data/glyph_geometry.json",publication)
        self.assertNotIn("sign_profiles.json",worker)
        self.assertNotIn("sign_profiles.json",publication)

    def test_shape_and_longest_extent_remain_secondary_diagnostics(self):
        profiles = self.data["profiles"]
        # N35 is wide and low, but its longest dimension is normal-sized.
        # Q3 is small in both dimensions. The quadrat class uses width and
        # height independently, not the secondary aspect/extent summaries.
        self.assertEqual(profiles["𓈖"]["size"], "normal")
        self.assertEqual(profiles["𓈖"]["quadrat_class"], "wide")
        self.assertEqual(profiles["𓊪"]["size"], "compact")
        self.assertEqual(profiles["𓊪"]["quadrat_class"], "small")


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""One-way, SHA-256-checked importer of the two independent keyboard libraries.

Run locally or hourly from Actions. Does not update saved user documents,
appointments, learning, or service-worker databases. Every dependency is
pinned to an exact public Git commit and may be rolled back by reverting the
lockfile and vendor files. Network failures never replace the current catalog.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "keyboard-lock.json"
KIND = ROOT.name.lower()
AGENT = {"User-Agent": "four-stream-migration-audit"}
PREFIX = "https://raw.githubusercontent.com/{repo}/{sha}/{path}"

def digest(b):
    return hashlib.sha256(b).hexdigest()

def fetch(url):
    req = urllib.request.Request(url, headers=AGENT)
    with urllib.request.urlopen(req, timeout=90) as response:
        if response.status != 200:
            raise ValueError(f"HTTP {response.status}: {url}")
        return response.read()

def current_lock():
    j = json.loads(LOCK.read_text("utf8"))
    if j.get("format") != "keyboard-dependencies-v1":
        raise ValueError("Unsupported dependency lock schema")
    names = set(j["dependencies"])
    if names not in ({"coptic-keyboard", "hieroglyphic-keyboard"}, {"hieroglyphic-keyboard"}):
        raise ValueError("Unexpected dependency graph")
    return j

def verify():
    j = current_lock()
    for name, locked in j["dependencies"].items():
        sub = "coptic-lexicon" if name == "coptic-keyboard" else "lexicon"
        p = ROOT / "web" / sub
        manifest = (p / "manifest.json").read_bytes()
        catalog = (p / "lexicon.json").read_bytes()
        m = json.loads(manifest)
        expected = "cop" if name == "coptic-keyboard" else "egy"
        if m["language"] != expected or m["sha256"] != digest(catalog):
            raise ValueError(f"Invalid {name} release data")
        if m["bytes"] != len(catalog) or m["spelling_records"] != len(json.loads(catalog)["rows" if expected == "cop" else "entries"]):
            raise ValueError(f"Corrupted {name} counts")
        if locked["manifest_sha256"] != digest(manifest) or locked["lexicon_sha256"] != digest(catalog):
            raise ValueError(f"Untracked {name} release modification")
    if "coptic-keyboard" not in j["dependencies"]:
        if (ROOT / "core/mdwnfr/data/lexicon.json").read_bytes() != (ROOT / "web/lexicon/lexicon.json").read_bytes():
            raise ValueError("MdwNfr browser and Python catalog diverged")
    print("Keyboard dependencies match exact locked hashes.")

def stage(name, sha):
    repo = f"sydgouda2022/{name}"
    def get(path):
        return fetch(PREFIX.format(repo=repo, sha=sha, path=path))
    raw_manifest = get("release/manifest.json")
    manifest = json.loads(raw_manifest)
    language = "cop" if name == "coptic-keyboard" else "egy"
    if manifest["language"] != language:
        raise ValueError(f"Wrong keyboard language: {name}")
    catalog = get("release/lexicon.json")
    if digest(catalog) != manifest["sha256"] or len(catalog) != manifest["bytes"]:
        raise ValueError(f"Upstream {name} release SHA-256 mismatch")
    rows = json.loads(catalog)["rows" if language == "cop" else "entries"]
    minimum = 20000 if language == "cop" else 40000
    if len(rows) != manifest["spelling_records"] or len(rows) < minimum:
        raise ValueError(f"Upstream {name} release records regression")
    dest = "web/coptic-lexicon" if language == "cop" else "web/lexicon"
    files = {
        f"{dest}/lexicon.json": catalog,
        f"{dest}/manifest.json": raw_manifest,
        f"{dest}/coverage.json": get("release/coverage.json")
    }
    if language == "cop":
        files["web/coptic-install.mjs"] = get("src/coptic_install.mjs")
    else:
        files["web/lexicon-install.mjs"] = get("src/lexicon_install.mjs")
    if "coptic-keyboard" in current_lock()["dependencies"]:
        files[f"web/keyboards/{language}/keyboard_search.mjs"] = get("src/keyboard_search.mjs")
        try:
            files[f"web/keyboards/{language}/_generic_search.mjs"] = get("src/_generic_search.mjs")
        except Exception:
            # Earlier publisher versions exposed the generic kernel directly.
            # Never suppress failure for the required public module.
            pass
        if language == "egy":
            files["web/assets/dictionaries/signs.json"] = get("release/signs.json")
    else:
        if language != "egy":
            raise ValueError("Coptic is not a MdwNfr dependency")
        files["web/keyboard_catalog.js"] = get("src/keyboard_catalog.js")
        files["core/mdwnfr/data/lexicon.json"] = catalog
        files["data/lexicon.sqlite3"] = get("release/lexicon.sqlite3")
    return manifest, raw_manifest, catalog, files

def update():
    lock = current_lock()
    before = json.dumps(lock, sort_keys=True)
    staged = {}
    changed = []
    for name, entry in lock["dependencies"].items():
        repo = entry["upstream_repository"]
        if repo != f"sydgouda2022/{name}":
            raise ValueError("Untrusted upstream dependency: " + repo)
        sha = json.loads(fetch(f"https://api.github.com/repos/{repo}/commits/main"))["sha"]
        if sha == entry.get("source_commit"):
            continue
        manifest, raw_manifest, catalog, files = stage(name, sha)
        staged.update(files)
        entry.update({
            "source_commit": sha,
            "version": manifest["release"],
            "manifest_sha256": digest(raw_manifest),
            "lexicon_sha256": digest(catalog)
        })
        changed.append(name)
    if changed:
        staged["keyboard-lock.json"] = (json.dumps(lock, indent=2, ensure_ascii=False) + "\n").encode()
        # No file changes until all upstream dependencies verified and staged.
        with tempfile.TemporaryDirectory(prefix="keyboard-stage-") as tmp:
            temp = Path(tmp)
            for path, data in staged.items():
                p = temp / path
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(data)
            for path in staged:
                dest = ROOT / path
                dest.parent.mkdir(parents=True, exist_ok=True)
                os.replace(temp / path, dest)
    verify()
    print("Updated:", ", ".join(changed) if changed else "none")
    return bool(changed)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    verify() if args.verify else update()

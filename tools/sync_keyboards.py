#!/usr/bin/env python3
"""One-way, SHA-256-checked importer of the independent keyboard dependency.

Run locally or under a reviewed CI workflow. Does not update saved user
documents, learning preferences, or service-worker databases. Every dependency is
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
AGENT = {"User-Agent": "four-stream-migration-audit"}
PREFIX = "https://raw.githubusercontent.com/{repo}/{sha}/{path}"

def digest(b):
    return hashlib.sha256(b).hexdigest()

def git_blob_sha(b):
    return hashlib.sha1(b"blob "+str(len(b)).encode("ascii")+bytes([0])+b).hexdigest()

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
    if names != {"hieroglyphic-keyboard"}:
        raise ValueError("MdwNfr uses only the independent hieroglyphic keyboard API")
    return j

def verify():
    lock = current_lock()["dependencies"]["hieroglyphic-keyboard"]
    directory = ROOT / "web/lexicon"
    manifest_bytes = (directory / "manifest.json").read_bytes()
    catalog_bytes = (directory / "lexicon.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    catalog = json.loads(catalog_bytes)
    if manifest.get("language") != "egy":
        raise ValueError("Pinned keyboard is not Egyptian")
    if manifest.get("sha256") != digest(catalog_bytes):
        raise ValueError("Keyboard lexicon checksum mismatch")
    if manifest.get("bytes") != len(catalog_bytes) or (
            manifest.get("spelling_records") != len(catalog["entries"])):
        raise ValueError("Keyboard lexicon count mismatch")
    if (lock["manifest_sha256"] != digest(manifest_bytes) or
            lock["lexicon_sha256"] != digest(catalog_bytes)):
        raise ValueError("Unreviewed keyboard release modification")
    module_shas = lock.get("api_git_blobs")
    required = {"keyboard_api.mjs", "keyboard_search.mjs", "keyboard_catalog.js",
                "lexicon_install.mjs", "THIRD_PARTY_NOTICES.md"}
    if not isinstance(module_shas, dict) or set(module_shas) != required:
        raise ValueError("Incomplete pinned headless keyboard API")
    for filename, expected in module_shas.items():
        actual = git_blob_sha((ROOT / "web/vendor/hieroglyphic" / filename).read_bytes())
        if actual != expected:
            raise ValueError("Vendored API differs from locked source: " + filename)
    print("Verified pinned hieroglyphic keyboard data and headless API.")


def stage(name, sha):
    if name != "hieroglyphic-keyboard":
        raise ValueError("MdwNfr accepts no other keyboard dependencies")
    repo = "sydgouda2022/hieroglyphic-keyboard"
    def get(path):
        return fetch(PREFIX.format(repo=repo, sha=sha, path=path))
    manifest_bytes = get("release/manifest.json")
    manifest = json.loads(manifest_bytes)
    if manifest.get("language") != "egy":
        raise ValueError("Wrong keyboard language")
    catalog = get("release/lexicon.json")
    if digest(catalog) != manifest.get("sha256") or len(catalog) != manifest.get("bytes"):
        raise ValueError("Upstream keyboard release fingerprint mismatch")
    records = json.loads(catalog)["entries"]
    if len(records) != manifest.get("spelling_records") or len(records) < 40000:
        raise ValueError("Upstream spelling count regression")
    files = {
        "web/lexicon/lexicon.json": catalog,
        "web/lexicon/manifest.json": manifest_bytes,
        "web/lexicon/coverage.json": get("release/coverage.json")
    }
    for module in ("keyboard_api.mjs", "keyboard_search.mjs",
                   "keyboard_catalog.js", "lexicon_install.mjs"):
        files["web/vendor/hieroglyphic/" + module] = get("src/" + module)
    files["web/vendor/hieroglyphic/THIRD_PARTY_NOTICES.md"] = get(
        "docs/THIRD_PARTY_NOTICES.md")
    return manifest, manifest_bytes, catalog, files


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
            "lexicon_sha256": digest(catalog),
            "api_git_blobs": {path.rsplit("/",1)[-1]:git_blob_sha(payload)
                for path,payload in files.items() if path.startswith("web/vendor/hieroglyphic/")}
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
    # The app owns its document and editing state; this importer mutates only
    # files enumerated by the reviewed publisher contract and dependency lock.
    print("Updated:", ", ".join(changed) if changed else "none")
    return bool(changed)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    verify() if args.verify else update()

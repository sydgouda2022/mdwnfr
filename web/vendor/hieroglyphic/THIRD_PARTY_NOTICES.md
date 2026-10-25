# Third-party data and provenance notices

This repository contains a derived Late Egyptian spelling index. The index is
**incomplete** and must not be described as a complete historical dictionary.
This file is bundled with the API export to preserve source acknowledgements.

| Data lineage | Role | Stated source license |
| --- | --- | --- |
| Thesaurus Linguae Aegyptiae, Late Egyptian v19 | Hieroglyphic spelling tokens and associated lemma IDs | CC BY-SA 4.0 |
| Ancient Egyptian Dictionary (AED), TEI extract | Lexical metadata crosswalk | CC BY-SA 4.0 |
| Ancient Egyptian Sentences (AES), document-whitelisted edition | Approved manuscript spellings and lemma IDs | CC BY-SA 4.0 |
| MaReTE Ramses 2023 training word model | Additional **unlinked model sign forms** | CC BY 4.0 |

The individual upstream references, source revisions, file fingerprints and
approval boundaries are recorded in
`sources/late_egyptian_registry.json` and `docs/UPSTREAM_SOURCE.md`.

This derived collection preserves model-vs-text provenance. A model word form
is *not* automatically evidence of an individually attested text occurrence,
a resolved lemma identity, or a specific manuscript witness.

Redistributors must review the full terms, required credit, attribution,
indication-of-changes and share-alike obligations of each upstream dataset.
These notices do not constitute a legal conclusion that every intended
redistribution is permitted. The repository package remains private/unpublished
pending that review.

There is no bundled font, visual asset, or PWA in the headless API export.
An application displaying Egyptian Unicode must choose and license its own font.

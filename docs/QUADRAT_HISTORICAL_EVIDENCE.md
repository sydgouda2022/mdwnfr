# Quadrat composition: historical evidence and implementation boundary

## Scope

MdwNfr's first automatic compositor covers simple tabulation and one explicitly selected stacking operation. It does not attempt to reproduce the full range of Egyptian scribal composition. A geometry class is descriptive; it is not a historical instruction to group a sign in a particular way.

## Evidence

### 1. Four basic sign shapes

Polis describes four basic shapes relative to a virtual square (quadrat): tall-and-broad/full, tall-and-narrow, low-and-broad, and low-and-narrow. The categories are useful for describing the available space, but real inscriptions vary sign size to fit the line. He explicitly notes that V28 (the twisted wick) can stand alone in a column.

Reference: Stéphane Polis, “The Functions and Toposyntax of Ancient Egyptian Hieroglyphs,” Signata 9 (2018), pp. 294–295. DOI: https://doi.org/10.4000/signata.1920. Open PDF: https://files01.core.ac.uk/download/pdf/213636039.pdf.

### 2. Simple tabulation

Polis describes horizontal and vertical tabulation as the most common way of grouping signs across periods and corpora. Tabulation is used to organize signs of different shapes in the available writing space. The examples from the Ramesses II temple at Abydos include 16 groups with 14 distinct tabular organizations. This is direct evidence that the possible arrangements are varied; it is not evidence for a single universal rule such as “every wide sign must take two small companions.”

The reference also states that quadrats are not mandatory: a sign that already fills the available line or column can stand alone.

Reference: Polis 2018, pp. 296–297 and 315–318, especially Figs. 2–3 and 15–19.

### 3. Stacking is not ordinary tabulation

Polis distinguishes stacking from tabulation. Stacking means superimposing one sign or group over another. It is attested from the Third Dynasty, becomes frequent from the Middle Kingdom, and is commonly used to combine tall-narrow and low-broad signs without scaling them down. The tall/broad order can alternate and is not linguistically meaningful. Most examples are centered, but low and high transverse patterns also occur; their placement can be motivated by avoiding interference between meaningful iconic details.

Concrete examples include the Red Chapel of Hatshepsut at Karnak (KIU 1409, line 1) and the Annals of Thutmose III at Karnak (KIU 3475, line 18; KIU 3479, line 9).

Reference: Polis 2018, pp. 322–323, Figs. 27–28.

### 4. Operations deliberately outside the first automatic scope

Polis separately discusses insertion, connecting, combining, and kerning. These operations can interact with tabulation and stacking, but they require different geometric and sometimes iconographic constraints. They must not be silently approximated by the simple tabulation templates.

Reference: Polis 2018, pp. 315–326, §§3.1–3.5.

## Current implementation boundary

The current core/mdwnfr/quadrat.py compositor supports:

- standalone signs;
- eligible two-sign horizontal rows;
- vertical tabulation of two signs whose classes are each wide/low or small/compact (including mixed pairs);
- 2×2 tabulation of three or four compact signs;
- a tall host with two small or wide companions;
- no glyph superimposition: every neighboring silhouette retains the shared 10%-of-column gap.

Historical superimposition examples remain part of the evidence corpus, but the editor does not generate overlapping glyphs. The ordinary tabulation patterns remain candidates selected by the deterministic compositor, not mandatory assignments based solely on a sign's class.

## Gaps and evidence required before adding a pattern

- A wide/low host with one or two compact companions is not currently represented by a dedicated automatic template. The source establishes varied tabulation, but the textual description alone does not establish the exact geometry, reading order, and placement for every proposed host/companion combination. Add a specific template only after inspecting and recording the relevant figure or a primary inscription.
- “Tall or wide sign forced to remain alone” is not a general class rule. Every sign already has a standalone candidate. A persistent per-sign or per-word restriction would be a separate authoring feature and needs an explicit product decision plus evidence for each restriction.
- Historical superimposition must remain distinguishable from tabulation in the research corpus. It is outside the editor's generated-output model because generated glyphs must retain a nonzero silhouette gap.

## Acceptance rule

Every new automatic pattern must have (1) a cited historical example, (2) an explicit reading-order rule, (3) measured two-dimensional geometry and silhouette clearance, (4) deterministic candidate scoring, and (5) fixtures covering RTL and LTR without changing symbol identity or natural aspect ratio.
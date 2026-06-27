# Experiment Log

Project-wide experiment ledger. Each experiment should end with facts, hypotheses, tested files/counts, confidence, and follow-up.

Source migrated from `v0.3.5/docs/research/EXPERIMENT_LOG.md`.

---

## EXP-001: Face Marker Detection

**Status**: Observation

**Goal**: Locate candidate face blocks in DisplayLists.

**Method**: Scan for `[12, 0, 0, 0, 100, 0, 0, 0]`, then validate nearby `edgeCount` and `vertexCount`.

**Evidence / facts**:

- 156 candidate markers were found in BOTTOM DisplayLists.
- 39 faces parsed after validation.
- The marker corresponds to the gap marker, not the actual face start.
- Face start is before the marker at the `edgeCount` field.

**Files tested**: `USB hub case BOTTOM.SLDPRT`

**Faces/models tested**: 1 model, 39 validated faces.

**Confidence**: High that the scanner can locate faces; low on false-positive causes.

**Date last updated**: 2026-06-27

---

## EXP-002: Block 1/2 Structure Discovery

**Status**: Verified Conclusion for headers; Hypothesis for Block 1 semantics.

**Goal**: Understand topology-like blocks after vertex and normal arrays.

**Method**: Parse `[4, 8, 2, N]` headers and compare body lengths.

**Evidence / facts**:

- Block 1 header is `[4, 8, 2, N]`.
- Block 2 header is `[4, 8, 2, M]`.
- Block 2 entries decode to loop vertex counts with `(raw + 2) / 2`.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High for headers and Block 2 count behavior; medium-low for Block 1 interpretation.

**Date last updated**: 2026-06-27

---

## EXP-003: Gap-Based Loop Splitting

**Status**: Failed Experiment / Disproving Evidence

**Goal**: Determine whether loop boundaries can be recovered from normal discontinuities.

**Method**: Compare adjacent vertex normals and split when deviation exceeds threshold.

**Evidence / facts**:

- Detected breaks appeared on strip diagonals rather than true loop boundaries.
- Normal data is not a reliable loop-boundary source.

**Disproved hypotheses**: FH-005

**Files tested**: v0.3.0-v0.3.3 modern test corpus.

**Faces/models tested**: Multiple faces; exact count not preserved in migration.

**Confidence**: High that this method is invalid.

**Date last updated**: 2026-06-27

---

## EXP-004: Block 2 Slicing Mask Formula

**Status**: Verified Conclusion

**Goal**: Decode Block 2 loop-size entries.

**Method**: Decode each raw value with `(raw + 2) / 2` and check whether the decoded sum equals face `vertexCount`.

**Evidence / facts**:

- Formula holds for all tested faces.
- Decoded loop sizes sum exactly to each face's vertex count.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: BOTTOM 39/39, TOP 68/68, GEAR 113/113, DEKOR 375/375. Total 595/595.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## EXP-005: Gap Marker Identification

**Status**: Verified Conclusion

**Goal**: Identify the 16-byte gap between position and normal arrays.

**Method**: Forensic byte-offset dump of selected simple and complex face blocks.

**Evidence / facts**:

- Gap marker is `[12, 100, 2, vertexCount]`.
- Face block starts with `[edgeCount, 100, 2, vertexCount]`.
- Earlier face scanner finds the gap marker, then works backward to face start.

**Disproved hypotheses**: FH-003, FH-006

**Files tested**: GEAR selected faces, with aggregate support from BOTTOM/TOP/DEKOR.

**Faces/models tested**: Selected forensic faces plus 595 aggregate parsed faces.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## EXP-006: Block 1 Grammar Discovery

**Status**: Correlation

**Goal**: Discover Block 1 grammar without assigning semantics.

**Method**: Classify Block 1 u32 values as ZERO, ONE, SMALL, LARGE. Analyze starts, run lengths, bigrams, and trigrams.

**Evidence / facts**:

- 595/595 faces start with ONE.
- ONE count equals Block 2 entry count in 595/595 faces.
- ONE values are singleton runs.
- Dominant bigrams are `LARGE -> ZERO` and `ZERO -> LARGE`.
- Dominant trigram is generally `ZERO -> LARGE -> ZERO`.
- The branch notebook records a single-loop pattern `ONE [ZERO LARGE]*` and variable multi-loop patterns.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High for grammar observations; low for semantic interpretation.

**Date last updated**: 2026-06-27

---

## EXP-007: Loop Correspondence Verification

**Status**: Verified Conclusion for count equality; Correlation for segment meaning.

**Goal**: Test whether Block 1 ONE count equals Block 2 loop count.

**Method**: Count `1` values in Block 1 and compare to Block 2 body length.

**Evidence / facts**:

- BOTTOM: 39/39 faces match.
- TOP: 68/68 faces match.
- GEAR: 113/113 faces match.
- DEKOR: 375/375 faces match.
- Total: 595/595 faces match.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: Very high for count equality.

**Date last updated**: 2026-06-27

---

## EXP-008: DisplayLists Stream Audit

**Status**: Observation

**Goal**: Map internal structure of main DisplayLists streams.

**Method**: Analyze decompressed streams for markers, topology headers, strings, entropy, and `[1,1]` structures.

**Evidence / facts**:

- BOTTOM DisplayLists size: 98481 bytes.
- BOTTOM had 156 candidate face markers and 39 parsed faces.
- BOTTOM had 63 topology headers and 11 `[1,1]` section-like headers.
- GEAR section audit recorded 59 `[1,1]` section-like structures and 113 parsed faces.
- Embedded strings included class-name-like values such as `uiUserModelEnv_c`, `moAmbientLight_c`, and `uoBodyPropInfo_c`.

**Files tested**: BOTTOM, with supporting GEAR section audit.

**Faces/models tested**: BOTTOM 39 parsed faces; GEAR 113 parsed faces for section counts.

**Confidence**: High that DisplayLists contains more than face blocks; low for section semantics.

**Date last updated**: 2026-06-27

---

## EXP-009: Observed Block 1 Section Length Forms

**Status**: Observation

**Goal**: Record today's measured Block 1 section-form observation without assigning semantics.

**Method**: Reported measurement over the current measured corpus compared Block 1 section length against decoded loop size.

**Evidence / facts**:

- The observed section length relation is `len = 2 * loopSize - 2`.
- The class `VALUE` is observational only: any Block 1 integer other than `0` or `1`.
- The observation does not distinguish whether Block 1 is best modeled as grammar or as opcode/operand bytecode.

**Files tested**: Today's measured corpus; exact file list not yet archived.

**Faces/models tested**: Today's measured corpus; exact face/model count not yet archived.

**Confidence**: High for the reported measured corpus, pending raw evidence archival.

**Date last updated**: 2026-06-27

---

## EXP-010: Property-Table Hypothesis Falsification

**Status**: Failed Experiment / Disproving Evidence

**Goal**: Test whether Block 1 `VALUE` tokens encode or index a property table.

**Method**: Today's report cites random-base controls, frequency-bias analysis, and delimiter-artifact analysis.

**Evidence / facts**:

- Random-base controls did not support the property-table model.
- Frequency bias was observed in the candidate VALUE distribution.
- The apparent property-table signal was attributed to a delimiter artifact.
- VALUE semantics remain UNKNOWN.

**Disproved hypotheses**: FH-013

**Files tested**: Today's measured corpus; exact file list not yet archived.

**Faces/models tested**: Today's measured corpus; exact face/model count not yet archived.

**Confidence**: High for rejecting the property-table hypothesis, pending raw evidence archival.

**Date last updated**: 2026-06-27

---

## EXP-011: Block 1 Invariant Validation (v0.4.0)

**Status**: Verified Structural Invariant for I1/I2/I3; Observation for corpus statistics

**Goal**: Validate three Block 1 structural invariants across the full corpus and collect corpus-wide statistics.

**Method**: Parse 4 modern openswx-like files with `v0.4.0/block1_parser.js`; build per-face AST; validate I1 (`b1len = 2 × (vertexCount − sectionCount)`), I2 (`sectionBodyTokenCount = Block2[i] − 1`), I3 (`Σ Block2[i] = b1len`); collect section length distribution, ZERO run lengths, positional frequency, VALUE repetition counts.

**Evidence / facts**:

- I1 passes: 593/593 (100%)
- I2 passes: 593/593 (100%)
- I3 passes: 593/593 (100%)
- 3429 ONE-delimited sections across the corpus
- 53 distinct section lengths observed (odd numbers: 3, 5, 7, ..., 215)
- Section length alone does not uniquely determine token-class sequence: only 16/53 lengths (30.2%) have a single unique class pattern
- Most common section lengths: 3 (882/3429), 7 (825/3429), 11 (497/3429)
- VALUE tokens repeat in 1937/3429 sections (56.5%)
- Total VALUE tokens: 16174; distinct: 6082; repeat occurrences: 2636
- ZERO run lengths: heavily skewed to length 1 (11020/14536 runs); runs up to 95 observed

**Disproved hypotheses**: None directly; FH-011 and FH-013 remain falsified and are consistent with invariant data.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 593 of 595 corpus faces across 4 models. BOTTOM: 39/39, TOP: 68/68, GEAR: 113/113, DEKOR: 373/375. The 2 DEKOR faces that failed v0.4.0 parser validation are under investigation.

**Confidence**: High for invariants (I1/I2/I3); low for interpretation of corpus statistics.

**Date last updated**: 2026-06-27

**Raw evidence**: `knowledge/evidence/2026-06-27_v0.4.0-invariant-validation.md`, `knowledge/evidence/2026-06-27_v0.4.0-corpus-analysis.txt`

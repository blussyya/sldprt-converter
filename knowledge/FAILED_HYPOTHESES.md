# Failed Hypotheses

Project-wide list of hypotheses that have been falsified or made unusable by later experiments.

Source migrated from `v0.3.5/docs/research/FAILED_HYPOTHESES.md`.

---

## FH-001: Block 1 Is Only A Rendering Cache

**Status**: Disproven Hypothesis

**Original hypothesis**: Block 1 contains lossy or incidental rendering-cache data, not required grammar/topology data.

**Evidence against**: Block 1 has deterministic structure, starts with ONE for every tested face, and its ONE count equals Block 2 entry count for 595/595 faces.

**Disproving experiment**: EXP-006, EXP-007

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## FH-002: Holes Are Stored As Separate Faces

**Status**: Disproven Hypothesis

**Original hypothesis**: Faces with holes are stored as multiple face blocks.

**Evidence against**: Multi-loop faces are represented inside single face blocks. Block 2 decodes multiple loop sizes whose sum equals the single face `vertexCount`.

**Disproving experiment**: EXP-004

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## FH-003: The Gap Marker Contains Loop Boundaries

**Status**: Disproven Hypothesis

**Original hypothesis**: The 16-byte gap between positions and normals contains loop-boundary data.

**Evidence against**: The gap marker is fixed as `[12, 100, 2, vertexCount]` and repeats as a structural separator.

**Disproving experiment**: EXP-005

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 aggregate faces, with forensic dumps on selected GEAR faces.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## FH-004: All Block 1 Non-Zero Values Are Global Vertex Indices

**Status**: Disproven Hypothesis

**Original hypothesis**: Every non-zero Block 1 value is a global vertex index.

**Evidence against**: Complex faces include many values in local ranges while simple faces include values that look global. The branch notebook records a complex face with `vc=1324` where 2324/2404 Block 1 values were in the local range `0..1323`, while a simple `vc=4` face had 4/6 values in a global-looking range `1559..1588`. Current evidence does not support one uniform global-index rule.

**Disproving experiment**: Block 1 range comparison recorded in branch notebook.

**Files tested**: GEAR and other modern corpus files.

**Faces/models tested**: Multiple simple and complex faces; exact count not preserved in project-wide migration.

**Confidence**: Medium-high

**Date last updated**: 2026-06-27

---

## FH-005: Normal-Gap Loop Splitting Works

**Status**: Disproven Hypothesis

**Original hypothesis**: Loop boundaries can be recovered by detecting normal-vector discontinuities.

**Evidence against**: Gap detection fired on strip diagonals rather than true loop boundaries. Block 2 provides the reliable loop-size decomposition.

**Disproving experiment**: EXP-003

**Files tested**: Current modern corpus during v0.3.0-v0.3.3 experiments.

**Faces/models tested**: Multiple faces; exact count not preserved in project-wide migration.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## FH-006: Face Blocks Start With `[12, 100, 2, vertexCount]`

**Status**: Disproven Hypothesis

**Original hypothesis**: `[12, 100, 2, vertexCount]` is the face-start marker.

**Evidence against**: Forensic layout shows face blocks start with `[edgeCount, 100, 2, vertexCount]`. `[12, 100, 2, vertexCount]` is the gap marker between positions and normals.

**Disproving experiment**: EXP-001, EXP-005

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 aggregate faces, with forensic dumps on selected GEAR faces.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## FH-007: Block 1 `N / vertexCount` Is Constant

**Status**: Disproven Hypothesis

**Original hypothesis**: The Block 1 body length has a constant ratio to face vertex count.

**Evidence against**: The ratio varies by face and appears affected by loop complexity. The branch notebook records BOTTOM ratios ranging from about 1.500 for `vc=4` faces to about 1.960 for `vc=50` faces, with GEAR also varying.

**Disproving experiment**: Aggregate Block 1 ratio analysis in branch notebook.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## FH-008: Block 1 Encodes Normals

**Status**: Disproven Hypothesis

**Original hypothesis**: Block 1 contains per-vertex normal vectors.

**Evidence against**: Normals are stored separately as float32 vectors after the gap marker. Block 1 values are u32 integers dominated by ZERO/ONE/LARGE grammar patterns.

**Disproving experiment**: EXP-002, EXP-005, EXP-006

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## FH-009: Block 1 Encodes UV Coordinates

**Status**: Disproven Hypothesis

**Original hypothesis**: Block 1 contains texture coordinate data.

**Evidence against**: UV coordinates would normally be float-like values; Block 1 is u32 token data with strong ONE/ZERO/LARGE grammar.

**Disproving experiment**: EXP-006

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## FH-010: Block 1 Has Fixed-Size Records

**Status**: Disproven Hypothesis

**Original hypothesis**: Block 1 is made of fixed-width records.

**Evidence against**: Block 1 body length and apparent ONE-delimited section size vary across faces and loop counts.

**Disproving experiment**: EXP-006

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## FH-011: Block 2 Raw Values Are Vertex Indices

**Status**: Disproven Hypothesis

**Original hypothesis**: Block 2 body values are vertex indices.

**Evidence against**: Block 2 raw values decode through `(raw + 2) / 2` to loop vertex counts, and decoded counts sum to face `vertexCount`.

**Disproving experiment**: EXP-004

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595/595 faces across 4 models.

**Confidence**: High

**Cross-reference**: INV-017 (Verified Structural Invariant) further confirms that Block 2 values encode per-loop size data via the decoding formula `(raw + 2) / 2`, consistent with the falsification of vertex-index interpretation.

**Date last updated**: 2026-06-27

---

## FH-012: DisplayLists Contains Only Face Data

**Status**: Disproven Hypothesis

**Original hypothesis**: The main DisplayLists stream is only serialized face geometry.

**Evidence against**: DisplayLists includes section-like `[1,1]` structures, strings/class names, metadata regions, and candidate markers that do not validate as faces.

**Disproving experiment**: EXP-008

**Files tested**: BOTTOM, GEAR, plus supporting stream inventory from TOP and DEKOR.

**Faces/models tested**: BOTTOM 39 faces, GEAR 113 faces in section audit.

**Confidence**: High

**Date last updated**: 2026-06-27

---

## FH-013: VALUE Tokens Encode A Property Table

**Status**: Disproven Hypothesis

**Original hypothesis**: Block 1 `VALUE` tokens encode or index a property table.

**Evidence against**: Today's falsification report records three controls against the property-table model:

- Random-base controls did not support the property-table interpretation.
- Frequency bias was observed in the candidate VALUE distribution.
- The apparent structure was attributable to a delimiter artifact rather than stable VALUE semantics.

These observations return VALUE semantics to UNKNOWN. `VALUE` remains only an observational class for non-zero/non-one integers.

**Disproving experiment**: EXP-010

**Files tested**: Today's measured corpus; exact file list not yet archived in project-wide evidence.

**Faces/models tested**: Today's measured corpus; exact face/model count not yet archived in project-wide evidence.

**Confidence**: High for rejecting the reported property-table hypothesis, pending raw evidence archival.

**Date last updated**: 2026-06-27

**Cross-reference**: EXP-011 records that section length alone does not uniquely determine token-class sequence across 3429 sections. This corpus statistic is consistent with — but does not prove — the falsification of uniform VALUE semantics.

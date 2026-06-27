# Known Invariants

Project-wide SLDPRT reverse-engineering knowledge. These entries are version-independent unless the files tested say otherwise.

Source migrated from `v0.3.5/docs/research/KNOWN_INVARIANTS.md` and related experiment notes.

**Corpus note (2026-06-27)**: The documented corpus count is 595 faces across 4 models. The v0.4.0 parser validates 593 of 595 faces (DEKOR 373/375). The 2-face discrepancy is under investigation. See EXP-011 and `knowledge/evidence/2026-06-27_v0.4.0-invariant-validation.md`.

---

## INV-001: Modern Geometry Is In `Contents/DisplayLists`

**Status**: Verified Conclusion

**Evidence**: Modern test files expose readable face geometry in the main `Contents/DisplayLists` stream. Other readable streams examined contain metadata, configuration, feature, preview, or third-party data. `Contents/Config-0-Partition` remains unreadable/high entropy in current tooling.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 4 models, 595 parsed faces for DisplayLists face layout checks.

**Confidence**: High

**Date last updated**: 2026-06-27

**Related experiments**: EXP-008

---

## INV-002: Face Block Layout

**Status**: Verified Conclusion

**Evidence**: Parsed face blocks follow this layout:

```text
+0000  u32 edgeCount
+0004  u32 100
+0008  u32 2
+000c  u32 vertexCount
+0010  float32[vertexCount * 3] positions
+....  u32[4] gap marker: [12, 100, 2, vertexCount]
+....  float32[vertexCount * 3] normals
+....  Block 1 header/body
+....  Block 2 header/body
```

Forensic byte-offset dumps of simple and complex gear faces support the layout, and aggregate parsers validate it across the current corpus.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

**Related experiments**: EXP-002, EXP-005

---

## INV-003: Position Records And Normal Records Are Distinct

**Status**: Verified Conclusion

**Evidence**: R0 records contain position floats. R1 records contain unit-length vectors constrained to `[-1, 1]`. Tests found 0% direct float equality between R0 and R1 and 100% unit-vector behavior for R1.

**Files tested**: Current modern corpus represented by BOTTOM, TOP, GEAR, and DEKOR analysis.

**Faces/models tested**: Hundreds of faces; exact face count recorded in branch notebook as part of the 595-face corpus.

**Confidence**: High

**Date last updated**: 2026-06-27

**Related experiments**: Branch-local R0/R1 comparison report; project-wide raw evidence still needs preservation.

---

## INV-004: Gap Marker Between Positions And Normals

**Status**: Verified Conclusion

**Evidence**: The 16-byte separator between position data and normal data is always:

```text
u32[4] = [12, 100, 2, vertexCount]
```

This marker is also the byte pattern used by earlier scanners to locate candidate face blocks.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 595 faces across 4 models, with forensic byte dumps on selected gear faces.

**Confidence**: High

**Date last updated**: 2026-06-27

**Related experiments**: EXP-001, EXP-005

---

## INV-005: Block 1 Header Shape

**Status**: Verified Conclusion

**Evidence**: Block 1 starts with:

```text
u32[0] = 4
u32[1] = 8
u32[2] = 2
u32[3] = N
```

`N` is the number of `u32` values in the Block 1 body. Total Block 1 byte size is `(N + 4) * 4`.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

**Related experiments**: EXP-002

---

## INV-006: Block 2 Header Shape

**Status**: Verified Conclusion

**Evidence**: Block 2 starts with:

```text
u32[0] = 4
u32[1] = 8
u32[2] = 2
u32[3] = M
```

`M` is the number of `u32` values in the Block 2 body. Total Block 2 byte size is `(M + 4) * 4`.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

**Related experiments**: EXP-002

---

## INV-007: Block 2 Encodes Loop Vertex Counts

**Status**: Verified Conclusion

**Evidence**: For every Block 2 body entry:

```text
vertexCountPerLoop = (raw + 2) / 2
```

The decoded loop vertex counts sum exactly to the face `vertexCount`.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: BOTTOM 39/39 faces, TOP 68/68, GEAR 113/113, DEKOR 375/375. Total 595/595.

**Confidence**: High

**Date last updated**: 2026-06-27

**Related experiments**: EXP-002, EXP-004

---

## INV-008: Block 1 Starts With ONE

**Status**: Verified Conclusion

**Evidence**: Position 0 of every Block 1 body is value `1`.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 595/595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

**Related experiments**: EXP-006, EXP-007

---

## INV-009: Block 1 ONE Count Equals Block 2 Entry Count

**Status**: Verified Conclusion

**Evidence**: Count of value `1` in Block 1 body equals Block 2 body entry count for every tested face.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: BOTTOM 39/39, TOP 68/68, GEAR 113/113, DEKOR 375/375. Total 595/595.

**Confidence**: High

**Date last updated**: 2026-06-27

**Related experiments**: EXP-006, EXP-007

---

## INV-010: Block 1 ONE Values Are Singleton Runs

**Status**: Verified Conclusion

**Evidence**: Run-length analysis found no consecutive `1` values in Block 1 bodies. Every ONE run has length exactly 1.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High

**Date last updated**: 2026-06-27

**Related experiments**: EXP-006

---

## INV-011: Block 1 Token Classes

**Status**: Observation

**Evidence**: Current classification divides Block 1 body values into:

```text
ZERO  = value 0
ONE   = value 1
VALUE = any integer other than 0 or 1
```

`VALUE` is an observational class only. It means "non-zero/non-one integer" and does not imply edge IDs, vertex IDs, entity IDs, references, operands, or any other semantic role.

VALUE semantics are currently UNKNOWN. The property-table hypothesis was falsified and archived as FH-013.

Earlier notes also used magnitude subclasses:

```text
SMALL = values 2..255
LARGE = values >255
```

Those subclasses are retained only as descriptive range bins for old reports and should not be treated as semantic categories.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High as a classification, low for semantics.

**Date last updated**: 2026-06-27

**Related experiments**: EXP-006

---

## INV-012: Observed Section Forms

**Status**: Observation

**Evidence**: Earlier measurements found that Block 1 section length follows:

```text
len = 2 * loopSize - 2
```

across the measured corpus. This records the first-time observation prior to formula verification.

This observation has since been verified as INV-017 (Verified Structural Invariant) across 593/593 faces in EXP-011. INV-012 remains as the historical observation record.

**Files tested**: v0.4.0 corpus: BOTTOM, TOP, GEAR, DEKOR. (593 of 595 faces validated.)

**Faces/models tested**: 593/595 faces across 4 models. 2-face discrepancy under investigation.

**Confidence**: High — verified by INV-017.

**Date last updated**: 2026-06-27

**Related experiments**: EXP-009, EXP-011; formal verification in INV-017

---

## INV-013: Dominant Block 1 Local Patterns

**Status**: Correlation

**Evidence**: The most frequent Block 1 bigrams are `LARGE -> ZERO` and `ZERO -> LARGE`. The most frequent trigram is generally `ZERO -> LARGE -> ZERO`, with TOP affected by high zero-fill in single-loop faces.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High for pattern frequency, low for interpretation.

**Date last updated**: 2026-06-27

**Related experiments**: EXP-006

---

## INV-014: DisplayLists Has Section-Like `[1, 1]` Structures

**Status**: Observation

**Evidence**: The main DisplayLists stream contains repeated structures beginning with `u32[2] = [1, 1]`. BOTTOM had 11 such sections and 39 parsed faces. GEAR had 59 such sections and 113 parsed faces.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `Helical Bevel Gear.SLDPRT`

**Faces/models tested**: 2 models, 152 parsed faces in this section audit.

**Confidence**: High that the pattern exists, low for section semantics.

**Date last updated**: 2026-06-27

**Related experiments**: EXP-008

---

## INV-015: LWDATA Is Metadata In Current Corpus

**Status**: Observation

**Evidence**: `Contents/Config-0-LWDATA` contains no detected face markers, no topology headers, and no `[1,1]` section headers in current analysis. It contains class-name-like strings such as `gcXhatch_c` and `moLWPlaneNodeData_c`.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 4 models; stream-level analysis, not face-level.

**Confidence**: High for tested streams, medium for generalization.

**Date last updated**: 2026-06-27

**Related experiments**: EXP-008

---

## INV-016: Block 1 Body Length

**Status**: Verified Structural Invariant

**Evidence**: Block 1 body length (in u32s) follows:

```text
b1len = 2 * (vertexCount - sectionCount)
```

where `sectionCount` is the number of ONE-delimited sections in the Block 1 body.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 593/595 faces across 4 models (2-face discrepancy under investigation).

**Confidence**: High — 593/593 validated faces pass (100%).

**Date last updated**: 2026-06-27

**Related experiments**: EXP-011

---

## INV-017: ONE-Delimited Section Length

**Status**: Verified Structural Invariant

**Evidence**: For every ONE-delimited section in Block 1, the number of body tokens equals the decoded loop entry minus 1:

```text
sectionBodyTokenCount = Block2[i] - 1
```

This formula is equivalent to the earlier observed relation `len = 2 * loopSize - 2` (INV-012). Each section body length corresponds to a single Block 2 loop entry.

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 593/595 faces across 4 models (2-face discrepancy under investigation).

**Confidence**: High — 593/593 validated faces pass (100%).

**Date last updated**: 2026-06-27

**Related experiments**: EXP-011

---

## INV-018: Block 2 Sum

**Status**: Verified Structural Invariant

**Evidence**: The sum of all Block 2 body values equals the Block 1 body length:

```text
sum(Block2[i]) = b1len
```

**Files tested**: `USB hub case BOTTOM.SLDPRT`, `USB hub case TOP.SLDPRT`, `Helical Bevel Gear.SLDPRT`, `Dekor.SLDPRT`

**Faces/models tested**: 593/595 faces across 4 models (2-face discrepancy under investigation).

**Confidence**: High — 593/593 validated faces pass (100%).

**Date last updated**: 2026-06-27

**Related experiments**: EXP-011

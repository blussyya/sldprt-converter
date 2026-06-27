# Assumptions

These are working assumptions only. They must be moved to `FAILED_HYPOTHESES.md` if falsified, or promoted into `KNOWN_INVARIANTS.md` only after evidence meets the project standard.

---

## ASM-001: Project Scope Is Read-Only Parsing First

**Status**: Assumption / Project Rule

**Evidence**: User-stated project philosophy: parser first, converter second, never guess semantics.

**Files tested**: Not applicable.

**Faces/models tested**: Not applicable.

**Confidence**: High as a project-management rule.

**Date last updated**: 2026-06-27

---

## ASM-002: Syntax Should Be Recovered Before Semantics

**Status**: Assumption / Research Rule

**Evidence**: Current work has found reliable grammar/count invariants before reliable meanings for Block 1 values.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High as a research strategy.

**Date last updated**: 2026-06-27

---

## ASM-003: Block 1 ONE-Delimited Sections Correspond To Block 2 Loop Entries

**Status**: Hypothesis

**Evidence**: ONE count equals Block 2 entry count for 595/595 faces (EXP-007). Additionally, INV-017 (Verified Structural Invariant) demonstrates that each section body length equals `Block2[i] − 1` across 593/593 validated faces. The structural pairing is verified; semantic correspondence remains unproven.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models (593 validated by v0.4.0 parser; 2-face discrepancy under investigation).

**Confidence**: High for structural pairing (count + length equality), medium-low for semantic correspondence.

**Date last updated**: 2026-06-27

---

## ASM-004: LARGE Values Are References Into Some Table Or Index Space

**Status**: Retired Hypothesis

**Evidence**: This assumption is no longer active. VALUE semantics have returned to UNKNOWN after FH-013 falsified the property-table hypothesis. Earlier range observations remain historical observations only, not semantic evidence.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces for grammar; selected simple/complex faces for range checks; today's measured corpus for FH-013, exact count not yet archived.

**Confidence**: High that this assumption should not guide current interpretation.

**Date last updated**: 2026-06-27

**Related falsification**: FH-013, EXP-010

---

## ASM-005: DisplayLists `[1,1]` Markers Delimit Higher-Level Sections

**Status**: Hypothesis

**Evidence**: Repeated `[1,1]` structures exist and appear to partition DisplayLists. Their exact role is unknown.

**Files tested**: BOTTOM, GEAR

**Faces/models tested**: 2 models, 152 parsed faces in section audit.

**Confidence**: Medium for delimiter behavior, low for semantics.

**Date last updated**: 2026-06-27

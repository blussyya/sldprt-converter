# Open Questions

Project-wide unresolved questions. Do not promote any item here into a fact without a falsifiable experiment and evidence update.

Source migrated from `v0.3.5/docs/research/OPEN_QUESTIONS.md`.

---

## OQ-001: What Grammar Does Block 1 Follow?

**Status**: Hypothesis Space

**Evidence so far**: Block 1 starts with ONE, ONE count equals Block 2 entry count, ONE values are singleton, and ZERO/LARGE alternation is common. Additionally, three structural invariants have been verified (INV-016/017/018): Block 1 body length relates to vertex count and section count; each ONE-delimited section body length equals `Block2[i] − 1`; and Block 2 values sum to Block 1 body length. However, section length alone does not uniquely determine token-class sequence (only 30.2% of lengths have a single unique pattern across 3429 sections).

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 593/595 faces across 4 models (2-face discrepancy under investigation).

**Confidence**: High that grammar exists; low on complete grammar.

**Date last updated**: 2026-06-27

---

## OQ-001A: Is Block 1 A Grammar Or An Opcode/Operand Bytecode Language?

**Status**: Open Question

**Evidence so far**: Current observations include ONE-delimited sections, token classes, repeated local forms, the verified length relation INV-017 (`sectionBodyTokenCount = Block2[i] − 1`), and the observation that section length alone does not uniquely determine token-class sequence. These measurements describe stable surface structure, but they do not distinguish between a declarative grammar of section forms and an imperative bytecode-like stream with opcodes and operands.

**Why current evidence cannot distinguish the models**: The project has not yet shown whether values control parser state as operations, or whether they are terminals in a fixed structural grammar. No execution model, opcode table, operand arity table, or complete finite-state grammar has been verified. The non-uniqueness of token-class patterns by section length is consistent with both models.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR for earlier grammar observations; v0.4.0 corpus for INV-017 verification.

**Faces/models tested**: 593/595 faces across 4 models (2-face discrepancy under investigation).

**Confidence**: High that both models remain viable; no answer assigned.

**Date last updated**: 2026-06-27

---

## OQ-002: What Does Each ONE-Delimited Segment Represent?

**Status**: Hypothesis

**Evidence so far**: Count of ONE values equals Block 2 loop count for 595/595 faces. INV-017 further shows that each section body length equals `Block2[i] − 1`, which is consistent with — but does not prove — a one-segment-per-loop interpretation.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High on count correlation and structural pairing (INV-017), medium-low on semantic meaning.

**Date last updated**: 2026-06-27

---

## OQ-003: What Do LARGE Values Represent?

**Status**: Hypothesis Space

**Evidence so far**: LARGE values appear in Block 1 sections and often alternate with ZERO values. Some values fall into ranges that could be local or global indices, but the current evidence disproves a uniform "all global vertex indices" rule.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models for token grammar; selected simple/complex faces for range checks.

**Confidence**: Low for semantics.

**Date last updated**: 2026-06-27

---

## OQ-003A: What Do VALUE Tokens Mean?

**Status**: Open Question

**Evidence so far**: `VALUE` is currently only an observational class for any Block 1 integer other than `0` or `1`. The property-table hypothesis was falsified by today's reported random-base controls, frequency-bias analysis, and delimiter-artifact finding. The v0.4.0 corpus statistics show that VALUE tokens repeat in 1937/3429 sections (56.5%) and that section length alone does not uniquely determine token-class sequence. These observations constrain but do not resolve VALUE semantics.

**Current conclusion**: VALUE semantics are UNKNOWN.

**Promotion rule**: Future hypotheses about VALUE must include at least one discriminating experiment before being promoted beyond Hypothesis.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR for earlier VALUE/token observations; v0.4.0 corpus for statistics.

**Faces/models tested**: 593/595 faces across 4 models (2-face discrepancy under investigation).

**Confidence**: High that VALUE semantics are unknown; high that the property-table hypothesis is currently failed, pending raw evidence archival.

**Date last updated**: 2026-06-27

---

## OQ-004: What Do ZERO Values Represent Inside Block 1?

**Status**: Hypothesis Space

**Evidence so far**: ZERO is frequent and forms dominant `ZERO -> LARGE` and `LARGE -> ZERO` bigrams. It may be a separator, null field, flag, or part of a record grammar.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High for frequency, low for meaning.

**Date last updated**: 2026-06-27

---

## OQ-005: Why Do Some Faces Have SMALL Values?

**Status**: Observation

**Evidence so far**: SMALL values in range `2..255` were observed in GEAR but not in BOTTOM, TOP, or DEKOR in the current classification run. The branch notebook records 546 SMALL values in GEAR and 0 in BOTTOM, TOP, and DEKOR.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High for observed distribution, low for explanation.

**Date last updated**: 2026-06-27

---

## OQ-006: What Is The Meaning Of Block 2's Raw Encoding?

**Status**: Hypothesis

**Evidence so far**: The formula `(raw + 2) / 2` works as a loop vertex-count decoder for all tested faces. The reason for this encoding is unknown.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: High on decoder, low on derivation.

**Date last updated**: 2026-06-27

---

## OQ-007: What Is The Small DisplayLists/LWDATA-Adjacent Stream?

**Status**: Observation

**Evidence so far**: `Contents/Config-0-LWDATA` appears metadata-like and contains class-name-like strings, but its full structure is not decoded.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 4 models, stream-level analysis.

**Confidence**: Medium that it is metadata in current corpus, low on exact grammar.

**Date last updated**: 2026-06-27

---

## OQ-008: What Are DisplayLists Sections?

**Status**: Hypothesis Space

**Evidence so far**: Repeated `[1,1]` section-like structures exist. Section 0 often contains metadata strings. Other sections may group faces, but grouping semantics are unverified.

**Files tested**: BOTTOM, GEAR

**Faces/models tested**: 2 models, 152 parsed faces in section audit.

**Confidence**: High that sections exist, low on semantics.

**Date last updated**: 2026-06-27

---

## OQ-009: What Is `Contents/Config-0-Partition`?

**Status**: Observation

**Evidence so far**: Current tooling sees this stream as unreadable/high entropy. It may be compressed, encrypted, encoded, or otherwise transformed.

**Files tested**: BOTTOM and related modern corpus inventory.

**Faces/models tested**: Stream-level analysis.

**Confidence**: Medium on unreadable/high-entropy observation, low on cause.

**Date last updated**: 2026-06-27

---

## OQ-010: How Do LARGE-LARGE Pairs At Segment Boundaries Work?

**Status**: Observation

**Evidence so far**: The branch notebook records some Block 1 sections ending with `LARGE LARGE` rather than `ZERO LARGE`, including BOTTOM faces #35-38. This pattern appears near the end of some Block 1 bodies.

**Files tested**: BOTTOM, with broader corpus status not yet audited.

**Faces/models tested**: At least 4 named BOTTOM faces; aggregate prevalence not yet preserved in project-wide evidence.

**Confidence**: Medium for existence, low for meaning.

**Date last updated**: 2026-06-27

---

## OQ-011: Can Block 1 Grammar Be Decoded Without Geometric Validation?

**Status**: Hypothesis Space

**Evidence so far**: Structural analysis shows strong grammar signals such as ONE delimiters and ZERO/LARGE alternation, but current evidence does not establish the meaning of positions inside each segment.

**Files tested**: BOTTOM, TOP, GEAR, DEKOR

**Faces/models tested**: 595 faces across 4 models.

**Confidence**: Medium that structural decoding can go further; low that full decoding can be completed without geometry checks.

**Date last updated**: 2026-06-27

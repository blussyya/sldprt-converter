# Next Questions

Operational research queue for the SLDPRT reverse-engineering project.

This is not the same as `OPEN_QUESTIONS.md`. Open questions describe broad unknowns. Next questions are concrete, experiment-driving questions that can be answered, falsified, or retired.

Each entry should include:

```text
Status:
Depends on:
If answered:
Will eliminate or constrain:
Evidence to archive:
Last updated:
```

Statuses:

- `Active`: current research priority.
- `Ready`: well-formed and ready to run.
- `Blocked`: requires missing tooling, data, or manual review.
- `Deferred`: valid, but not next in sequence.
- `Answered`: resolved by evidence; link experiment and conclusion.
- `Retired`: no longer useful because direction changed or premise failed.

---

## NQ-001: Can Block 1 Be Parsed By A Finite-State Grammar Over Observed Section Forms?

**Status**: Active

**Depends on**: EXP-006, EXP-007

**If answered**: Tests whether Block 1 can be described by observed section forms without assigning semantics to `VALUE` tokens.

**Will eliminate or constrain**: OQ-001, OQ-001A, OQ-002, OQ-004, OQ-010, OQ-011; ASM-003.

**Evidence to archive**: Segment token sequences by face, observed section forms, accepted/rejected form cases, per-file exception tables.

**Last updated**: 2026-06-27

---

## NQ-002: Do ONE-Delimited Block 1 Segment Lengths Correlate With Block 2 Loop Vertex Counts?

**Status**: Active

**Depends on**: EXP-004, EXP-006, EXP-007

**If answered**: Tests whether ONE-delimited segments are structurally paired with Block 2 loop entries beyond count equality.

**Will eliminate or constrain**: ASM-003, OQ-002, OQ-005 from branch-local notebook, OQ-010.

**Evidence to archive**: CSV/table with face id, vertex count, Block 2 decoded counts, ONE segment lengths, token-class histograms, mismatches.

**Last updated**: 2026-06-27

---

## NQ-002A: Does `len = 2 * loopSize - 2` Hold Across The Full Archived Corpus?

**Status**: Answered

**Depends on**: EXP-004, EXP-009, EXP-011

**Answer**: This formula has been verified as INV-017 (Verified Structural Invariant). For every ONE-delimited section, `sectionBodyTokenCount = Block2[i] - 1`, which is equivalent to `len = 2 * loopSize - 2`. Verified across 593/593 validated faces (100%).

**Evidence archive**: `knowledge/evidence/2026-06-27_v0.4.0-invariant-validation.md`

**Will eliminate or constrain**: OQ-001, OQ-001A, OQ-002, ASM-003.

**Evidence to archive**: Raw table with file name, face id, Block 2 loop size, observed Block 1 section length, formula result, and mismatch count.

**Last updated**: 2026-06-27

---

## NQ-003: Are SMALL Tokens In GEAR Structurally Localized?

**Status**: Ready

**Depends on**: EXP-006

**If answered**: Determines whether SMALL values are a rare grammar production, a file/model-specific feature, or an artifact of the token threshold.

**Will eliminate or constrain**: OQ-005, ASM-004.

**Evidence to archive**: List of faces containing SMALL tokens, token positions, surrounding token windows, section ids if available, face vertex counts, Block 2 loop counts.

**Last updated**: 2026-06-27

---

## NQ-004: Are `LARGE LARGE` Boundary Patterns A Distinct Block 1 Production?

**Status**: Ready

**Depends on**: EXP-006

**If answered**: Determines whether `LARGE LARGE` near segment/block boundaries is grammar, terminator-like structure, or incidental adjacency.

**Will eliminate or constrain**: OQ-003, OQ-004, OQ-010, ASM-004.

**Evidence to archive**: All `LARGE LARGE` occurrences by file/face/segment, boundary classification, preceding/following token windows, relation to Block 2 loop index.

**Last updated**: 2026-06-27

---

## NQ-004A: Can The Property-Table Falsification Evidence Be Reproduced And Archived?

**Status**: Active

**Depends on**: EXP-010, FH-013

**If answered**: Replaces today's handoff-only property-table falsification with reproducible project-wide evidence.

**Will eliminate or constrain**: OQ-003A, ASM-004, future VALUE hypotheses.

**Evidence to archive**: Raw script output for random-base controls, frequency-bias analysis, delimiter-artifact analysis, exact command/script, corpus size, files analyzed, and numeric results.

**Last updated**: 2026-06-27

---

## NQ-005: Can DisplayLists `[1,1]` Section Maps Be Completed For TOP And DEKOR?

**Status**: Ready

**Depends on**: EXP-008

**If answered**: Completes the current section-count corpus and tests whether BOTTOM/GEAR section behavior generalizes.

**Will eliminate or constrain**: OQ-008, ASM-005, INV-014 confidence level.

**Evidence to archive**: Section offsets, sizes, face counts per section, string/class-name hits, candidate marker counts, parsed face counts for TOP and DEKOR.

**Last updated**: 2026-06-27

---

## NQ-006: Can The Section-0 Contradiction Be Resolved By Byte-Level Re-Audit?

**Status**: Blocked

**Depends on**: EXP-008 raw section-map output, branch-local section audit scripts.

**If answered**: Resolves the documented inconsistency where one note says Section 0 has no face markers while another records GEAR Section 0 with 4 faces.

**Will eliminate or constrain**: INV-014, OQ-008, ASM-005.

**Evidence to archive**: Raw section map for BOTTOM and GEAR, exact Section 0 offset/range, face-marker offsets inside or outside Section 0.

**Last updated**: 2026-06-27

---

## NQ-007: Can R0/R1 Position-Normal Evidence Be Reproduced And Archived?

**Status**: Blocked

**Depends on**: Locating or recreating the R0/R1 comparison script/output.

**If answered**: Upgrades INV-003 from handoff-supported documentation to project-wide reproducible evidence.

**Will eliminate or constrain**: Any remaining ambiguity about position vs normal record interpretation.

**Evidence to archive**: Script name, input files, vector-length statistics, equality statistics, min/max component ranges, model/face counts.

**Last updated**: 2026-06-27

---

## NQ-008: Can Normal-Gap Loop-Splitting Failure Be Reproduced And Archived?

**Status**: Deferred

**Depends on**: v0.3.0-v0.3.3 diagnostic scripts and representative files.

**If answered**: Strengthens FH-005 with raw evidence and exact corpus counts.

**Will eliminate or constrain**: Attempts to revive normal-discontinuity loop splitting without new evidence.

**Evidence to archive**: Diagnostic output showing false splits on strip diagonals, input files, face ids, threshold settings.

**Last updated**: 2026-06-27

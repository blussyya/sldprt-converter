# Research Dashboard

Permanent project-wide knowledge base for the SLDPRT reverse-engineering project.

Branch-local notebooks remain under version directories such as `v0.3.5/docs/research/`. This `knowledge/` directory is the durable cross-version record.

---

## Current Research Posture

**Primary goal**: Recover the grammar of SLDPRT binary serialization well enough to build a read-only parser.

**Current phase**: DisplayLists Block 1 observed section-form research.

**Active research queue**: `NEXT_QUESTIONS.md`

**Rules**:

- Parser first, converter second.
- Syntax before semantics.
- Never assign semantic names without evidence.
- Every important conclusion must state status, evidence, tested files, tested counts, confidence, and date.
- Historical evidence is append-only. Do not delete old evidence; supersede it with newer entries.
- Every numerical claim must be reproducible from archived evidence.
- Open questions are broad unknowns. Next questions are concrete research queue items.
- Do not silently upgrade hypotheses into verified conclusions.
- Preserve raw experiment output under `knowledge/evidence/`.
- Git operations are only performed when explicitly instructed.

---

## High-Confidence Findings

- Modern readable geometry is in `Contents/DisplayLists`.
- Face blocks contain positions, a gap marker, normals, Block 1, and Block 2.
- The gap marker is `[12, 100, 2, vertexCount]`.
- Block 2 decodes loop vertex counts with `(raw + 2) / 2`.
- Decoded Block 2 loop counts sum to face vertex count for 595/595 tested faces.
- Block 1 starts with ONE for 595/595 tested faces.
- Block 1 ONE count equals Block 2 entry count for 595/595 tested faces.
- Block 1 ONE values are singleton runs.
- Block 1 body length follows `b1len = 2 × (vertexCount − sectionCount)` (INV-016, 593/593 validated faces).
- Every ONE-delimited section body token count equals `Block2[i] − 1` (INV-017, 593/593 validated faces).
- Sum of Block 2 values equals Block 1 body length (INV-018, 593/593 validated faces).

See `KNOWN_INVARIANTS.md` for evidence details.

---

## Main Unknowns

- The exact grammar of Block 1.
- The meaning of each ONE-delimited Block 1 segment.
- The role, if any, of ZERO/ONE/VALUE token classes; VALUE semantics are currently UNKNOWN.
- Whether Block 1 is better modeled as grammar or opcode/operand bytecode.
- The meaning of DisplayLists `[1,1]` section-like structures.
- The structure of metadata streams such as LWDATA and unresolved high-entropy streams such as `Config-0-Partition`.
- Section length alone does not uniquely determine token-class sequence (only 30.2% of lengths have a single unique pattern).

See `OPEN_QUESTIONS.md`.

---

## Active Experiments

- NQ-001: Can Block 1 be parsed by a finite-state grammar over observed section forms?
- NQ-002: Do ONE-delimited Block 1 segment lengths correlate with Block 2 loop vertex counts?
- NQ-004A: Can the property-table falsification evidence be reproduced and archived?

See `NEXT_QUESTIONS.md`.

---

## Recently Falsified Hypotheses

- FH-003: The gap marker contains loop boundaries.
- FH-005: Normal-gap loop splitting works.
- FH-006: Face blocks start with `[12, 100, 2, vertexCount]`.
- FH-011: Block 2 raw values are vertex indices.
- FH-012: DisplayLists contains only face data.
- FH-013: VALUE tokens encode a property table.

See `FAILED_HYPOTHESES.md`.

---

## Current Corpus

| File | Short name | Notes |
| --- | --- | --- |
| `test files original/usb hub case (ultimate test)/USB hub case BOTTOM.SLDPRT` | BOTTOM | Modern openswx-like file, 39 parsed faces |
| `test files original/usb hub case (ultimate test)/USB hub case TOP.SLDPRT` | TOP | Modern openswx-like file, 68 parsed faces |
| `test files original/Helical Bevel Gear.SLDPRT` | GEAR | Modern openswx-like file, 113 parsed faces |
| `test files original/Dekor.SLDPRT` | DEKOR | Modern openswx-like file, 375 parsed faces |
| `test files original/SW2000-s01.SLDPRT` | SW2000 | Older OLE2 file, partially decoded |

Modern aggregate: 595 parsed faces across 4 models. (v0.4.0 parser validates 593/595; 2-face discrepancy under investigation.)

---

## Repository Stewardship

Before proposing a commit:

- Review changed files and identify unrelated edits.
- Suggest logical commit boundaries.
- Identify files that should or should not be committed.
- Check for accidental debug output and generated files.
- Verify documentation matches implementation.
- Verify experiments referenced by documentation actually exist.

Commit report template:

```text
Summary:
Files changed:
Research impact:
Breaking changes:
Documentation status:
Recommended commit message:
```

---

## Maintenance Protocol

See `EVIDENCE_PRESERVATION_POLICY.md` for the mandatory evidence rules.

When adding a conclusion:

```text
Status:
Evidence:
Files tested:
Faces/models tested:
Confidence:
Date last updated:
```

When disproving a hypothesis:

1. Add or update the disproving experiment in `EXPERIMENT_LOG.md`.
2. Move the claim to `FAILED_HYPOTHESES.md`.
3. Remove or downgrade any conflicting entry in `ASSUMPTIONS.md` or `KNOWN_INVARIANTS.md`.
4. Add raw or summarized evidence under `knowledge/evidence/` when useful.

When adding a numerical claim:

1. Archive raw script output, corpus size, files analyzed, exact command/script used, and date produced.
2. Link the summary claim to the related experiment and evidence file.
3. If raw evidence is missing, explicitly record the evidence gap and add a `NEXT_QUESTIONS.md` reproduction item.

When adding a VALUE hypothesis:

1. Keep VALUE semantics at UNKNOWN unless a discriminating experiment supports the hypothesis.
2. Document at least one experiment that could distinguish the hypothesis from delimiter artifacts, frequency bias, and random-base controls.
3. Do not promote a VALUE hypothesis beyond Hypothesis without that discriminating evidence.

When adding a next question:

1. Add it to `NEXT_QUESTIONS.md`.
2. Link dependencies to experiments, assumptions, or open questions.
3. State what hypotheses it will eliminate or constrain.
4. Update `Active Experiments` here if it becomes active.

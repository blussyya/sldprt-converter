# Knowledge Base Audit

**Source script or method**: Manual audit using `rg` over `knowledge/` and `v0.3.5/docs/research/`.

**Input files**:

- `knowledge/*.md`
- `knowledge/evidence/*.md`
- `v0.3.5/docs/research/*.md`

**Faces/models tested**: Documentation audit only. No parser code was changed and no new binary parsing was run.

**Related experiment**: Documentation maintenance, not a format experiment.

**Related conclusion**: Knowledge base migration quality.

**Date captured**: 2026-06-27

## Fixed During Audit

- Added missing open questions for `LARGE LARGE` boundary patterns and whether Block 1 can be decoded without geometric validation.
- Restored specific numeric evidence for SMALL-token distribution in GEAR.
- Restored specific numeric evidence for the failed all-global-index hypothesis.
- Restored specific ratio evidence for the failed constant `B1_N / vertexCount` hypothesis.
- Added `Related experiments` links to project-wide invariant entries.
- Downgraded the cross-version Block 1/2 timeline wording for older OLE2 files from "present or suspected" to "not project-wide verified."
- Added GEAR section-audit facts to EXP-008.

## Still Requires Manual Review

- The R0/R1 position-vs-normal conclusion is documented from handoff memory, but the raw script output or exact experiment file is not preserved in `knowledge/evidence/`.
- Some branch-local docs use stronger semantic language, including "topology source," "edge list," and "vertex indices." The project-wide KB intentionally downgrades those to grammar observations or hypotheses, but the branch notebook remains historically stronger.
- The branch notebook has a possible section-0 inconsistency: one place says Section 0 contains no face markers, while another records GEAR Section 0 with 4 faces. This needs byte-level review before project-wide promotion.
- The exact corpus and face counts behind FH-005 normal-gap loop splitting were not preserved during earlier work.
- The exact script/output behind DisplayLists stream inventory and entropy measurements should be archived as raw evidence.


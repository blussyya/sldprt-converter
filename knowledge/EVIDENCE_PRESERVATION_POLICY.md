# Evidence Preservation Policy

Every numerical claim that enters the project-wide knowledge base must be reproducible.

The knowledge base summarizes evidence. The `knowledge/evidence/` directory preserves the evidence itself.

Future contributors should be able to reproduce every invariant without relying on chat history.

---

## Required Evidence For New Invariants

Whenever a new invariant is proposed, archive:

- raw script output
- corpus size
- files analyzed
- exact command or script used
- date produced

If any of these are missing, the invariant entry must explicitly say what is missing and should not be treated as fully reproducible.

---

## Numerical Claim Rule

Any claim containing counts, ratios, percentages, formulas verified over a corpus, file sizes, marker counts, face counts, model counts, or exception counts must link to evidence that preserves enough detail to reproduce the number.

Examples:

- `595/595 faces`
- `39 parsed faces`
- `len = 2 * loopSize - 2 across the measured corpus`
- `546 SMALL values`
- `11 section-like headers`

These may appear in summary documents only if their source evidence is archived or the evidence gap is explicitly recorded.

---

## Evidence File Minimum Template

Each evidence file should include:

```text
Source script or method:
Exact command:
Script path:
Input files:
Corpus size:
Faces/models tested:
Raw output:
Related experiment:
Related conclusion:
Date produced:
Date captured:
Known gaps:
```

For long outputs, store the raw output in a `.txt` file and reference it from a short `.md` evidence note.

---

## Handling Evidence Gaps

If a finding arrives from chat, handoff, or a report without raw output:

1. Archive the handoff/report under `knowledge/evidence/`.
2. Mark the related invariant or experiment as pending raw evidence.
3. Add or update a `NEXT_QUESTIONS.md` item to reproduce or archive the missing evidence.
4. Do not upgrade confidence based only on memory or chat summary.


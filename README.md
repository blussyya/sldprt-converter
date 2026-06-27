# SLDPRT Reverse-Engineering Research

This is a research project to recover the serialization grammar of the SolidWorks SLDPRT binary format — syntax before semantics, never guessing meanings.

This is **not** a production converter. The old converter code (`src/`, `test/`) was removed in v0.4.0 to focus purely on format research. The goal is to understand the format well enough to build a read-only parser.

## Knowledge Base

The project-wide knowledge base is maintained under `knowledge/`:

| File | Purpose |
|------|---------|
| `KNOWN_INVARIANTS.md` | Verified structural properties demonstrated across the corpus |
| `EXPERIMENT_LOG.md` | Ledger of every experiment with facts, hypotheses, and confidence |
| `FAILED_HYPOTHESES.md` | Hypotheses that have been disproven |
| `OPEN_QUESTIONS.md` | Broad unresolved questions |
| `NEXT_QUESTIONS.md` | Concrete operational research queue |
| `ASSUMPTIONS.md` | Working assumptions |
| `FORMAT_TIMELINE.md` | Version and container observations |
| `EVIDENCE_PRESERVATION_POLICY.md` | Rules for reproducible evidence |
| `evidence/` | Archived raw experiment outputs |
| `RESEARCH_DASHBOARD.md` | Current research posture |

## Research Versions

| Version | Description |
|---------|-------------|
| v0.3.5 | Evidence preservation policy, knowledge base restructuring, evidence archive |
| v0.4.0 | Three verified structural invariants (I1/I2/I3), EXP-011, corpus analysis |

Each version directory (e.g., `v0.4.0/`) contains the research scripts and docs for that milestone.

## Project Structure

```
sldprt-converter/
├── README.md
├── LICENSE
├── .gitignore
├── knowledge/               # Project-wide research knowledge base
│   ├── KNOWN_INVARIANTS.md
│   ├── EXPERIMENT_LOG.md
│   ├── FAILED_HYPOTHESES.md
│   ├── RESEARCH_DASHBOARD.md
│   ├── NEXT_QUESTIONS.md
│   ├── OPEN_QUESTIONS.md
│   ├── ASSUMPTIONS.md
│   ├── FORMAT_TIMELINE.md
│   ├── EVIDENCE_PRESERVATION_POLICY.md
│   └── evidence/
└── v0.4.0/                  # v0.4.0 research scripts and docs
```

## License

MIT

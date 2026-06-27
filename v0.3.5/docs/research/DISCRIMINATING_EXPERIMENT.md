# Discriminating Experiment Report

**Date:** 2026-06-27
**Hypothesis:** Block 1 VALUE tokens are global vertex indices into the face vertex table.
**Status:** FALSIFIED

## Protocol

1. For every face in 4 files (BOTTOM, TOP, GEAR, DEKOR), built the mesh edge set from the existing strip triangulation (read-only, no parser modification).
2. For each Block 1 ONE-delimited section, interpreted non-zero VALUE tokens as candidate vertex IDs.
3. Tested every consecutive VALUE pair (including wrap-around) against the mesh edge set.
4. Measured: total candidate edges, edges found, percentage match, false positives.

## Results

| File | Faces | Sections | Candidate Edges | Found | % Match | False Pos |
|------|-------|----------|----------------|-------|---------|-----------|
| BOTTOM | 39 | 184 | 1297 | 2 | 0.2% | 1295 |
| TOP | 68 | 859 | 1635 | 4 | 0.2% | 1631 |
| GEAR | 113 | 1214 | 1606 | 122 | 7.6% | 1484 |
| DEKOR | 373 | 1172 | 7717 | 29 | 0.4% | 7688 |
| **TOTAL** | **593** | **3429** | **12255** | **157** | **1.3%** | **12098** |

## Key Findings

### 1. Edge match rate is 1.3% — effectively random
Only 157 out of 12,255 candidate edges exist in the mesh. The 7.6% match in GEAR is explained by coincidental index collisions in a larger vertex table.

### 2. 46.5% of values exceed the vertex table range
- Total non-zero Block 1 values: 16,174
- Values beyond global vertex table range: 7,526 (46.5%)
- Maximum Block 1 value: **20,142**
- Maximum vertex table index: ~10,078 (DEKOR)

Values literally cannot be vertex indices when they exceed the table size.

### 3. Only 5.5% match face-local indices
Values matching face-local index [0, vc): 882/16,174 (5.5%)

### 4. Concrete counterexamples

**BOTTOM Face #0** (ec=4, vc=4):
- Block 1 section: [1, 516, 532, 0, 527, 522]
- Non-zero values: 516, 532, 527, 522
- All 4 values exceed vc=4 — cannot be local indices
- Global vertex table has only 1,856 entries — indices 516-532 exist but the edges between them are NOT in the mesh
- Candidate edges: (516,532), (532,527), (527,522), (522,516) — **0 found**

**DEKOR Face #37**:
- Block 1 contains value 20,142
- DEKOR has only 10,078 global vertices
- Value is 2× the table size — physically impossible as vertex index

## Conclusion

The hypothesis "Block 1 values are global vertex indices" is **falsified** with high confidence. The values are NOT vertex indices into any vertex table (local, global, or combined).

## What Are Block 1 Values?

The values are u32 ranging from 0 to 20,142. They are NOT:
- Local vertex indices (5.5% match, worse than random)
- Global vertex indices (1.3% match, 46.5% out of range)
- Edge pairs from the triangulated mesh (1.3% match)

Remaining hypotheses (not tested here):
1. Byte offsets into a data structure
2. Entity handles/references in the SLDPRT internal database
3. Indices into a hidden vertex table not in DisplayLists
4. Encoded edge indices into an edge table
5. Tokens in a bytecode/stack-based language

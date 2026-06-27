# Block 1 Encoder Reconstruction — Key Findings (2026-06-27)

## Critical Discovery: Section Splitting Method

**Previous assumption (WRONG):** Block 1 is divided evenly into sections based on loop count.

**Correct method:** Block 1 is split by ONE tokens (value = 1). Each section starts with ONE.

```
Block 1: [1, A, B, C, 1, D, E, F, G, 1, H, I]
         ↓ split at ONE
Section 0: [1, A, B, C]
Section 1: [1, D, E, F, G]
Section 2: [1, H, I]
```

## Verified Invariants (3429 sections, 593 faces, 4 files)

| Invariant | Match | Status |
|-----------|-------|--------|
| `section_length = Block 2 raw value` | 3429/3429 (100%) | **INVARIANT** |
| First token = ONE | 3429/3429 (100%) | **INVARIANT** |
| Section count = Block 2 entry count | 593/593 (100%) | **INVARIANT** |
| ONE count per section = 1 | 3429/3429 (100%) | **INVARIANT** |

## Previous Formula (DISPROVEN)

The formula `loopSize = (block2 + 2) / 2` from `grammar_reconstruct.js` was based on incorrect section splitting. When sections are split by ONE delimiters:

- `len == loopSize`: **0/3429 (0%)**
- `len == (block2+2)/2`: **0/3429 (0%)**

The Block 2 value IS the section length, not a loop count.

## Block 1 Values Are Global Vertex Indices

LARGE values (>255) in Block 1 are indices into the **global vertex table** of the DisplayLists stream, NOT local face vertices.

Example: BOTTOM face #0 (vc=4)
```
Section: [1, 516, 532, 0, 527, 522]
idx 516: (0.026, 0.002, -0.011)
idx 532: (0.002, 0.002, -0.011)
idx 527: (-0.032, 0.002, -0.018)
idx 522: (-0.032, 0.002, -0.019)
```

- 4 vertices forming the loop boundary
- 1 zero (structural delimiter)
- Section length = 6 = Block 2 value

## Zero Pattern Analysis

Zeros are NOT padding — they serve as structural delimiters. Observed patterns:

1. **Simple faces (4 verts):** `[1, v1, v2, 0, v3, v4]` — 1 zero
2. **Single vertex:** `[1, v1, 0, 0]` — 2 trailing zeros
3. **Complex faces:** Zeros interspersed, typically `len/2` zeros

The zero positions correlate with edge connectivity, but the exact encoding is still under investigation.

## Section Length Distribution

| Section Length | Count | Percentage |
|---------------|-------|------------|
| 4 | 882 | 25.7% |
| 8 | 825 | 24.1% |
| 12 | 497 | 14.5% |
| 6 | 234 | 6.8% |
| 16 | 184 | 5.4% |
| 10 | 140 | 4.1% |
| 20+ | 667 | 19.4% |

## Positional Token Distribution

| Position | Dominant Token | Percentage |
|----------|---------------|------------|
| 0 | ONE | 100% |
| 1 | LARGE | 61% |
| 2 | ZERO | 67% |
| 3 | ZERO | 86% |
| 4 | LARGE | 72% |
| 5 | ZERO | 94% |
| 6 | LARGE | 55% |
| 7 | ZERO | 82% |
| 8 | LARGE | 62% |
| 9 | ZERO | 92% |

Pattern: Alternating LARGE/ZERO in body positions, but not strict.

## Generation Algorithm Hypothesis

The encoder likely generates sections as:
1. Emit ONE (delimiter)
2. For each vertex in the loop:
   - Emit global vertex index
   - Emit zero if edge connects to next vertex, or non-zero if edge is degenerate
3. Total section length = Block 2 value

The Block 2 value is the TARGET length, and the encoder pads with zeros to reach it.

## Files Analyzed

- BOTTOM: 39 faces, 67 sections
- TOP: 68 faces, 200 sections  
- GEAR: 113 faces, 146 sections
- DEKOR: 373 faces, 773 sections

## Next Steps

1. **Decode zero semantics**: Determine exactly what zeros represent (edge connectivity, loop closure, degenerate edges)
2. **Build decoder**: Convert Block 1 sections → loop vertex lists → triangles
3. **Validate against STEP**: Compare decoded loops with STEP boundary data
4. **Implement in parser**: Replace heuristic approach with grammar-based decoder

# Open Questions — SLDPRT Block 1 Format

**Last updated**: Current session

---

## OQ-001: What do LARGE values represent?

LARGE values (>255) appear in Block 1 but their semantics are unknown.

**Observations**:
- For single-loop faces (vc=4): Block 1 = `[ONE, LARGE, LARGE, ZERO, LARGE, LARGE]`. The 4 LARGE values are likely global vertex indices.
- For multi-loop faces: LARGE values appear to be vertex indices (local or global), but the indexing scheme is unclear.
- For simple faces, LARGE values are in the global vertex index range. For complex faces, many LARGE values are in the local range (0..vc-1).

**Hypothesis**: LARGE values encode vertex connectivity (which vertices are connected by edges). The position within the ONE-delimited section determines the edge order.

**Status**: UNVERIFIED. Needs geometric validation.

---

## OQ-002: What does the ZERO between ONEs represent?

Between consecutive ONE markers, there are often ZERO values.

**Observations**:
- For faces with 1 loop: pattern is `ONE [ZERO LARGE]*` — ZERO appears before each LARGE
- For faces with multiple loops: pattern varies — sometimes `ONE LARGE LARGE ZERO`, sometimes `ONE ZERO LARGE ZERO LARGE`

**Hypothesis**: ZERO is a separator between edge vertex pairs. Each edge is encoded as `(ZERO, vertex_index)` or `(vertex_index, ZERO)`.

**Status**: UNVERIFIED. Needs geometric validation.

---

## OQ-003: What does Block 2's raw value encoding mean?

Block 2 entries use the encoding `vc = (raw + 2) / 2`.

**Observations**:
- Raw values are always even (since vc must be integer, raw must be even)
- The smallest valid raw value is 4 (vc=3, minimum triangle)
- The formula maps raw → vc with a linear relationship

**Hypothesis**: The raw value encodes something like `(vertex_count - 1) × 2` or similar, and the `+2` is an offset.

**Status**: UNVERIFIED. The formula works but the derivation is unknown.

---

## OQ-004: What is the small DisplayLists stream?

Each SLDPRT file has a small stream (6 bytes for BOTTOM) in addition to the main DisplayLists stream.

**Observations**:
- BOTTOM: `Contents/Config-0-LWDATA` = 1405 bytes, header `[0x100, 0x0, 0x3c600000, ...]`
- TOP: Similar small stream exists
- GEAR: Similar small stream exists
- DEKOR: Similar small stream exists

**Hypothesis**: The small stream is a metadata/index/lookup table for the main DisplayLists.

**Status**: UNVERIFIED. Need to decode its structure.

---

## OQ-005: How are ONE-delimited sections structured?

Within each ONE-delimited section, what is the internal structure?

**Observations**:
- Section 0 (first ONE): often `ONE LARGE ZERO ZERO` or `ONE LARGE LARGE`
- Subsequent sections: vary more
- The last section often ends with `ZERO LARGE LARGE` or `LARGE LARGE`

**Hypothesis**: Each section corresponds to one sub-loop and encodes:
1. The sub-loop's boundary edges (vertex pairs)
2. The sub-loop's relationship to the parent face

**Status**: UNVERIFIED. Needs geometric validation.

---

## OQ-006: What is the relationship between Block 1 sections and face topology?

Do Block 1 sections directly encode the face's edge connectivity graph?

**Observations**:
- The number of ONEs equals the number of sub-loops
- Each ONE starts a new section
- Section sizes vary (4–30+ u32s)

**Hypothesis**: Block 1 is an edge list grouped by sub-loop. Each section contains the edges of one sub-loop.

**Status**: UNVERIFIED. Needs geometric validation.

---

## OQ-007: Why do some faces have SMALL values?

Only the GEAR file has SMALL values (2–255) in Block 1.

**Observations**:
- GEAR: 546 SMALL values across all faces
- BOTTOM, TOP, DEKOR: 0 SMALL values

**Hypothesis**: SMALL values are vertex indices in a different range, or they represent a different data type (e.g., flags, counts).

**Status**: UNVERIFIED. Need to check if SMALL values correlate with anything.

---

## OQ-008: How do LARGE-LARGE pairs at section boundaries work?

Some sections end with `LARGE LARGE` instead of `ZERO LARGE`.

**Observations**:
- In BOTTOM faces #35-38 (multi-loop PLANE faces), the last section ends with `LARGE LARGE`
- This pattern appears at the end of Block 1 body

**Hypothesis**: `LARGE LARGE` at the end of Block 1 is a terminator or a special edge pair.

**Status**: UNVERIFIED.

---

## OQ-009: What is the DisplayLists internal structure?

The main DisplayLists stream contains sub-structures with `[1,1]` headers.

**Observations**:
- BOTTOM: 11 `[1,1]` headers in 98481-byte stream
- The stream contains face markers `[12, 0, 0, 0, 100, 0, 0, 0]` (156 occurrences)
- The stream contains topology headers `[4, 8, 2, N]` (63 occurrences)

**Hypothesis**: The DisplayLists is organized into sections, each starting with `[1,1]`. Each section contains a group of faces.

**Status**: UNVERIFIED. Need to map the internal structure.

---

## OQ-010: Can we decode Block 1 without geometric validation?

Is it possible to fully decode Block 1's grammar purely from structural analysis, without knowing the geometry?

**Observations**:
- The grammar has strong patterns (ONE delimiters, ZERO-LARGE alternation)
- But the exact meaning of each position within a section is unknown

**Hypothesis**: The grammar can be partially decoded structurally, but full decoding requires geometric validation (checking that decoded edges produce correct mesh topology).

**Status**: UNVERIFIED. This is the core open question of the forensic investigation.

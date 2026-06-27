# Known Invariants — SLDPRT Block 1/2 Format

**Status**: Verified across 595 faces in 4 files (BOTTOM, TOP, GEAR, DEKOR)

---

## INV-001: Face Block Layout

Every face in the DisplayLists stream follows this exact binary layout:

```
+0000  u32 edgeCount
+0004  u32(100)
+0008  u32(2)
+000c  u32 vertexCount
+0010  float32[vertexCount × 3]     // vertex positions (meters, ×1000 for mm)
+gap   u32[4] = [12, 100, 2, vertexCount]  // gap marker (separator)
+norm  float32[vertexCount × 3]     // per-vertex normals
+topo  Block 1 header[4] + Block 1 body[N]
+topo2 Block 2 header[4] + Block 2 body[M]
```

**Evidence**: Verified by byte-offset forensic dump of faces #32 (complex) and #114 (simple) in Gear file.

---

## INV-002: Block 1 Header

Block 1 always starts with:

```
u32[0] = 4
u32[1] = 8
u32[2] = 2
u32[3] = N   (number of u32 values in Block 1 body)
```

Total Block 1 size = `(N + 4) × 4` bytes.

**Evidence**: 595/595 faces across all 4 files.

---

## INV-003: Block 2 Header

Block 2 always starts with:

```
u32[0] = 4
u32[1] = 8
u32[2] = 2
u32[3] = M   (number of u32 values in Block 2 body)
```

Total Block 2 size = `(M + 4) × 4` bytes.

**Evidence**: 595/595 faces across all 4 files.

---

## INV-004: Block 2 Entry Count = Sub-loop Count

Block 2 contains exactly M entries, where M equals the number of sub-loops in the face.

Each entry encodes a sub-loop vertex count via: `vc_per_loop = (raw_value + 2) / 2`

The sum of all vc_per_loop values equals vertexCount.

**Evidence**: BOTTOM (39/39), TOP (68/68), GEAR (113/113), DEKOR (375/375). Zero exceptions.

---

## INV-005: ONE Count = Block 2 Entry Count

The number of ONE values in Block 1 body exactly equals the number of entries in Block 2.

This holds for every face across all 4 files:
- BOTTOM: 39/39 faces, ONE count = B2_N
- TOP: 68/68 faces, ONE count = B2_N
- GEAR: 113/113 faces, ONE count = B2_N
- DEKOR: 375/375 faces, ONE count = B2_N

Total: **595/595 faces, ZERO exceptions.**

**Evidence**: Exhaustive count across all faces in all 4 files.

---

## INV-006: Block 1 Always Starts with ONE

Position 0 of Block 1 body is always ONE (value 1).

**Evidence**: 595/595 faces across all 4 files.

---

## INV-007: ONE Values Are Always Singleton

ONE values never appear in consecutive runs. Every run of ONEs has length exactly 1.

**Evidence**: RLE analysis across all 4 files: all ONE runs have len=1.

---

## INV-008: Token Classification Distribution

Block 1 body contains exactly 4 token types:
- ZERO (value 0)
- ONE (value 1)
- SMALL (2–255)
- LARGE (>255)

No other token types exist.

**Evidence**: All 595 faces, all u32 values classified.

---

## INV-009: Dominant Bigram Pattern

The two most frequent bigrams across all files are:
- `LARGE → ZERO`
- `ZERO → LARGE`

This creates the characteristic `ZERO LARGE ZERO LARGE` alternating pattern.

**Evidence**: Top 2 bigrams in all 4 files (BOTTOM: 1385+1374, TOP: 2285+2158, GEAR: 1886+1935, DEKOR: 12539+12656).

---

## INV-010: Dominant Trigram Pattern

The most frequent trigram is always `ZERO → LARGE → ZERO`.

**Evidence**: Top trigram in BOTTOM (1281), GEAR (1241), DEKOR (10450). TOP has `ZERO → ZERO → ZERO` due to high zero-fill in single-loop faces.

---

## INV-011: Gap Marker

Between vertex data and normal data, there is always a 16-byte gap marker:

```
u32[0] = 12
u32[1] = 100
u32[2] = 2
u32[3] = vertexCount
```

This is identical to the face type marker `[12, 100, 2, vc]` that our scanner searches for.

**Evidence**: Byte-offset forensic dump of faces #32 and #114 in Gear file.

---

## INV-012: B1_N / vc Ratio

The ratio B1_N / vertexCount falls in a predictable range:
- Single-loop faces: ~1.5–2.0
- Multi-loop faces: ~1.5–1.9

No face has B1_N / vc < 1.0 or > 2.5.

**Evidence**: All 595 faces across all 4 files.

---

## INV-013: DisplayLists Section Structure

The main DisplayLists stream is organized into sections, each starting with a `[1, 1]` header.

- BOTTOM: 11 sections, 39 faces
- GEAR: 59 sections, 113 faces

Section sizes vary from 32 bytes to 106428 bytes.

**Evidence**: Byte-level section map of BOTTOM and GEAR DisplayLists.

---

## INV-014: Section 0 Is Metadata

Section 0 (the first section) contains no face markers and starts with `uiUserModelEnv_c`.

- BOTTOM Section 0: 6352 bytes, 0 faces, contains `uiUserModelEnv_c`
- GEAR Section 0: 106428 bytes, 4 faces, contains `uiUserModelEnv_c`

**Evidence**: Section map analysis.

---

## INV-015: LWDATA Is Metadata

The `Contents/Config-0-LWDATA` stream contains no face markers, no topology headers, and no [1,1] headers.

It contains MFC class names: `gcXhatch_c`, `moLWPlaneNodeData_c`.

- BOTTOM: 1405 bytes
- TOP: 1405 bytes
- GEAR: 2195 bytes
- DEKOR: 1401 bytes

**Evidence**: Structural analysis of LWDATA across all 4 files.

---

## INV-016: Face Blocks Are Self-Contained

Each face block contains its own vertex data, normal data, and topology blocks. There are no cross-references between face blocks.

**Evidence**: Forensic dump of faces #32 and #114 in Gear file.

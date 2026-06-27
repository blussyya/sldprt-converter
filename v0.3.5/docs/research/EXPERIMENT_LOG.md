# Experiment Log — SLDPRT Format Investigation

**Protocol**: Every experiment ends with Facts/Hypotheses/Confidence. No conclusions.

---

## EXP-001: Face Marker Detection

**Date**: Early sessions
**Goal**: Find how faces are located in the DisplayLists stream.

**Method**: Byte-scan for `[12, 0, 0, 0, 100, 0, 0, 0]` pattern, validate edgeCount and vertexCount.

**Facts**:
- 156 face markers found in BOTTOM DisplayLists (98481 bytes)
- 39 faces parsed after validation
- The marker pattern `[12, 0, 0, 0, 100, 0, 0, 0]` is the gap marker, not the face start
- Face start is at `marker - 4` (edgeCount u32 before the marker)

**Hypotheses**:
- H1: Some markers are false positives (invalid edgeCount or vertexCount)
- H2: The DisplayLists contains non-face data that also matches the pattern

**Confidence**: HIGH that face detection works. LOW on understanding why 156 markers but only 39 faces.

---

## EXP-002: Block 1/2 Structure Discovery

**Date**: v0.3.0–v0.3.3
**Goal**: Understand the topology blocks after vertex/normal data.

**Method**: Parse `[4, 8, 2, N]` headers, read N u32 values, check for second header.

**Facts**:
- Block 1 header: `[4, 8, 2, N]` where N = number of u32 values in body
- Block 2 header: `[4, 8, 2, M]` where M = number of sub-loop entries
- Block 2 encoding: `vc_per_loop = (raw + 2) / 2`
- Block 2 vc sum = vertexCount (verified 595/595 faces)

**Hypotheses**:
- H1: Block 1 contains edge connectivity data
- H2: Block 2 contains sub-loop vertex counts for the slicing mask

**Confidence**: HIGH on Block 2 formula. MEDIUM on Block 1 semantics.

---

## EXP-003: Gap-Based Loop Splitting

**Date**: v0.3.0–v0.3.3
**Goal**: Detect loops by analyzing normal vector discontinuities.

**Method**: Compare adjacent vertex normals, split when deviation > threshold.

**Facts**:
- Gap detection fires on strip diagonals, not actual hole boundaries
- Diagnostic script proved the approach is fundamentally flawed
- Normal vectors are stored per-vertex, not per-loop

**Hypotheses**:
- H1: Normal vectors are interpolated across the face, not discontinuous at loop boundaries
- H2: Loop boundaries are not encoded in the normal data

**Confidence**: HIGH that gap-based splitting is WRONG. The approach was abandoned.

---

## EXP-004: Block 2 Slicing Mask Formula

**Date**: v0.3.4
**Goal**: Decode Block 2's encoding of sub-loop vertex counts.

**Method**: Compare Block 2 raw values with known loop vertex counts from STEP data.

**Facts**:
- Formula `vc = (raw + 2) / 2` verified across all files
- BOTTOM FACE#8 (vc=75): Block 2 sum = 75 ✓
- BOTTOM FACE#10 (vc=212): Block 2 sum = 212 ✓
- GEAR FACE#30 (vc=16): Block 2 = [3, 13], sum = 16 ✓

**Hypotheses**:
- H1: The raw value encodes `(vertex_count - 1) × 2` with an offset
- H2: The formula is universal across all SLDPRT versions

**Confidence**: HIGH that the formula is correct. LOW on its derivation.

---

## EXP-005: Gap Marker Identification

**Date**: v0.3.5 (forensic dump)
**Goal**: Identify the 16-byte gap between vertex data and normal data.

**Method**: Byte-offset forensic dump of two faces with exact layout mapping.

**Facts**:
- Gap marker is always `[12, 100, 2, vertexCount]`
- This is the same pattern our scanner searches for
- The face block starts with `[edgeCount, 100, 2, vc]`, not `[12, 100, 2, vc]`

**Hypotheses**:
- H1: The `12` in the gap marker is a separator between vertex data and normal data
- H2: The scanner finds faces by locating the gap marker, then backing up to read edgeCount

**Confidence**: HIGH on the gap marker identity. MEDIUM on the scanning logic.

---

## EXP-006: Block 1 Grammar Discovery

**Date**: Current session
**Goal**: Discover the grammar of Block 1 without interpreting semantics.

**Method**: Classify all u32s as ZERO/ONE/SMALL/LARGE, find patterns, bigrams, trigrams.

**Facts**:
- 595/595 faces start with ONE
- ONE count = Block 2 entry count (loop count) in all 595 faces
- ONE values are always singleton (never consecutive)
- Dominant bigrams: `LARGE→ZERO`, `ZERO→LARGE`
- Dominant trigram: `ZERO→LARGE→ZERO`
- Single-loop faces: pattern `ONE [ZERO LARGE]*` (49 pairs for vc=50)
- Multi-loop faces: pattern `ONE section* [ZERO+ section]`

**Hypotheses**:
- H1: ONE is a section delimiter (one section per sub-loop)
- H2: ZERO-LARGE pairs encode edges (vertex indices)
- H3: The last section (after the last ONE) is a terminator or special case

**Confidence**: HIGH on the grammar patterns. MEDIUM on the semantics.

---

## EXP-007: Loop Correspondence Verification

**Date**: Current session
**Goal**: Verify that ONE count equals loop count across all files.

**Method**: Count ONE values in Block 1, compare with Block 2 entry count.

**Facts**:
- BOTTOM: 39/39 faces match
- TOP: 68/68 faces match
- GEAR: 113/113 faces match
- DEKOR: 375/375 faces match
- Total: 595/595 faces, ZERO exceptions

**Hypotheses**:
- H1: The ONE count is the authoritative source of loop count
- H2: Block 2 entries correspond 1:1 with ONE-delimited sections

**Confidence**: VERY HIGH on the 1:1 correspondence.

---

## EXP-008: DisplayLists Stream Audit

**Date**: Current session
**Goal**: Map the internal structure of the main DisplayLists stream.

**Method**: Analyze all decompressed streams, find markers, strings, structure.

**Facts**:
- BOTTOM: 43 decompressed streams, main DisplayLists = 98481 bytes
- 156 face markers found, 39 faces parsed
- 63 topology headers `[4, 8, 2, N]` found
- 11 `[1, 1]` section headers found
- Embedded strings: `uiUserModelEnv_c`, `moAmbientLight_c`, `uoBodyPropInfo_c`, etc.
- Entropy: 4.78 bits/byte (moderate structure)
- Byte distribution: 46.6% zero bytes

**Hypotheses**:
- H1: The DisplayLists is organized into sections separated by `[1,1]` headers
- H2: Each section contains a group of related faces
- H3: The strings are MFC class names used by SolidWorks

**Confidence**: HIGH on the stream structure. LOW on the section semantics.

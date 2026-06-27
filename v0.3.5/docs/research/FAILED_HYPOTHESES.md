# Failed Hypotheses — SLDPRT Format Investigation

**Last updated**: Current session

---

## FH-001: "Block 1 is a rendering cache"

**Hypothesis**: Block 1 contains lossy/compressed rendering data, not full topology.

**Evidence against**:
- Block 1 contains complete loop decomposition (verified by forensic dump)
- Block 1's ONE count exactly matches Block 2's loop count (595/595 faces)
- Block 1's structure is deterministic and repeatable across files

**Status**: DISPROVEN. Block 1 IS the topology source.

---

## FH-002: "Holes are stored as separate faces"

**Hypothesis**: Faces with holes (like the gear bore) are stored as multiple separate face blocks.

**Evidence against**:
- User's Blender visual review showed flat faces generating giant webbed triangles
- The gear bore (Face #17, 943 verts) is a single face block with 1 loop
- Multi-loop faces (like BOTTOM Face #5, 212 verts, 41 loops) are single blocks

**Status**: DISPROVEN. Holes are encoded within a single face block via sub-loops.

---

## FH-003: "Gap data contains loop boundaries"

**Hypothesis**: The 16-byte gap between vertex data and normal data contains loop boundary information.

**Evidence against**:
- The gap marker is always `[12, 100, 2, vertexCount]` — a fixed pattern, not topology data
- The gap marker is identical to the face type marker

**Status**: DISPROVEN. The gap marker is a separator, not topology data.

---

## FH-004: "Block 1 values are always global vertex indices"

**Hypothesis**: All non-zero values in Block 1 are global vertex indices.

**Evidence against**:
- For complex faces (vc=1324), 2324/2404 Block 1 values are in the local range (0–1323)
- For simple faces (vc=4), 4/6 values are in the global range (1559–1588)
- The indexing scheme appears to switch between local and global depending on face complexity

**Status**: DISPROVEN. Block 1 uses a mix of local and global vertex indices.

---

## FH-005: "Gap-based loop splitting works"

**Hypothesis**: Loops can be detected by analyzing the normal vector gap between adjacent vertices.

**Evidence against**:
- Diagnostic script proved gap detection fires on strip diagonals, not actual hole boundaries
- The normal-based approach produces incorrect sub-loop boundaries

**Status**: DISPROVEN. Post-normal slicing mask (Block 2) is the correct approach.

---

## FH-006: "The face type marker is [12, 100, 2, vc] at face start"

**Hypothesis**: The face type marker `[12, 100, 2, vertexCount]` is at the beginning of each face block.

**Evidence against**:
- Forensic dump shows the face block starts with `[edgeCount, 100, 2, vc]`
- The `12` is at the END of the previous face block (or in the gap marker)
- The scanner searches for `[12, 0, 0, 0, 100, 0, 0, 0]` which is the gap marker pattern

**Status**: DISPROVEN. The face type marker is in the gap, not at the face start.

---

## FH-007: "Block 1 N / vertexCount is constant"

**Hypothesis**: The ratio B1_N / vc is constant across all faces.

**Evidence against**:
- BOTTOM: ratios range from 1.500 (vc=4) to 1.960 (vc=50)
- GEAR: ratios range from 1.500 to 2.0+
- The ratio depends on the number of sub-loops, not just vertex count

**Status**: DISPROVEN. The ratio varies with face complexity.

---

## FH-008: "Block 1 encodes face normals"

**Hypothesis**: Block 1 contains per-vertex normal vector data.

**Evidence against**:
- Block 1 values are predominantly 0 and 1 (88–96% zeros in many faces)
- Normal vectors would be float32 values in the range [-1, 1]
- Block 1 values are u32 integers, many > 255

**Status**: DISPROVEN. Normals are stored separately in the normal array.

---

## FH-009: "Block 1 encodes UV coordinates"

**Hypothesis**: Block 1 contains texture coordinate data.

**Evidence against**:
- UV coordinates would be float32 values
- Block 1 values are u32 integers
- The ONE delimiter pattern doesn't make sense for UV data

**Status**: DISPROVEN. Block 1 encodes topology, not UV data.

---

## FH-010: "Block 1 is a fixed-size record format"

**Hypothesis**: Block 1 has a fixed record size (e.g., 4 u32s per edge).

**Evidence against**:
- For single-loop faces (vc=4): B1_N=6, so 6/1=6 u32s per loop
- For multi-loop faces (vc=75): B1_N=132, so 132/9=14.7 u32s per loop
- The record size varies between faces

**Status**: DISPROVEN. Block 1 has variable-length records.

---

## FH-011: "Block 2 raw values encode vertex indices"

**Hypothesis**: Block 2 raw values are vertex indices.

**Evidence against**:
- Block 2 raw values are always small (4–46 in BOTTOM)
- The formula `vc = (raw + 2) / 2` maps them to vertex counts (3–24)
- These are sub-loop vertex counts, not indices

**Status**: DISPROVEN. Block 2 encodes sub-loop vertex counts.

---

## FH-012: "The DisplayLists stream contains only face data"

**Hypothesis**: The main DisplayLists stream contains only face geometry.

**Evidence against**:
- BOTTOM: 156 face markers found, but only 39 faces parsed
- The stream contains 11 `[1,1]` headers (section separators)
- The stream contains strings like `uiUserModelEnv_c`, `moAmbientLight_c`, `uoBodyPropInfo_c`
- The stream has significant structure beyond just face data

**Status**: DISPROVEN. The DisplayLists contains metadata, class names, and section headers.

---

## FH-013: "Block 1 values are property table indices"

**Hypothesis**: Block 1 values are indices into a global property table stored in the pre-face region. Value V → table[base + V * 4] returns a property (flag, string, or float).

**Evidence against**:
- Random bases give identical scores (GEAR: median=87.7%, p95=99.2%, max=99.9% for 200 random bases)
- The "table score" is just value frequency — B1=1 (delimiter) dominates the score
- B1=1 appears at fixed structural positions (0, 4, 6, 8), not arbitrary property indices
- DEKOR base 80424 is not special — all bases 80300-80500 give 87-89% score
- The grammar (ONE delimiters, section counts, Block 2 correlation) is a topology pattern, not a property pattern
- "Consistency" test is trivially true for any memory read f(x) = mem[base + x*4]
- Decoded "text strings" (Show2, templatewidth) are at indices NOT referenced by any Block 1 value

**Root cause**: The scoring method measures whether B1 values are concentrated (most are the same number), not whether they index a real table. Since B1=1 is the delimiter and appears ~20% of the time, any base gives a high score.

**Status**: REJECTED. Block 1 values are part of a topology encoding system, not property indices.

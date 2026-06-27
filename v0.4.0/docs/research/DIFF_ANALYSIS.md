# Block 1 Differential Analysis Report (v0.4.0)

## Corpus

| File | Faces |
|------|-------|
| BOTTOM | 39 |
| TOP | 68 |
| GEAR | 113 |
| DEKOR | 373 |
| **Total** | **593** |

---

## Phase 1: Intra-file Structural Clones

Faces grouped by structural key: `vc_ec_b1len_b2len`.

| Metric | Value |
|--------|-------|
| Pairs analyzed | 646 |
| Zero-diff (identical Block 1) | 646 (100%) |
| Non-zero-diff | 0 (0%) |

**Observation:** Every pair of faces with identical structural signature has identical Block 1 data. No exceptions across 593 faces in 4 files.

---

## Phase 2: Inter-file Geometry Matching

Faces matched by structural key across different files, then by closest geometry.

| Metric | Value |
|--------|-------|
| Pairs analyzed | 162 |
| Zero-diff | 0 (0%) |
| Non-zero-diff | 162 (100%) |

**Observation:** No two faces from different files share identical Block 1 data, even when they have the same structural key and similar geometry.

---

## Phase 3: VALUE Position Stability

For each position within each section, tracked across all intra-file pairs:

| Stability Class | Count | Percentage |
|----------------|-------|------------|
| Always stable (0% change) | 462 | 43.3% |
| Sometimes changed | 230 | 21.6% |
| Always changed (100% change) | 375 | 35.1% |

| Statistic | Value |
|-----------|-------|
| Total position-tracks | 1067 |
| Median change rate | 50.0% |
| Min change rate | 0.0% |
| Max change rate | 100.0% |

**Observation:** Positions split into three stability classes. 43% of positions are always identical between structural clones. 35% always differ. 22% vary.

---

## Phase 4: Section Diff Patterns

For sections that changed between structural clones:

| Metric | Value |
|--------|-------|
| Total changed sections | 6065 |
| Distinct diff patterns | 152 |

### Top 20 Diff Patterns

| Count | Pattern | Interpretation |
|-------|---------|----------------|
| 1869 | `VZV→VZV` | Same classification, different values |
| 1545 | `VVZVV→VVZVV` | Same classification, different values |
| 672 | `ZVZVZVV→ZVZVZVV` | Same classification, different values |
| 406 | `ZVZVZVZVZVV→ZVZVZVZVZVV` | Same classification, different values |
| 227 | `VVZVZVZVZZV→ZVZVZVZVZVV` | Pattern changed |
| 189 | Long alternating→Long alternating | Same classification, different values |
| 152 | `ZVZVZVZVZVV→VVZVZVZVZZV` | Pattern changed |
| 91 | `VVZVZVZVZZV→VVZVZVZVZZV` | Same classification, different values |
| 78 | `VZZVZVZ→VZZVZVZ` | Same classification, different values |
| 66 | `ZVZVZVZVZVZVZVV→ZVZVZVZVZVZVZVV` | Same classification, different values |

**Observation:** 80%+ of changed sections preserve their classification pattern (V/Z sequence). Only the VALUE tokens change, not their positions.

---

## Key Findings

### F1: Intra-file Identity
Faces with identical structural signature (vc, ec, b1len, b2len) always have identical Block 1. This is 100% consistent across 646 pairs.

### F2: Inter-file Uniqueness
No two faces from different files share identical Block 1 data. Even structurally identical faces in different files have different VALUEs.

### F3: Pattern Preservation
When VALUEs change between structural clones, the classification pattern (V/Z sequence) is preserved in 80%+ of cases. The encoder changes VALUES but not their positions.

### F4: Position Stability Classes
VALUE positions split into three classes:
- Always stable (43%) — likely structural constants
- Always changed (35%) — likely file-specific parameters
- Sometimes changed (22%) — context-dependent

### F5: No Section Insertion/Deletion
Between structural clones, no sections are inserted or deleted. Only VALUEs within existing sections change.

---

## Observations (not interpreted)

1. Block 1 is file-local: each file generates unique VALUEs for identical face structures
2. Block 1 preserves pattern: the V/Z classification is determined by face structure, not file identity
3. Block 1 has stable positions: some VALUE positions are identical across all instances of a face structure
4. Block 1 has unstable positions: some VALUE positions differ for every instance
5. Block 1 has no structural variation: section count and lengths are identical for identical structural signatures

# Block 1 Universe Discovery — Candidate Object Universes

## Method
Scanned the entire decompressed DisplayLists for every structure that could own IDs in the Block 1 value range. Seven scans applied to all 4 files. No semantics assigned.

## Summary of Candidate Universes

### CANDIDATE 1: Record arrays in non-face regions (STRONGEST)

**Evidence:** DEKOR non-face region (70.3% of stream = 812KB) contains:

| Value | Frequency | Spacing | Record size |
|-------|-----------|---------|-------------|
| 63 | 8,087 | 12 bytes, 92% regular | 12-byte records |
| 191 | 2,230 | 12 bytes, 66% regular | 12-byte records |
| 190 | 1,259 | 12 bytes, 40% regular | 12-byte records |
| 62 | 1,128 | 12 bytes, 40% regular | 12-byte records |

These values are NOT in Block 1. They are structural constants that appear at regular 12-byte intervals — consistent with a record array where offset = value × 12.

** BOTTOM (max B1=1386):** Value 1141 appears 48 times at delta=16 (98% regular). Value 1356 appears 48 times at delta=16 (87% regular). These are 16-byte record arrays.

**GEAR (max B1=3478):** Value 3001 appears 157 times at delta=8 (65% regular). Value 3002 appears 89 times. These are 8-byte record arrays.

### CANDIDATE 2: Power-of-2 aligned structures (DEKOR-specific)

**Evidence:** DEKOR non-face region contains power-of-2 values at high frequency:

| Value | Frequency | Notes |
|-------|-----------|-------|
| 256 | 3,368 | 2^8 |
| 512 | 2,465 | 2^9 |
| 1024 | 1,820 | 2^10 |
| 2048 | 1,596 | 2^11 |
| 3072 | 960 | 3 × 2^10 |
| 1280 | 525 | 5 × 2^8 |
| 768 | 447 | 3 × 2^8 |
| 2560 | 409 | 10 × 2^8 |

These are NOT in Block 1. They appear to be size/capacity fields in a structure with power-of-2 alignment.

### CANDIDATE 3: [4,8,2,N] header arrays outside face blocks

**Evidence:**

| File | Total [4,8,2,...] | Outside face blocks | Notable N values |
|------|-------------------|--------------------|--------------------|
| BOTTOM | 117 | 39 | 41, 9, 8, 10 |
| TOP | 204 | 68 | 31, 5, 3, 1 |
| GEAR | 339 | 113 | 2, 1 |
| DEKOR | 1,125 | 379 | 1044, 9636, 1 |

These [4,8,2,N] patterns are the same header format as Block 1/Block 2 headers. The 379 instances outside face blocks in DEKOR suggest additional record arrays with the same structure.

### CANDIDATE 4: Small-value structural constants

**Evidence (all files):**

| Value | BOTTOM freq | TOP freq | GEAR freq | DEKOR freq |
|-------|-------------|----------|-----------|------------|
| 1 | 286 | 728 | 1,271 | 212 |
| 2 | 212 | 309 | 603 | — |
| 4 | 108 | 260 | 581 | — |
| 8 | 133 | 292 | 459 | — |
| 12 | 97 | 190 | 321 | — |
| 100 | 105 | 161 | 318 | — |

These are NOT vertex indices. They are structural markers that appear throughout the stream — likely type codes, flags, or header fields.

### CANDIDATE 5: Pre-face data regions

**Evidence:**

| File | Pre-face bytes | % of stream | First [4,8,2,N] offset |
|------|---------------|-------------|------------------------|
| BOTTOM | 6,046 | 6.1% | 6,030 |
| TOP | 5,868 | 2.1% | 5,732 |
| GEAR | 103,774 | 19.4% | 103,754 |
| DEKOR | 427,182 | 37.0% | 427,166 |

The pre-face region is substantial — up to 37% of the stream for DEKOR. It contains [4,8,2,N] headers and u32 values in the B1 range, but no face geometry.

## Cross-file correlation

The same structural constants appear across files:
- Value 100 appears in all 4 files (structural marker, not a vertex)
- Value 12 appears in all 4 files
- [4,8,2,N] header format is universal
- Record array patterns (regular delta) appear in all files

## What Block 1 values are NOT

- NOT vertex indices into the parser vertex table (1.3% edge match, 46.5% out of range)
- NOT small structural constants (values go up to 20,142)
- NOT face-local indices (0% match)

## What remains plausible

1. **Handle/reference IDs** into an entity table stored elsewhere in the SLDPRT (possibly encrypted Config-0-Partition)
2. **Byte offsets** divided by a record stride (e.g., value × 12 = byte offset into a 12-byte record array)
3. **Indices into a virtual table** that is reconstructed at load time from the [4,8,2,N] header arrays
4. **Tokens in a stack-based encoding** where values are operands/opcodes, not addresses

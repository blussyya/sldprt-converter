# FALSIFICATION REPORT: Block 1 Property Table Hypothesis

## Hypothesis (REJECTED)
Block 1 values are property indices into a global table stored in the pre-face region.
Value V → table[base + V * 4] returns a property (flag, string, or float).

## Falsification Results

### FALSIFICATION 1: Random bases give identical scores
**Evidence:** 200 random bases tested per file.
- GEAR: median=87.7%, p95=99.2%, max=99.9%
- DEKOR: median=57.0%, p95=85.4%, max=87.8%

**Implication:** The 100% score at base=76696 is NOT special. Almost ANY base gives a high score. The "table" is not a real structure — it's the raw data being read at arbitrary offsets.

### FALSIFICATION 2: Score is just value frequency, not table structure
**Evidence:** Most common B1 value per file:
- BOTTOM: B1=1 appears 184/1700 (10.8%)
- TOP: B1=1 appears 859/3701 (23.2%)
- GEAR: B1=1 appears 1214/4580 (26.5%)
- DEKOR: B1=1 appears 1172/9622 (12.2%)

**Implication:** The "table score" is really just "what fraction of B1 values are the same number." Since B1=1 (the delimiter) is the most common value, it dominates the score. Any base will give a high score because most B1 values are 1, so they all read the same byte offset.

### FALSIFICATION 3: B1=1 is a structural delimiter, not a property index
**Evidence:** Position distribution of B1=1 across all files:
- Position 0: 100% (BOTTOM: 39/39, TOP: 68/68, GEAR: 113/113, DEKOR: 373/373)
- Position 4: ~40-68% (GEAR: 46/113, DEKOR: 249/373)
- Position 8: ~34-68% (GEAR: 39/113, DEKOR: 72/373)
- Position 6: ~3-6% (GEAR: 4/113, DEKOR: 23/373)

**Implication:** B1=1 appears at FIXED STRUCTURAL POSITIONS (0, 4, 6, 8), not at arbitrary property indices. This is a grammar pattern (delimiter positions), not a property lookup pattern.

### FALSIFICATION 4: DEKOR base is not unique
**Evidence:** Bases 80300-80500 all give 87-89% score with dominant value 0xbf80.

**Implication:** The base offset 80424 is not special. Any offset in that region works because the data is similar (it's all part of the same data structure). The "table" is not a distinct structure at a specific offset.

### FALSIFICATION 5: Grammar doesn't arise from property indexing
**Known invariants:**
1. Every section starts with B1=1 (ONE delimiter)
2. Section count = Block 2 entry count
3. ONE count per section = 1
4. section_length = Block 2 raw value

**These are STRUCTURAL patterns:**
- ONE (value 1) is a delimiter that separates sections
- Block 2 encodes section lengths (how many items follow each delimiter)
- The grammar describes a recursive/nested structure (sections within sections)

**Property indexing does NOT explain:**
- Why every section starts with value 1
- Why Block 2 counts sections
- Why ONE count per section is always exactly 1
- Why section_length = Block 2 raw value

### FALSIFICATION 6: "Consistency" is trivially true
**Evidence:** GEAR: 284 consistent, 0 inconsistent. DEKOR: 1044 consistent, 0 inconsistent.

**Implication:** This is trivially true for ANY function f(x) = memory[base + x * 4]. Reading the same byte offset always returns the same bytes. This proves nothing about a "table" — it just proves that memory reads are deterministic.

## Additional Evidence Against

### The "text strings" are not properties
The decoded UTF-16 strings ("Show2=01 199 199", "templatewidth=0.279400") are at indices 1155-1258 in the GEAR table. But these indices are NOT referenced by any Block 1 value. They're just data that happens to be in the same memory region.

### The "flag value" 0xf700f7f7 is not a property
GEAR's dominant table value 0xf700f7f7 is just the u32 value at those byte offsets. It's not a "flag" — it's the raw data. The fact that it appears at many offsets is because the data at those offsets is similar (part of the same structure).

### BOTTOM/TOP scores are explained by value frequency
BOTTOM gets 0% because B1=1 is only 10.8% of values, and there's no single dominant non-zero value. TOP gets 0% for the same reason. The score is purely about value distribution, not table structure.

## Verdict

**The property table hypothesis is REJECTED.**

The hypothesis fails because:
1. Random bases give identical scores — the "table" is not real
2. Scores come from value frequency, not table structure
3. B1=1 is a structural delimiter, not a property index
4. The grammar is a topology encoding pattern, not a property pattern
5. The "consistency" test is trivially true for any memory read

## What Block 1 Values Actually Are

Block 1 values are part of a TOPOLOGY ENCODING system:
- Value 1 (ONE) is a delimiter that separates topological sections
- Other values encode topological relationships (vertex indices, edge indices, or loop descriptors)
- Block 2 encodes section lengths (how many items follow each delimiter)
- The grammar describes a nested/recursive topological structure

The "table" at any base is just the raw DisplayLists data being misinterpreted as a property store.

## Files
- `falsify_property_table.js` — falsification experiments
- This document — formal rejection

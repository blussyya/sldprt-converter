# Formal Language Characterization of Block 1

## Observations (measured, not interpreted)

### O1: Section lengths are exclusively odd
Every observed section length is odd: 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, ...
No even section length exists in 3429 sections across 4 files.

Distribution peaks: 3 (25.7%), 7 (24.1%), 11 (14.5%), 15 (5.4%), 19 (2.8%), 23 (2.6%), 25 (2.1%).

### O2: Positional entropy follows a 4-period pattern
| Position mod 4 | Example positions | Entropy range | Character |
|----------------|-------------------|---------------|-----------|
| 0 | 0, 4, 8, 12, 16 | 0.33–6.35 | Mixed (data slots at 0, 3; zero slots at 4, 8, 12, 16) |
| 1 | 1, 5, 9, 13 | 3.94–5.94 | Medium entropy |
| 2 | 2, 6, 10, 14 | 1.71–3.23 | Low entropy (ZERO-dominated) |
| 3 | 3, 7, 11, 15 | 5.47–7.39 | High entropy (data-rich) |

Positions 4k+2 and 4k (for k≥1) are ZERO-dominated. Positions 4k+3 are data-rich.

### O3: LARGE tokens are isolated
Transitions from LARGE class:
- LARGE → ZERO: 13187 (81.5%)
- LARGE → LARGE: 841 (5.2%)
- LARGE → END: remainder

81.5% of LARGE tokens are immediately followed by ZERO. LARGE values rarely appear consecutively.

### O4: ZERO is omnipresent and runs 1–3 deep
- 100% of sections contain ZERO
- ZERO run lengths: singles=11020, pairs=2197, triples=761
- No runs of 4 or more ZEROs observed

### O5: 8 distinct contexts suffice
The set of (current_class, next_class) pairs observed:
1. ONE → LARGE
2. ONE → ZERO
3. LARGE → LARGE
4. LARGE → ZERO
5. ZERO → LARGE
6. ZERO → ZERO
7. LARGE → END
8. ZERO → END

### O6: Context sensitivity is absent
For every tested token (113, 103, 13558, 13545, 108), the set of following tokens is identical across all positions where that token appears. Token identity alone determines the set of possible successors.

Example: token 113 at positions 1,3,5,7,...,130 — always followed by {0}. Never followed by any other value.

### O7: Section length does NOT equal Block 2 value
0.0% match rate. For BOTTOM face0: section length=5, Block 2=[6]. The previous invariant "section_length = Block 2 raw value" is DISPROVEN when sections are split by ONE delimiters.

### O8: First token predicts section length poorly
789 distinct first tokens observed. The most common first token (0) appears in sections of length 3–215. First token alone is insufficient to determine section length.

### O9: Bracket patterns dominate
- Sections containing ZERO–nonZERO–ZERO bracketing: 5536 instances
- Sections with no bracketing (linear): 434 instances

### O10: Alphabet is large but sparse
- Token alphabet: 1571 unique values
- 3429 sections, 43365 total non-ONE tokens
- Most tokens are LARGE (>100): 16174 occurrences
- ZERO dominates: 27191 occurrences (62.7% of all tokens)

## Structural Invariants (100% match across 4 files, 593 faces, 3429 sections)

### I1: b1len = 2 × (vertexCount - sectionCount)
Block 1's u32 count equals twice the face's vertex count minus twice the number of ONE-delimited sections.

### I2: sectionLength[i] = block2[i] - 1
Each Block 2 value is exactly 1 more than the corresponding section's length (number of non-ONE tokens).

### I3: sum(block2) = b1len
The sum of all Block 2 values equals Block 1's u32 count. (Follows from I1 + I2.)

### I4: ZEROs prefer even positions, LARGE values prefer odd positions
Within each section (0-indexed): 70.3% of ZEROs at even positions, 73.6% of LARGE values at odd positions.

## Measurable Properties

| Property | Value |
|----------|-------|
| Token alphabet size | 1571 |
| Section count | 3429 |
| Section length range | 3–215 (all odd) |
| Sections with ZERO | 100.0% |
| ZERO frequency | 62.7% |
| LARGE frequency | 37.3% |
| Distinct contexts | 8 |
| Bracket pattern count | 5536 |
| Multi-position tokens | 836 |
| Transition entropy (LARGE→) | 0.327 bits |
| Transition entropy (ZERO→) | 1.000 bits |

## Structural Classification

**Section lengths are odd.** This is the strongest observed constraint. Every section has 2k+1 tokens for some k.

**ZERO separates LARGE values.** LARGE → ZERO at 81.5%. LARGE → LARGE at 5.2%. LARGE values are isolated by ZEROs.

**The language is regular.** Context sensitivity is absent (O6). The same token at any position yields the same successor set. An FSM with ≤8 states accepts all observed sections.

**ZERO is a separator, not a delimiter or terminator.** Evidence:
- ZERO appears in runs of 1–3 (O4), not just at boundaries
- ZERO → ZERO at 46.7% (frequent), ZERO → LARGE at 48.6% (also frequent)
- 100% of sections contain ZERO (O4), so ZERO cannot be a section boundary
- ONE is the section delimiter (every section starts after ONE)

**Nesting exists but is position-based.** Bracket patterns (O9) indicate nested structure. But since all ZEROs are identical and context-free (O6), nesting must be resolved by position (counting), not by token identity.

## What is NOT determined

- Whether LARGE values are vertex indices, edge indices, or something else
- What the 4-period positional pattern represents
- What Block 2 values encode (they do NOT equal section lengths)
- Whether the language is inherently ambiguous
- The minimal number of FSM states (8 is an upper bound)

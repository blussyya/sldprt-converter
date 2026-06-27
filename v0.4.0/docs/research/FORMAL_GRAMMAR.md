# Formal Grammar Characterization (v0.4.0)

## Grammar Type

Block 1 is an **indexed grammar** (also called an attribute grammar). This is a strict superset of context-free grammars where non-terminal symbols carry integer attributes that influence production rule selection.

## Grammar Definition

### Terminals
- `V` = VALUE (any non-zero, non-one u32)
- `Z` = ZERO (0)

### Non-terminals
- `S_L` = section with length attribute L
- `P_L,k` = production rule for length L, VALUE count k

### Production Rules (observed)

For each section length L, there exist multiple production rules P_L,1, P_L,2, ..., P_L,m where m is the number of distinct patterns for that length.

**Example: L=3 (5 rules)**
```
S_3 → V Z V     (338x, k=2)
S_3 → V Z Z     (272x, k=1)
S_3 → Z Z V     (131x, k=1)
S_3 → Z V Z     (51x, k=1)
S_3 → Z Z Z     (90x, k=0)
```

**Example: L=7 (26 rules)**
```
S_7 → V Z Z V Z Z V     (197x, k=3)
S_7 → Z V Z V Z V Z     (149x, k=3)
S_7 → V Z Z V Z V Z     (112x, k=3)
S_7 → V V Z V Z V Z     (48x, k=4)
S_7 → Z V Z V Z V V     (66x, k=4)
... (21 more rules)
```

**Example: L=25 (5 rules)**
```
S_25 → V Z Z Z...Z V     (61x, k=2)
S_25 → V Z Z Z...Z       (3x, k=1)
S_25 → V V Z V Z...Z V   (6x, k=12)
S_25 → V Z Z V Z...Z V   (1x, k=3)
S_25 → V Z Z V Z...Z     (1x, k=2)
```

### Attribute Rules

The attribute k (VALUE count) satisfies:
- For L=3: k ∈ {0, 1, 2}
- For L=5: k ∈ {0, 1, 2, 3, 4, 5}
- For L=7: k ∈ {0, 1, 2, 3, 4}
- For L=25: k ∈ {1, 2, 3, 12}

The relationship between L and k is:
- k_min = 0 (all ZEROs)
- k_max = L (all VALUEs, though this is rare)
- k_typical = ceil(L/3) to floor(L/2) for most sections

### Semantic Constraints

1. **Odd length constraint:** L is always odd (L = 2m+1 for some m ≥ 1)
2. **ZERO omnipresence:** k < L (at least one ZERO per section)
3. **VALUE isolation:** In alternating patterns, VALUEs are separated by exactly one ZERO
4. **ZERO runs:** Maximum ZERO run length is L-2 (when k=1)

## Grammar Family

The grammar belongs to the class of **indexed grammars** (IG), which are equivalent to:
- Nested stack automata
- Threaded grammars
- Attribute grammars with synthesized attributes

### Why not regular?
- Section length alone doesn't determine pattern
- Need attribute k to select production rule

### Why not context-free?
- Standard CFGs have fixed production rules per non-terminal
- Block 1 has multiple rules per non-terminal (indexed by k)

### Why indexed?
- Non-terminal S_L carries attribute k
- Production rule P_L,k depends on both L and k
- This is exactly the definition of indexed grammars

## Complexity

| Metric | Value |
|--------|-------|
| Distinct non-terminals | 53 (one per length) |
| Total production rules | 200+ |
| Average rules per non-terminal | 3.8 |
| Maximum rules per non-terminal | 40+ (L=11) |
| Minimum rules per non-terminal | 1 (L=73, 77, 85, 87, etc.) |

## Decision Problem

**Question:** Given a section of length L, can we determine which production rule was used?

**Answer:** No, not from length alone. We need the additional attribute k (VALUE count).

**Algorithm:**
1. Count VALUE tokens in section → k
2. Look up pattern for (L, k) in grammar table
3. Verify pattern matches

This is O(L) time per section, O(1) space for grammar table.

## Relationship to Block 2

Block 2 values determine section lengths (b2[i] = L_i + 1). But Block 2 does NOT determine the production rules. The rules depend on an additional attribute (k) that is not encoded in Block 2.

This suggests Block 2 is a **length array** while Block 1 encodes both lengths AND patterns.

## Implications for Decoding

To decode Block 1, we need:
1. Block 2 → section lengths (proven)
2. Section length + VALUE count → production rule (proven)
3. Production rule → token sequence (trivial)
4. Token sequence → geometric meaning (UNKNOWN)

Step 4 remains unsolved. The grammar characterizes the structure but not the semantics.

# Block 1 Grammar Reconstruction

**Status**: Formal syntax analysis complete
**Data**: 5517 sections across 595 faces in 4 files (BOTTOM, TOP, GEAR, DEKOR)
**Protocol**: Read-only forensic analysis. No semantics assigned.

---

## 1. Structural Invariants

### INV-001: Length Formula

```
section_length = 2 × loopSize - 2
```

Where `loopSize` = Block 2 entry value for this section.

- **Evidence**: 5517/5517 sections. Zero counterexamples.
- **Confidence**: VERY HIGH

This is the strongest invariant. Section length uniquely determines loop size and vice versa.

### INV-002: First Token

Every section starts with ONE (value 1).

- **Evidence**: 5517/5517 sections.
- **Confidence**: VERY HIGH

### INV-003: Token Alphabet

Sections contain exactly 4 token types: ONE, ZERO, LARGE, SMALL.

- ONE: Always exactly 1 per section (the delimiter)
- ZERO: 47.5% of all tokens
- LARGE: 50.8% of all tokens
- SMALL: 1.7% of all tokens (only in GEAR file)

### INV-004: Total Token Count

```
ONE_count + ZERO_count + LARGE_count + SMALL_count = section_length
```

This is tautological but confirms no hidden tokens exist.

---

## 2. Positional Grammar

### 2.1 Position Classes

Positions within a section fall into 4 classes:

| Position | Class | Typical tokens | Count |
|----------|-------|---------------|-------|
| 0 | HEADER | ONE (always) | 1 |
| 1 | EDGE_START | LARGE or ZERO | 1 |
| 2 | EDGE_END | ZERO or LARGE | 1 |
| 3..len-2 | BODY | Alternating ZERO/LARGE | len-4 |
| len-1 | TERMINUS | LARGE or ZERO | 1 |

### 2.2 Body Position Pattern

Within the body (positions 3 through len-2), positions follow a strict alternating pattern:

- **Odd positions** (3, 5, 7, ...): LARGE or SMALL
- **Even positions** (4, 6, 8, ...): ZERO or LARGE

This creates the characteristic `ZERO LARGE ZERO LARGE` alternation.

### 2.3 Position-Dependent Rules

For sections with loopSize ≥ 4:

```
Position 0:  ONE           (always)
Position 1:  LARGE | ZERO  (edge start)
Position 2:  ZERO | LARGE  (edge end)
Position 3:  LARGE | SMALL (body, odd)
Position 4:  ZERO | LARGE  (body, even)
Position 5:  LARGE | SMALL (body, odd)
Position 6:  ZERO | LARGE  (body, even)
...
Position len-2: ZERO | LARGE (body, even)
Position len-1: LARGE | ZERO | SMALL (terminus)
```

---

## 3. Grammar Candidates

### Candidate G1: Two-State Alternating Grammar

```
S → ONE E₁ B* T

E₁ → LARGE ZERO | ZERO LARGE | LARGE LARGE | ZERO ZERO

B  → ZERO LARGE | LARGE ZERO | ZERO ZERO | LARGE LARGE

T  → LARGE | ZERO | SMALL
```

Where `B*` produces `(loopSize - 2)` pairs, and the total length is `2 × loopSize - 2`.

**Observation**: This generates the correct length but doesn't capture all valid patterns.

### Candidate G2: Position-Parity Grammar

```
S → ONE P₁ P₂ P₃ P₄ ... P_{len-1}

P₁   → LARGE | ZERO
P₂   → ZERO | LARGE
P_{odd}  → LARGE | SMALL    (for odd i ≥ 3)
P_{even} → ZERO | LARGE     (for even i ≥ 4)
P_{len-1} → LARGE | ZERO | SMALL
```

**Observation**: This captures the positional constraints but allows invalid combinations.

### Candidate G3: Edge-Pair Grammar

```
S → ONE E₁ E₂ ... E_{loopSize-1} T

Eᵢ → LARGE ZERO | ZERO LARGE | LARGE LARGE | ZERO ZERO | ZERO SMALL | LARGE SMALL

T  → LARGE | ZERO | SMALL
```

Where each `Eᵢ` encodes one edge as a pair of tokens.

**Observation**: This maps directly to the edge-count interpretation.

---

## 4. Template Clustering

### 4.1 Top Templates by Frequency

| Rank | Pattern | Count | loopSize | Files |
|------|---------|-------|----------|-------|
| 1 | `ONE LARGE ZERO[2] LARGE ZERO[2] LARGE` | 551 | 5 | all |
| 2 | `ONE LARGE ZERO[2]` | 524 | 3 | all |
| 3 | `ONE LARGE ZERO LARGE` | 380 | 3 | all |
| 4 | `ONE ZERO[2] LARGE` | 237 | 3 | all |
| 5 | `ONE ZERO LARGE ZERO LARGE ZERO LARGE ZERO` | 198 | 5 | all |
| 6 | `ONE ZERO LARGE ZERO LARGE ZERO[2] LARGE` | 172 | 5 | all |
| 7 | `ONE LARGE ZERO[2] LARGE ZERO[3] LARGE ZERO[2] LARGE` | 166 | 7 | all |
| 8 | `ONE LARGE ZERO[2] LARGE ZERO LARGE ZERO` | 141 | 5 | all |
| 9 | `ONE ZERO LARGE ZERO` | 115 | 3 | all |
| 10 | `ONE ZERO[3]` | 109 | 3 | top,gear,dekor |

### 4.2 Template Count by loopSize

| loopSize | Sections | Unique Patterns | Ratio |
|----------|----------|-----------------|-------|
| 3 | 1380 | 9 | 153.3 |
| 4 | 368 | 16 | 23.0 |
| 5 | 1543 | 33 | 46.8 |
| 6 | 275 | 32 | 8.6 |
| 7 | 795 | 62 | 12.8 |
| 8 | 116 | 37 | 3.1 |
| 9 | 295 | 59 | 5.0 |
| 10 | 52 | 26 | 2.0 |
| 14 | 76 | 8 | 9.5 |
| 50 | 36 | 2 | 18.0 |

### 4.3 Key Observation

**Templates are NOT unique per loopSize.** The same loopSize can produce multiple valid patterns. For example, loopSize=3 has 9 distinct patterns across 1380 sections.

However, **a small number of templates dominate**. The top 20 patterns account for a significant fraction of all sections.

---

## 5. Optional Productions

### 5.1 Positional Optionality

For sections with the same loopSize, certain positions have optional tokens:

**loopSize=3 (len=4):**
- Position 1: LARGE | ZERO (both valid)
- Position 2: ZERO | LARGE (both valid)
- Position 3: LARGE | ZERO (both valid)

**loopSize=5 (len=8):**
- Position 1: LARGE | ZERO
- Position 2: ZERO | LARGE
- Position 3: LARGE | SMALL | ZERO
- Position 4: ZERO | LARGE
- Position 5: LARGE | SMALL | ZERO
- Position 6: ZERO | LARGE
- Position 7: LARGE | ZERO

**loopSize=7 (len=12):**
- Position 1: LARGE | ZERO
- Position 2: ZERO | LARGE
- Position 3: LARGE | SMALL
- Position 4: ZERO | LARGE
- Position 5: LARGE | SMALL
- Position 6: ZERO | LARGE
- Position 7: LARGE | SMALL
- Position 8: ZERO | LARGE
- Position 9: LARGE | SMALL
- Position 10: ZERO | LARGE
- Position 11: LARGE | ZERO

### 5.2 Optionality Pattern

The optionality follows a clear pattern:

- **Position 0**: No option (ONE only)
- **Position 1**: LARGE | ZERO (2 options)
- **Position 2**: ZERO | LARGE (2 options)
- **Odd positions ≥ 3**: LARGE | SMALL (2 options, sometimes ZERO)
- **Even positions ≥ 4**: ZERO | LARGE (2 options)
- **Last position**: LARGE | ZERO | SMALL (2-3 options)

### 5.3 Total Valid Combinations

For a section with loopSize=N:
- Position 0: 1 option
- Positions 1-2: 2 × 2 = 4 options
- Body (positions 3 to 2N-4): 2^(2N-6) options
- Last position: 2-3 options

Total theoretical maximum: ~2^(2N-4) patterns per loopSize.

Actual unique patterns are much fewer, suggesting **constraints beyond position parity**.

---

## 6. Recursive/Repeated Subsequences

### 6.1 Most Frequent 2-grams

| 2-gram | Count | Notes |
|--------|-------|-------|
| ZERO LARGE | 18123 | Core alternating pattern |
| LARGE ZERO | 18095 | Core alternating pattern |
| ZERO ZERO | 16854 | Padding/separation |
| ONE LARGE | 3450 | Section start |
| ONE ZERO | 2015 | Section start |
| LARGE LARGE | 970 | Edge pair |
| SMALL ZERO | 495 | GEAR only |
| ZERO SMALL | 493 | GEAR only |

### 6.2 Most Frequent 3-grams

| 3-gram | Count | Notes |
|--------|-------|-------|
| ZERO LARGE ZERO | 14646 | Alternating core |
| LARGE ZERO LARGE | 11350 | Alternating core |
| ZERO ZERO ZERO | 10411 | Padding runs |
| LARGE ZERO ZERO | 5631 | Transition |
| ZERO ZERO LARGE | 5421 | Transition |
| ONE LARGE ZERO | 3073 | Section start |
| ONE ZERO LARGE | 1283 | Section start |

### 6.3 Most Frequent 4-grams

| 4-gram | Count | Notes |
|--------|-------|-------|
| ZERO LARGE ZERO LARGE | 10665 | Alternating core |
| LARGE ZERO LARGE ZERO | 10471 | Alternating core |
| ZERO ZERO ZERO ZERO | 8483 | Padding runs |
| LARGE ZERO ZERO LARGE | 3679 | Transition |
| ONE LARGE ZERO ZERO | 2693 | Section start |

### 6.4 Internal Repetition

- **4137 / 5517 sections** (75%) contain internal repeated subsequences
- The most common repeated subsequence is `ZERO LARGE` (2-gram)

---

## 7. FSM Expressibility

### 7.1 Global Transition Matrix

```
ONE  → LARGE(3450)  ZERO(2015)  SMALL(52)
ZERO → LARGE(18123) ZERO(16854) SMALL(493)
LARGE→ ZERO(18095)  LARGE(970)  SMALL(1)
SMALL→ ZERO(495)    LARGE(1)
```

### 7.2 Determinism Analysis

| Transition | Probability | Deterministic? |
|------------|-------------|----------------|
| ONE → LARGE | 62.5% | NO |
| ONE → ZERO | 36.5% | NO |
| ONE → SMALL | 0.9% | NO |
| ZERO → LARGE | 51.1% | NO |
| ZERO → ZERO | 47.5% | NO |
| ZERO → SMALL | 1.4% | NO |
| LARGE → ZERO | 94.9% | NEAR |
| LARGE → LARGE | 5.1% | NO |
| LARGE → SMALL | 0.0% | YES |
| SMALL → ZERO | 99.8% | NEAR |
| SMALL → LARGE | 0.2% | YES |

**No transition is fully deterministic.** The closest is `SMALL → ZERO` (99.8%) and `LARGE → ZERO` (94.9%).

### 7.3 NFA vs DFA

The grammar is **non-deterministic**. A DFA would require tracking the current position parity (even/odd) to determine valid next tokens.

**Proposed NFA states:**

```
State q0: Start (position 0)
  → q1 on ONE

State q1: Edge start (position 1)
  → q2 on LARGE | ZERO

State q2: Edge end (position 2)
  → q3 on ZERO | LARGE

State q3: Body odd (positions 3, 5, 7, ...)
  → q4 on LARGE | SMALL

State q4: Body even (positions 4, 6, 8, ...)
  → q3 on ZERO | LARGE
  → q5 on ZERO | LARGE (if at position len-2)

State q5: Terminus (position len-1)
  → accept on LARGE | ZERO | SMALL
```

### 7.4 Can an FSM Express the Grammar?

**Partially yes.** The grammar can be expressed as an NFA with 6 states, but:
- The NFA needs to know the total length (loopSize) to know when to transition to the terminus
- This makes it a **length-dependent NFA**, which is equivalent to a **pushdown automaton** (PDA) if length is encoded on the stack

**Strictly speaking**: A finite automaton cannot count to arbitrary loopSize. The grammar is **not regular** in the formal language theory sense.

**Practically speaking**: Since loopSize is bounded (typically < 100), a lookup table of DFAs (one per loopSize) would work.

---

## 8. Counterexamples

### CE-001: loopSize=3 with FOUR tokens

Some sections with loopSize=3 have pattern `ONE ZERO[3]` (len=4), which means 3 ZEROs and 0 LARGEs. This contradicts the edge-pair hypothesis.

**Evidence**: 109 sections with pattern `ONE ZERO[3]`.

### CE-002: SMALL tokens in GEAR only

SMALL tokens (2-255) appear only in the GEAR file. This suggests the grammar has a file-dependent variant.

**Evidence**: 546 SMALL values in GEAR, 0 in all other files.

### CE-003: LARGE LARGE at section boundaries

Some sections end with `LARGE LARGE` instead of the expected `ZERO LARGE` or `LARGE ZERO`.

**Evidence**: 970 LARGE-LARGE 2-grams across all files.

### CE-004: Varying patterns for same loopSize

loopSize=3 has 9 distinct patterns across 1380 sections. This means the grammar is not a simple function of loopSize.

**Evidence**: Template clustering analysis.

---

## 9. Experiments Performed

| # | Experiment | Result |
|---|-----------|--------|
| 1 | Section length vs loopSize | Perfect 1:1 mapping (len = 2×ls - 2) |
| 2 | First token analysis | Always ONE |
| 3 | Position-dependent token distribution | Alternating parity pattern |
| 4 | Template clustering | 530 unique patterns, top 20 dominate |
| 5 | Optional production analysis | Position-dependent optionality |
| 6 | 2/3/4-gram frequency | ZERO-LARGE alternation dominates |
| 7 | Internal repetition | 75% of sections have repeated subsequences |
| 8 | FSM transition analysis | Non-deterministic, 6-state NFA possible |
| 9 | Determinism check | No fully deterministic transitions |

---

## 10. Unresolved Questions

### UQ-001: What determines the choice between LARGE and ZERO at optional positions?

At positions where both LARGE and ZERO are valid, what determines which is chosen? Is it:
- Random (data-dependent)?
- Determined by something outside Block 1?
- Determined by earlier tokens in the section?

### UQ-002: What determines the number of ZEROs in padding runs?

Some sections have `ZERO ZERO ZERO` runs of varying length. What controls the run length?

### UQ-003: Why does GEAR have SMALL tokens?

SMALL tokens (2-255) appear only in GEAR. Is this a format version difference? A different encoding? A different data type?

### UQ-004: What is the relationship between the last token and the section's position in the face?

Does the last token depend on:
- Whether this is the first/last section in the face?
- The section index?
- The adjacent sections?

### UQ-005: Can the grammar be expressed as a context-free grammar?

The length dependency suggests the grammar is at least context-sensitive. Can it be expressed as a CFG? As a regular grammar with length constraints?

### UQ-006: Are there long-range dependencies within sections?

Does a token at position 1 influence the token at position len-1? Are there correlations between distant positions?

---

## 11. Confidence Assessment

| Claim | Confidence | Evidence |
|-------|------------|----------|
| len = 2×loopSize - 2 | VERY HIGH | 5517/5517 |
| First token is ONE | VERY HIGH | 5517/5517 |
| Position parity pattern | HIGH | Position-dependent analysis |
| 6-state NFA model | MEDIUM | Transition analysis |
| Templates are loopSize-dependent | HIGH | Clustering analysis |
| Grammar is not regular | HIGH | Length dependency |
| SMALL is file-dependent | HIGH | GEAR-only observation |
| All sections from one grammar | MEDIUM | 530 patterns, but structural consistency |

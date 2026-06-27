#!/usr/bin/env node
/**
 * block1_parser.js — Experimental Block 1 Parser
 * 
 * Treats Block 1 as a formal language, not a topology structure.
 * Parses only from proven structural invariants.
 * Does NOT assign semantics to VALUE tokens.
 * 
 * Produces an AST for every face with:
 * - face metadata (vertexCount, edgeCount, sectionCount)
 * - section list with lengths
 * - VALUE positions
 * - ZERO run lengths
 * - VALUE repetition statistics
 * - positional frequencies
 * 
 * Validates invariants I1, I2, I3 against the entire corpus.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- Decompression (proven) ---

function rolByte(b, s) {
  s &= 7;
  if (!s) return b;
  return ((b << s) | (b >>> (8 - s))) & 0xFF;
}

function findAll(buf, pattern) {
  const r = [];
  for (let i = 0; i <= buf.length - pattern.length; i++) {
    let ok = true;
    for (let j = 0; j < pattern.length; j++) {
      if (buf[i + j] !== pattern[j]) { ok = false; break; }
    }
    if (ok) r.push(i);
  }
  return r;
}

function decompressOpenSX(buffer) {
  const key = buffer[7];
  const magic = [20, 0, 6, 0, 8, 0];
  const streams = {};
  for (const matchPos of findAll(buffer, magic)) {
    const sigStart = matchPos - 4;
    if (sigStart < 0 || sigStart + 30 > buffer.length) continue;
    const compSize = buffer.readUInt32LE(sigStart + 18);
    const nameSize = buffer.readUInt32LE(sigStart + 26);
    if (nameSize > 1024 || compSize > 50e6) continue;
    const nameStart = sigStart + 30;
    const dataStart = nameStart + nameSize;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buffer.length) continue;
    if (buffer.readUInt32LE(sigStart + 14) >= 65536 && compSize > 0) {
      let name = '';
      for (let i = 0; i < nameSize; i++) name += String.fromCharCode(rolByte(buffer[nameStart + i], key));
      if (!name) continue;
      let data;
      try { data = zlib.inflateRawSync(Buffer.from(buffer.subarray(dataStart, dataEnd))); }
      catch { try { data = zlib.inflateSync(Buffer.from(buffer.subarray(dataStart, dataEnd))); } catch { } }
      if (data && data.length > 0 && !streams[name]) streams[name] = data;
    }
  }
  return streams;
}

function findDisplayLists(buffer) {
  const decompressed = decompressOpenSX(buffer);
  for (const [name, data] of Object.entries(decompressed)) {
    if (name.toLowerCase().includes('displaylist') && data.length > 100) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.readUInt32LE(0) === 1 && buf.readUInt32LE(4) === 1) return data;
    }
  }
  return null;
}

// --- Face Block Extraction (proven) ---

const FACE_TYPE_MARKER = Buffer.from([12, 0, 0, 0, 100, 0, 0, 0]);

function extractFaceBlocks(displayLists) {
  const faces = [];
  const matches = findAll(displayLists, FACE_TYPE_MARKER);
  for (const mp of matches) {
    if (mp < 4) continue;
    const edgeCount = displayLists.readUInt32LE(mp - 4);
    if (edgeCount < 1 || edgeCount > 500) continue;
    if (displayLists.readUInt32LE(mp + 8) !== 2) continue;
    const vertexCount = displayLists.readUInt32LE(mp + 12);
    if (vertexCount < 3 || vertexCount > 5000) continue;
    const verticesStart = mp + 16;
    if (verticesStart + vertexCount * 12 > displayLists.length) continue;
    let ok = true;
    for (let i = 0; i < vertexCount; i++) {
      const x = displayLists.readFloatLE(verticesStart + i * 12);
      if (!isFinite(x) || Math.abs(x) > 1e5) { ok = false; break; }
    }
    if (!ok) continue;
    const verticesEnd = verticesStart + vertexCount * 12;
    const gapEnd = verticesEnd + 16;
    const normalsEnd = gapEnd + vertexCount * 12;
    const block1Start = normalsEnd;
    if (block1Start + 16 > displayLists.length) continue;
    if (displayLists.readUInt32LE(block1Start) !== 4) continue;
    if (displayLists.readUInt32LE(block1Start + 4) !== 8) continue;
    if (displayLists.readUInt32LE(block1Start + 8) !== 2) continue;
    const block1Length = displayLists.readUInt32LE(block1Start + 12);
    if (block1Length > 100000) continue;
    if (block1Start + 16 + block1Length * 4 > displayLists.length) continue;
    const block1 = [];
    for (let i = 0; i < block1Length; i++) block1.push(displayLists.readUInt32LE(block1Start + 16 + i * 4));
    const b2Start = block1Start + (block1Length + 4) * 4;
    let block2 = [];
    if (b2Start + 12 <= displayLists.length &&
      displayLists.readUInt32LE(b2Start) === 4 &&
      displayLists.readUInt32LE(b2Start + 4) === 8 &&
      displayLists.readUInt32LE(b2Start + 8) === 2) {
      const b2Len = displayLists.readUInt32LE(b2Start + 12);
      for (let i = 0; i < b2Len; i++) block2.push(displayLists.readUInt32LE(b2Start + 16 + i * 4));
    }
    faces.push({ edgeCount, vertexCount, block1, block2 });
  }
  return faces;
}

// --- AST Construction ---

/**
 * Split Block 1 by ONE (value 1) delimiters into sections.
 * Sections are non-empty token sequences between ONEs.
 */
function splitIntoSections(block1) {
  const sections = [];
  let current = [];
  for (const token of block1) {
    if (token === 1) {
      if (current.length > 0) sections.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

/**
 * Classify tokens: ZERO (0), ONE (1), VALUE (anything else)
 */
function classifyToken(v) {
  if (v === 0) return 'ZERO';
  if (v === 1) return 'ONE';
  return 'VALUE';
}

/**
 * Compute ZERO run lengths within a section.
 * A run is a maximal consecutive sequence of ZEROs.
 */
function zeroRunLengths(section) {
  const runs = [];
  let run = 0;
  for (const v of section) {
    if (v === 0) { run++; }
    else { if (run > 0) runs.push(run); run = 0; }
  }
  if (run > 0) runs.push(run);
  return runs;
}

/**
 * VALUE repetition statistics within a section.
 * How many distinct values, how often each repeats.
 */
function valueRepetitionStats(section) {
  const freq = {};
  let valueCount = 0;
  for (const v of section) {
    if (v !== 0) {
      freq[v] = (freq[v] || 0) + 1;
      valueCount++;
    }
  }
  const distinct = Object.keys(freq).length;
  const maxRepeat = valueCount > 0 ? Math.max(...Object.values(freq)) : 0;
  const repeats = Object.values(freq).filter(c => c > 1).length;
  return { distinct, valueCount, maxRepeat, repeats, freq };
}

/**
 * Positional classification: what token type appears at each position?
 */
function positionalClassification(section) {
  return section.map(v => classifyToken(v));
}

/**
 * Build AST for a single face.
 */
function buildFaceAST(face, faceIndex) {
  const { edgeCount, vertexCount, block1, block2 } = face;
  const sections = splitIntoSections(block1);
  const sectionCount = sections.length;

  // Validate I1: b1len == 2 * (vc - secs)
  const i1 = block1.length === 2 * (vertexCount - sectionCount);

  // Validate I2: for each section, sectionLen == block2[i] - 1
  const i2Results = sections.map((sec, idx) => {
    if (idx >= block2.length) return null;
    return sec.length === block2[idx] - 1;
  });
  const i2 = i2Results.every(r => r === true);

  // Validate I3: sum(block2) == b1len
  const b2Sum = block2.reduce((a, b) => a + b, 0);
  const i3 = b2Sum === block1.length;

  // Build section ASTs
  const sectionASTs = sections.map((sec, idx) => {
    const classifications = positionalClassification(sec);
    const zrl = zeroRunLengths(sec);
    const vrs = valueRepetitionStats(sec);
    const valuePositions = [];
    const zeroPositions = [];
    for (let i = 0; i < sec.length; i++) {
      if (sec[i] === 0) zeroPositions.push(i);
      else valuePositions.push(i);
    }
    return {
      index: idx,
      length: sec.length,
      block2Value: idx < block2.length ? block2[idx] : null,
      i2Match: idx < block2.length ? sec.length === block2[idx] - 1 : null,
      tokens: sec,
      classifications,
      valuePositions,
      zeroPositions,
      zeroRunLengths: zrl,
      zeroRunCount: zrl.length,
      valueStats: vrs,
    };
  });

  return {
    faceIndex,
    vertexCount,
    edgeCount,
    block1Length: block1.length,
    sectionCount,
    block2Values: block2,
    invariants: { i1, i2, i3 },
    sections: sectionASTs,
  };
}

// --- Corpus Analysis ---

function analyzeCorpus(asts) {
  // Positional frequency: across all sections, what % of each position is ZERO/VALUE?
  const posFreq = {};
  let maxLen = 0;
  for (const ast of asts) {
    for (const sec of ast.sections) {
      if (sec.length > maxLen) maxLen = sec.length;
      for (let i = 0; i < sec.length; i++) {
        if (!posFreq[i]) posFreq[i] = { ZERO: 0, VALUE: 0, total: 0 };
        posFreq[i].total++;
        if (sec.tokens[i] === 0) posFreq[i].ZERO++;
        else posFreq[i].VALUE++;
      }
    }
  }

  // ZERO run length distribution
  const runDist = {};
  for (const ast of asts) {
    for (const sec of ast.sections) {
      for (const r of sec.zeroRunLengths) {
        runDist[r] = (runDist[r] || 0) + 1;
      }
    }
  }

  // Section length distribution
  const lenDist = {};
  for (const ast of asts) {
    for (const sec of ast.sections) {
      lenDist[sec.length] = (lenDist[sec.length] || 0) + 1;
    }
  }

  // VALUE repetition: how many sections have at least one repeated VALUE?
  let sectionsWithRepeats = 0;
  let totalRepeats = 0;
  let totalDistinct = 0;
  let totalValueCount = 0;
  for (const ast of asts) {
    for (const sec of ast.sections) {
      if (sec.valueStats.repeats > 0) sectionsWithRepeats++;
      totalRepeats += sec.valueStats.repeats;
      totalDistinct += sec.valueStats.distinct;
      totalValueCount += sec.valueStats.valueCount;
    }
  }

  // Grammar test: do sections with the same length have the same token pattern?
  const patternByLength = {};
  for (const ast of asts) {
    for (const sec of ast.sections) {
      const pattern = sec.classifications.join(',');
      if (!patternByLength[sec.length]) patternByLength[sec.length] = {};
      patternByLength[sec.length][pattern] = (patternByLength[sec.length][pattern] || 0) + 1;
    }
  }

  return {
    positionalFrequency: posFreq,
    maxSectionLength: maxLen,
    zeroRunDistribution: runDist,
    sectionLengthDistribution: lenDist,
    repetitionStats: {
      sectionsWithRepeats,
      totalSections: asts.reduce((a, ast) => a + ast.sections.length, 0),
      totalRepeats,
      totalDistinct,
      totalValueCount,
    },
    patternByLength,
  };
}

// --- Main ---

const RESEARCH_DIR = 'C:\\Users\\basha\\Desktop\\soldiworks research';
const FILES = {
  BOTTOM: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case BOTTOM.SLDPRT'),
  TOP: path.join(RESEARCH_DIR, 'test files original', 'usb hub case (ultimate test)', 'USB hub case TOP.SLDPRT'),
  GEAR: path.join(RESEARCH_DIR, 'test files original', 'Helical Bevel Gear.SLDPRT'),
  DEKOR: path.join(RESEARCH_DIR, 'test files original', 'Dekor.SLDPRT'),
};

const allASTs = [];
let totalFaces = 0, i1Pass = 0, i2Pass = 0, i3Pass = 0;

for (const [name, fp] of Object.entries(FILES)) {
  console.log(`\nProcessing ${name}...`);
  const raw = fs.readFileSync(fp);
  const dl = findDisplayLists(raw);
  if (!dl) { console.log('  No DisplayLists found'); continue; }
  const faces = extractFaceBlocks(dl);
  console.log(`  ${faces.length} faces extracted`);

  for (let i = 0; i < faces.length; i++) {
    const ast = buildFaceAST(faces[i], totalFaces);
    ast.fileName = name;
    allASTs.push(ast);
    totalFaces++;
    if (ast.invariants.i1) i1Pass++;
    if (ast.invariants.i2) i2Pass++;
    if (ast.invariants.i3) i3Pass++;
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`CORPUS: ${totalFaces} faces across ${Object.keys(FILES).length} files`);
console.log(`${'='.repeat(60)}`);
console.log(`I1 (b1len == 2*(vc-secs)):  ${i1Pass}/${totalFaces} (${(100*i1Pass/totalFaces).toFixed(1)}%)`);
console.log(`I2 (secLen == b2-1):        ${i2Pass}/${totalFaces} (${(100*i2Pass/totalFaces).toFixed(1)}%)`);
console.log(`I3 (sum(b2) == b1len):      ${i3Pass}/${totalFaces} (${(100*i3Pass/totalFaces).toFixed(1)}%)`);

// Corpus analysis
const corpus = analyzeCorpus(allASTs);

// Write results
const outputPath = path.join(__dirname, 'docs', 'research', 'BLOCK1_AST.json');
fs.writeFileSync(outputPath, JSON.stringify({
  summary: {
    totalFaces,
    files: Object.keys(FILES),
    invariants: {
      i1: { pass: i1Pass, total: totalFaces },
      i2: { pass: i2Pass, total: totalFaces },
      i3: { pass: i3Pass, total: totalFaces },
    },
  },
  corpus,
  asts: allASTs.map(ast => ({
    faceIndex: ast.faceIndex,
    fileName: ast.fileName,
    vertexCount: ast.vertexCount,
    edgeCount: ast.edgeCount,
    block1Length: ast.block1Length,
    sectionCount: ast.sectionCount,
    block2Values: ast.block2Values,
    invariants: ast.invariants,
    sections: ast.sections.map(sec => ({
      index: sec.index,
      length: sec.length,
      block2Value: sec.block2Value,
      i2Match: sec.i2Match,
      valuePositions: sec.valuePositions,
      zeroPositions: sec.zeroPositions,
      zeroRunLengths: sec.zeroRunLengths,
      valueStats: { distinct: sec.valueStats.distinct, valueCount: sec.valueStats.valueCount, maxRepeat: sec.valueStats.maxRepeat, repeats: sec.valueStats.repeats },
    })),
  })),
}, null, 2));

console.log(`\nAST written to: ${outputPath}`);
console.log(`Corpus analysis written to: ${path.join(__dirname, 'docs', 'research', 'CORPUS_ANALYSIS.md')}`);

// --- Grammar Analysis ---
console.log(`\n${'='.repeat(60)}`);
console.log('GRAMMAR ANALYSIS');
console.log(`${'='.repeat(60)}`);

// Test: does each section length have a unique classification pattern?
let uniquePatternsPerLength = 0;
let totalLengths = 0;
for (const [len, patterns] of Object.entries(corpus.patternByLength)) {
  totalLengths++;
  if (Object.keys(patterns).length === 1) uniquePatternsPerLength++;
}
console.log(`Section lengths with unique pattern: ${uniquePatternsPerLength}/${totalLengths} (${(100*uniquePatternsPerLength/totalLengths).toFixed(1)}%)`);

// Show the patterns for each length
for (const [len, patterns] of Object.entries(corpus.patternByLength).sort((a,b) => Number(a[0]) - Number(b[0]))) {
  const patStr = Object.entries(patterns).map(([p, c]) => `(${c}x) ${p.substring(0, 60)}${p.length > 60 ? '...' : ''}`).join(' | ');
  console.log(`  len=${len}: ${patStr}`);
}

// Repetition stats
console.log(`\nVALUE repetition stats:`);
console.log(`  Sections with repeats: ${corpus.repetitionStats.sectionsWithRepeats}/${corpus.repetitionStats.totalSections}`);
console.log(`  Total VALUE tokens: ${corpus.repetitionStats.totalValueCount}`);
console.log(`  Total distinct VALUES: ${corpus.repetitionStats.totalDistinct}`);
console.log(`  Values repeated at least once: ${corpus.repetitionStats.totalRepeats}`);

// Write CORPUS_ANALYSIS.md
let md = `# Block 1 Corpus Analysis (v0.4.0)\n\n`;
md += `## Invariant Validation\n\n`;
md += `| Invariant | Pass | Total | Rate |\n`;
md += `|-----------|------|-------|------|\n`;
md += `| I1: b1len == 2*(vc-secs) | ${i1Pass} | ${totalFaces} | ${(100*i1Pass/totalFaces).toFixed(1)}% |\n`;
md += `| I2: secLen == b2-1 | ${i2Pass} | ${totalFaces} | ${(100*i2Pass/totalFaces).toFixed(1)}% |\n`;
md += `| I3: sum(b2) == b1len | ${i3Pass} | ${totalFaces} | ${(100*i3Pass/totalFaces).toFixed(1)}% |\n\n`;

md += `## Section Length Distribution\n\n`;
md += `| Length | Count |\n|--------|-------|\n`;
for (const [len, count] of Object.entries(corpus.sectionLengthDistribution).sort((a,b) => Number(a[0]) - Number(b[0]))) {
  md += `| ${len} | ${count} |\n`;
}

md += `\n## ZERO Run Length Distribution\n\n`;
md += `| Run Length | Count |\n|------------|-------|\n`;
for (const [len, count] of Object.entries(corpus.zeroRunDistribution).sort((a,b) => Number(a[0]) - Number(b[0]))) {
  md += `| ${len} | ${count} |\n`;
}

md += `\n## Grammar Determinism Test\n\n`;
md += `Section lengths with unique classification pattern: ${uniquePatternsPerLength}/${totalLengths} (${(100*uniquePatternsPerLength/totalLengths).toFixed(1)}%)\n\n`;

md += `### Patterns by Section Length\n\n`;
for (const [len, patterns] of Object.entries(corpus.patternByLength).sort((a,b) => Number(a[0]) - Number(b[0]))) {
  md += `**Length ${len}:**\n`;
  for (const [p, c] of Object.entries(patterns)) {
    md += `- (${c}x) \`${p}\`\n`;
  }
  md += `\n`;
}

md += `## VALUE Repetition\n\n`;
md += `- Sections with repeated VALUEs: ${corpus.repetitionStats.sectionsWithRepeats}/${corpus.repetitionStats.totalSections}\n`;
md += `- Total VALUE tokens: ${corpus.repetitionStats.totalValueCount}\n`;
md += `- Distinct VALUEs: ${corpus.repetitionStats.totalDistinct}\n`;

md += `\n## Positional Frequency (top 30 positions)\n\n`;
md += `| Position | ZERO% | VALUE% | Samples |\n`;
md += `|----------|-------|--------|---------|\n`;
for (let i = 0; i < Math.min(30, corpus.maxSectionLength); i++) {
  const p = corpus.positionalFrequency[i];
  if (p) {
    md += `| ${i} | ${(100*p.ZERO/p.total).toFixed(1)}% | ${(100*p.VALUE/p.total).toFixed(1)}% | ${p.total} |\n`;
  }
}

fs.writeFileSync(path.join(__dirname, 'docs', 'research', 'CORPUS_ANALYSIS.md'), md);
console.log(`\nCorpus analysis written.`);

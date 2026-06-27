#!/usr/bin/env node
'use strict';

// Decode the "other" values from the GEAR table as ASCII text (UTF-16LE pairs)
const TABLE_BASE = 76696;

// The "other" indices from the analysis
const others = [
  { index: 1153, value: 0xff00f7f7 },
  { index: 1154, value: 0x4916fffe },
  { index: 1155, value: 0x73006400 },
  { index: 1156, value: 0x6f005400 },
  { index: 1157, value: 0x68005300 },
  { index: 1158, value: 0x77006f00 },
  { index: 1159, value: 0x32003d00 },
  { index: 1160, value: 0x31003000 },
  { index: 1161, value: 0x31002000 },
  { index: 1162, value: 0x39003900 },
  { index: 1163, value: 0x31002000 },
  { index: 1164, value: 0x39003900 },
  { index: 1165, value: 0x00002000 },
  { index: 1166, value: 0x05000000 },
  { index: 1167, value: 0xfa000000 },
  { index: 1197, value: 0x01003e00 },
  { index: 1198, value: 0x667f3bc2 },
  { index: 1199, value: 0x3fe6a09e },
  { index: 1233, value: 0x742efffe },
  { index: 1234, value: 0x6d006500 },
  { index: 1235, value: 0x6c007000 },
  { index: 1236, value: 0x74006100 },
  { index: 1237, value: 0x77006500 },
  { index: 1238, value: 0x64006900 },
  { index: 1239, value: 0x68007400 },
  { index: 1240, value: 0x30003d00 },
  { index: 1241, value: 0x32002e00 },
  { index: 1242, value: 0x39003700 },
  { index: 1243, value: 0x30003400 },
  { index: 1244, value: 0x2c003000 },
  { index: 1245, value: 0x65007400 },
  { index: 1246, value: 0x70006d00 },
  { index: 1247, value: 0x61006c00 },
  { index: 1248, value: 0x65007400 },
  { index: 1249, value: 0x65006800 },
  { index: 1250, value: 0x67006900 },
  { index: 1251, value: 0x74006800 },
  { index: 1252, value: 0x30003d00 },
  { index: 1253, value: 0x32002e00 },
  { index: 1254, value: 0x35003100 },
  { index: 1255, value: 0x30003900 },
  { index: 1256, value: 0x50003000 },
  { index: 1257, value: 0x3c000000 },
  { index: 1258, value: 0x40000000 },
];

function decodeU32AsText(val) {
  const lo = val & 0xFFFF;
  const hi = (val >>> 16) & 0xFFFF;
  let s = '';
  for (const c of [lo & 0xFF, (lo >>> 8) & 0xFF, hi & 0xFF, (hi >>> 8) & 0xFF]) {
    s += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.';
  }
  return s;
}

function decodeU32AsFloat(val) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(val, 0);
  return buf.readFloatLE(0);
}

console.log('GEAR TABLE "OTHER" VALUES DECODED');
console.log('Each table entry is 4 bytes (u32 LE)');
console.log('Text is stored as pairs of UTF-16LE characters per u32\n');

console.log('--- TEXT BLOCK 1 (indices 1153-1167) ---');
let text1 = '';
for (const { index, value } of others.filter(o => o.index >= 1153 && o.index <= 1167)) {
  const text = decodeU32AsText(value);
  const flt = decodeU32AsFloat(value);
  const isText = text.replace(/\./g, '').length > 0;
  console.log(`  [${index}] 0x${value.toString(16).padStart(8, '0')} text="${text}" ${isText ? '' : `flt=${flt.toFixed(4)}`}`);
  text1 += text;
}
console.log(`  Full text: "${text1}"`);

console.log('\n--- FLOAT BLOCK (indices 1198-1215) ---');
for (const { index, value } of others.filter(o => o.index >= 1198 && o.index <= 1215)) {
  const flt = decodeU32AsFloat(value);
  const text = decodeU32AsText(value);
  const isText = text.replace(/\./g, '').length > 0;
  console.log(`  [${index}] 0x${value.toString(16).padStart(8, '0')} flt=${flt.toFixed(6)} text="${text}"`);
}

console.log('\n--- TEXT BLOCK 2 (indices 1233-1258) ---');
let text2 = '';
for (const { index, value } of others.filter(o => o.index >= 1233 && o.index <= 1258)) {
  const text = decodeU32AsText(value);
  const flt = decodeU32AsFloat(value);
  const isText = text.replace(/\./g, '').length > 0;
  console.log(`  [${index}] 0x${value.toString(16).padStart(8, '0')} text="${text}" ${isText ? '' : `flt=${flt.toFixed(4)}`}`);
  text2 += text;
}
console.log(`  Full text: "${text2}"`);

// Also check: what about the DEKOR table?
// DEKOR value 0x0000bf80 = 49024
// As half-float (low 16 bits): 0xBF80 = -1.0
console.log('\n--- DEKOR TABLE VALUE ANALYSIS ---');
console.log('DEKOR dominant non-zero value: 49024 (0x0000bf80)');
const dekorLo = 49024 & 0xFFFF; // 0xBF80
const dekorHi = (49024 >>> 16) & 0xFFFF; // 0x0000

// Decode as half-float
function decodeHalfFloat(val16) {
  const sign = (val16 >> 15) & 1;
  const exp = (val16 >> 10) & 0x1F;
  const mantissa = val16 & 0x3FF;
  if (exp === 0) return (sign ? -1 : 1) * Math.pow(2, -14) * (mantissa / 1024);
  if (exp === 31) return mantissa === 0 ? (sign ? -Infinity : Infinity) : NaN;
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + mantissa / 1024);
}

console.log(`Low 16 bits: 0x${dekorLo.toString(16).padStart(4, '0')} = half-float ${decodeHalfFloat(dekorLo).toFixed(6)}`);
console.log(`High 16 bits: 0x${dekorHi.toString(16).padStart(4, '0')} = half-float ${decodeHalfFloat(dekorHi).toFixed(6)}`);
console.log(`As u32 float32: ${decodeU32AsFloat(49024).toFixed(10)}`);

// GEAR flag value analysis
console.log('\n--- GEAR FLAG VALUE ANALYSIS ---');
console.log('GEAR flag value: 4144035831 (0xf700f7f7)');
const gearLo = 4144035831 & 0xFFFF; // 0xf7f7
const gearHi = (4144035831 >>> 16) & 0xFFFF; // 0xf700
console.log(`Low 16 bits: 0x${gearLo.toString(16).padStart(4, '0')} = half-float ${decodeHalfFloat(gearLo).toFixed(6)}`);
console.log(`High 16 bits: 0x${gearHi.toString(16).padStart(4, '0')} = half-float ${decodeHalfFloat(gearHi).toFixed(6)}`);
console.log(`As u32 float32: ${decodeU32AsFloat(4144035831).toFixed(10)}`);

// 65536 = 0x00010000
console.log('\n--- VALUE 65536 ANALYSIS ---');
const v65536Lo = 65536 & 0xFFFF; // 0x0000
const v65536Hi = (65536 >>> 16) & 0xFFFF; // 0x0001
console.log(`Low 16 bits: 0x${v65536Lo.toString(16).padStart(4, '0')} = half-float ${decodeHalfFloat(v65536Lo).toFixed(6)}`);
console.log(`High 16 bits: 0x${v65536Hi.toString(16).padStart(4, '0')} = half-float ${decodeHalfFloat(v65536Hi).toFixed(6)}`);
console.log(`Interpretation: two half-floats (0.0, 1.0)`);

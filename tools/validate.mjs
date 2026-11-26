#!/usr/bin/env node
/**
 * validate.mjs — Structural validation of a generated .sb3.
 *
 * TS port of TACT-AIM-distilled's tools/validate_sb3.py (36 lines),
 * extended with next/parent reference checks and a Scratch-uploadability
 * check (extensions must be exactly ["pen"], i.e. pure Vanilla Scratch
 * 3.0 + pen, no unknown blocks introduced by the generator).
 *
 * Usage: node tools/validate.mjs <file.sb3>
 * Exit code 0 = 0 issues.
 */
import * as fs from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export function readZipEntry(zipPath, entryName) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`EOCD not found in ${zipPath}`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf-8', p + 46, p + 46 + nameLen);
    if (name === entryName) {
      const lhNameLen = buf.readUInt16LE(localOffset + 26);
      const lhExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(comp);
      if (method === 8) return inflateRawSync(comp);
      throw new Error(`unsupported zip method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry ${entryName} not found in ${zipPath}`);
}

export function loadProject(sb3Path) {
  return JSON.parse(readZipEntry(sb3Path, 'project.json').toString('utf-8'));
}

const REPORTER_PREFIXES = ['operator_', 'argument_', 'data_item', 'data_length', 'data_list',
  'sensing_', 'motion_', 'translate_', 'looks_costume', 'looks_backdrop', 'sound_'];

export function validateProject(pj) {
  const issues = [];
  // Scratch uploadability: pure Vanilla + pen only.
  if (JSON.stringify(pj.extensions) !== JSON.stringify(['pen'])) {
    issues.push(`extensions: expected ["pen"], got ${JSON.stringify(pj.extensions)}`);
  }
  for (const t of pj.targets) {
    const b = t.blocks || {};
    const ids = new Set(Object.keys(b));
    const stmtPos = new Set();
    for (const [bid, blk] of Object.entries(b)) {
      if (typeof blk !== 'object' || blk === null) continue;
      if (blk.next) stmtPos.add(blk.next);
      for (const [iname, iv] of Object.entries(blk.inputs || {})) {
        if (iname.startsWith('SUBSTACK') && Array.isArray(iv) && iv.length > 1 && typeof iv[1] === 'string') {
          stmtPos.add(iv[1]);
        }
      }
      if (blk.topLevel) stmtPos.add(bid);
    }
    for (const [bid, blk] of Object.entries(b)) {
      if (typeof blk !== 'object' || blk === null) continue;
      const op = blk.opcode || '';
      if (op.startsWith('argument_reporter') && stmtPos.has(bid)) {
        issues.push(`${t.name}: reporter in statement position: ${op}(${bid}) parent=${blk.parent}`);
      }
      if (blk.next && !ids.has(blk.next)) {
        issues.push(`${t.name}: ${op}(${bid}) next -> MISSING ${blk.next}`);
      }
      if (blk.parent && !ids.has(blk.parent)) {
        issues.push(`${t.name}: ${op}(${bid}) parent -> MISSING ${blk.parent}`);
      }
      for (const [iname, iv] of Object.entries(blk.inputs || {})) {
        if (iname.startsWith('SUBSTACK') || iname === 'custom_block') continue;
        if (Array.isArray(iv)) {
          for (const x of iv.slice(1)) {
            if (typeof x === 'string') {
              if (!ids.has(x)) {
                issues.push(`${t.name}: ${op}(${bid}) input ${iname} -> MISSING ${x}`);
              } else {
                const xb = b[x];
                const xop = xb.opcode || '';
                const isReporter = REPORTER_PREFIXES.some((p) => xop.startsWith(p));
                if (!xb.shadow && !isReporter) {
                  issues.push(`${t.name}: ${op}(${bid}) input ${iname} -> non-reporter ${xop}(${x})`);
                }
              }
            }
          }
        }
      }
    }
  }
  return issues;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const pj = loadProject(file);
  const issues = validateProject(pj);
  console.log(`${file}: ${issues.length} issues`);
  for (const i of issues) console.log(' ', i);
  process.exit(issues.length ? 1 : 0);
}

/**
 * temple.test.ts — Phase-1 regression tests for the Flash engine core.
 *
 * Asserts the temple scene built through the L2 API reproduces the
 * original UE5 hybrid's structural signature (audit/design numbers):
 * 4,196 blocks, 232 variables, 76 lists, 15 warp procedures, and that
 * the baked scene data has the original quad counts. Full equivalence
 * against the original .sb3 is checked by tools/compare-temple.mjs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bakeCinemaScene } from '../src/bake/temple-bake.js';
import { buildTemple } from '../src/scene/temple.js';

test('bake produces the original quad counts and finite values', () => {
  const baked = bakeCinemaScene();
  assert.deepEqual(baked.map((p: unknown[]) => p.length), [90, 2, 3, 60, 5, 8]);
  const walk = (v: unknown): void => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), 'non-finite bake value');
    else if (Array.isArray(v)) v.forEach(walk);
  };
  walk(baked);
});

test('bake is deterministic', () => {
  assert.deepEqual(bakeCinemaScene(), bakeCinemaScene());
});

test('temple project matches the original structural signature', () => {
  const pb = buildTemple();
  const proj = pb.buildProject() as {
    targets: Array<{
      isStage: boolean;
      blocks: Record<string, unknown>;
      variables: Record<string, unknown>;
      lists: Record<string, unknown>;
    }>;
    extensions: string[];
  };
  assert.deepEqual(proj.extensions, ['pen']);
  const sprite = proj.targets.find((t) => !t.isStage)!;
  const blockCount = Object.keys(sprite.blocks).length;
  assert.equal(blockCount, 4196);
  assert.equal(Object.keys(sprite.variables).length, 232);
  assert.equal(Object.keys(sprite.lists).length, 76);
  const procs = Object.values(sprite.blocks).filter(
    (b) => (b as { opcode?: string }).opcode === 'procedures_prototype',
  );
  assert.equal(procs.length, 15);
  // Reference integrity: every next/parent points at an existing block.
  const ids = new Set(Object.keys(sprite.blocks));
  for (const b of Object.values(sprite.blocks)) {
    const blk = b as { next?: string | null; parent?: string | null };
    if (blk.next) assert.ok(ids.has(blk.next), `dangling next ${blk.next}`);
    if (blk.parent) assert.ok(ids.has(blk.parent), `dangling parent ${blk.parent}`);
  }
});

/**
 * demo.test.ts — Phase-2 regression tests: dynamic objects + collision.
 *
 * Asserts the demo scene (temple static scene + DynSceneSpec) builds
 * with the phase-2 structural signature: the 15 temple procedures plus
 * dyn_draw_sphere / dyn_draw_box / dyn_collide, the dyn SoA table with
 * the declared initial values, pen-only extensions, reference
 * integrity, and build determinism. The temple build itself must stay
 * at the phase-1 signature (covered by temple.test.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDemo, demoDynScene } from '../src/scene/demo.js';
import { resolveDynObject } from '../src/scene/dynamic.js';

type Proj = {
  targets: Array<{
    isStage: boolean;
    blocks: Record<string, { opcode?: string; next?: string | null; parent?: string | null; mutation?: { proccode?: string } }>;
    variables: Record<string, [string, unknown]>;
    lists: Record<string, [string, unknown[]]>;
  }>;
  extensions: string[];
};

function demoProject(): { proj: Proj; sprite: Proj['targets'][number] } {
  const proj = buildDemo().buildProject() as Proj;
  const sprite = proj.targets.find((t) => !t.isStage)!;
  return { proj, sprite };
}

test('demo project has the phase-2 structural signature', () => {
  const { proj, sprite } = demoProject();
  assert.deepEqual(proj.extensions, ['pen']);
  assert.equal(Object.keys(sprite.blocks).length, 5293);
  assert.equal(Object.keys(sprite.variables).length, 272);
  assert.equal(Object.keys(sprite.lists).length, 91);
  const procs = Object.values(sprite.blocks)
    .filter((b) => b.opcode === 'procedures_prototype')
    .map((b) => b.mutation?.proccode);
  assert.equal(procs.length, 18);
  for (const p of ['dyn_draw_sphere', 'dyn_draw_box', 'dyn_collide', 'sort_5_objects', 'render_frame', 'draw_quad_3d', 'render_smooth_cylinder']) {
    assert.ok(procs.includes(p), `missing proc ${p}`);
  }
  const ids = new Set(Object.keys(sprite.blocks));
  for (const b of Object.values(sprite.blocks)) {
    if (b.next) assert.ok(ids.has(b.next), `dangling next ${b.next}`);
    if (b.parent) assert.ok(ids.has(b.parent), `dangling parent ${b.parent}`);
  }
});

test('dyn SoA table carries the declared scene, resolved', () => {
  const { sprite } = demoProject();
  const lists = new Map(Object.values(sprite.lists).map(([name, vals]) => [name, vals]));
  const objs = demoDynScene.objects.map(resolveDynObject);
  assert.deepEqual(lists.get('dynKind'), objs.map((o) => o.kindCode));
  assert.deepEqual(lists.get('dynX'), objs.map((o) => o.pos[0]));
  assert.deepEqual(lists.get('dynY'), objs.map((o) => o.pos[1]));
  assert.deepEqual(lists.get('dynZ'), objs.map((o) => o.pos[2]));
  assert.deepEqual(lists.get('dynPush'), objs.map((o) => o.pushable));
  // Vertical half extent: sphere -> radius, cylinder -> height/2, box -> hy.
  assert.deepEqual(lists.get('dynHy'), [0.35, 0.3, 0.75]);
  // Sort rows for dynamic objects are pre-registered as ids 101..103.
  assert.deepEqual(lists.get('objId'), [1, 2, 3, 4, 5, 101, 102, 103]);
  const vars = new Map(Object.values(sprite.variables).map(([name, val]) => [name, val]));
  assert.equal(vars.get('dynN'), 3);
  assert.equal(vars.get('dynFloorY'), demoDynScene.floorY);
  assert.equal(vars.get('dynPR'), 0.35);
});

test('demo build is deterministic', () => {
  const a = JSON.stringify(buildDemo().buildProject());
  const b = JSON.stringify(buildDemo().buildProject());
  assert.equal(a, b);
});

test('resolveDynObject derives collision fields per kind', () => {
  const sph = resolveDynObject({ kind: 'sphere', pos: [0, 0, 0], radius: 0.5, material: { albedo: [1, 0.5, 0] } });
  assert.equal(sph.kindCode, 1);
  assert.deepEqual(sph.col255, [255, 128, 0]);
  const box = resolveDynObject({ kind: 'box', pos: [0, 0, 0], halfExtents: [0.2, 0.4, 0.6], material: { albedo: [0, 0, 0] }, pushable: true });
  assert.equal(box.kindCode, 3);
  assert.equal(box.pushable, 1);
});

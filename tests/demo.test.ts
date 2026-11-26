/**
 * demo.test.ts — Phases 2+3 regression tests: dynamic objects,
 * collision, physics/grab in the demo scene.
 *
 * Asserts the demo scene (temple static scene + DynSceneSpec) builds
 * with the phase-3 structural signature: the 15 temple procedures plus
 * dyn_draw_sphere / dyn_draw_box / dyn_collide / dyn_raycast /
 * dyn_physics / dyn_grab, the dyn SoA table (incl. phase-3 physics
 * columns) with the declared initial values, impact-event store empty
 * at start, debug stage monitors hidden by default and available via
 * the debugMonitors build option, pen-only extensions, reference
 * integrity, and build determinism. The temple build itself must stay
 * at the phase-1 signature (temple.test.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDemo, demoDynScene } from '../src/scene/demo.js';
import { resolveDynObject } from '../src/scene/dynamic.js';
import { bakeCinemaScene } from '../src/bake/temple-bake.js';

type Proj = {
  targets: Array<{
    isStage: boolean;
    blocks: Record<string, { opcode?: string; next?: string | null; parent?: string | null; mutation?: { proccode?: string } }>;
    variables: Record<string, [string, unknown]>;
    lists: Record<string, [string, unknown[]]>;
  }>;
  extensions: string[];
  monitors: Array<{ opcode?: string; params?: Record<string, string> }>;
};

function demoProject(): { proj: Proj; sprite: Proj['targets'][number] } {
  const proj = buildDemo().buildProject() as Proj;
  const sprite = proj.targets.find((t) => !t.isStage)!;
  return { proj, sprite };
}

test('demo project has the phase-3 structural signature', () => {
  const { proj, sprite } = demoProject();
  assert.deepEqual(proj.extensions, ['pen']);
  assert.equal(Object.keys(sprite.blocks).length, 7313);
  assert.equal(Object.keys(sprite.variables).length, 387);
  assert.equal(Object.keys(sprite.lists).length, 103);
  const procs = Object.values(sprite.blocks)
    .filter((b) => b.opcode === 'procedures_prototype')
    .map((b) => b.mutation?.proccode);
  assert.equal(procs.length, 21);
  for (const p of ['dyn_draw_sphere', 'dyn_draw_box', 'dyn_collide', 'dyn_raycast', 'dyn_physics', 'dyn_grab', 'sort_5_objects', 'render_frame', 'draw_quad_3d', 'render_smooth_cylinder']) {
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
  assert.deepEqual(lists.get('dynHy'), [0.35, 0.3, 0.75, 0.22]);
  // Sort rows for dynamic objects are pre-registered as ids 101..104.
  assert.deepEqual(lists.get('objId'), [1, 2, 3, 4, 5, 101, 102, 103, 104]);
  const vars = new Map(Object.values(sprite.variables).map(([name, val]) => [name, val]));
  assert.equal(vars.get('dynN'), 4);
  assert.equal(vars.get('dynFloorY'), demoDynScene.floorY);
  assert.equal(vars.get('dynPR'), 0.35);
});

test('phase-3 physics columns and event store start in the right state', () => {
  const { proj, sprite } = demoProject();
  const lists = new Map(Object.values(sprite.lists).map(([name, vals]) => [name, vals]));
  // Physical: sphere, box, falling sphere. Cylinder stays phase-2 fixed.
  assert.deepEqual(lists.get('dynPhys'), [1, 1, 0, 1]);
  // Resting physical objects start asleep; the airborne sphere is awake.
  assert.deepEqual(lists.get('dynSleep'), [1, 1, 0, 0]);
  assert.deepEqual(lists.get('dynHeld'), [0, 0, 0, 0]);
  assert.deepEqual(lists.get('dynVX'), [0, 0, 0, 0]);
  // Impact event queue starts empty; latest-impact readouts at 0.
  for (const n of ['evType', 'evObj', 'evOther', 'evVal', 'evFrame']) {
    assert.deepEqual(lists.get(n), [], `${n} should start empty`);
  }
  const vars = new Map(Object.values(sprite.variables).map(([name, val]) => [name, val]));
  assert.equal(vars.get('evCount'), 0);
  assert.equal(vars.get('evLastImpact'), 0);
  assert.equal(vars.get('psHeld'), 0);
  // Shipped builds hide the debug stage monitors (they covered the
  // rendered scene — user feedback 2026-11-26); the debugMonitors
  // build option (FLASH_MONITORS=1 in the example builder) restores
  // the impact readouts.
  assert.deepEqual(proj.monitors, []);
  const monProj = buildDemo(true).buildProject() as Proj;
  const monParams = monProj.monitors.map((m) => Object.values(m.params ?? {}));
  assert.deepEqual(monParams, [['evLastImpact'], ['evLastObj'], ['evVal']]);
});

test('demo bounds keep dynamic objects over the floor tiles', () => {
  // Regression test for the 2026-11-26 render-bug report: the phase-2
  // demo bounds (z down to -6.1) let pushed objects leave the floor
  // tiles (actual extent from the bake: z from -4) and float over the
  // mirror-sky void. Object centers are clamped to bounds shrunk by
  // their radius/half-extent margin, so an object's full XZ extent
  // stays within [bounds] on each axis; requiring bounds inside the
  // tile extent therefore keeps every object on the floor.
  const [floorQuads] = bakeCinemaScene() as [number[][][]];
  const xs = floorQuads.flatMap((q) => [q[0][0], q[1][0], q[2][0], q[3][0]]);
  const zs = floorQuads.flatMap((q) => [q[0][2], q[1][2], q[2][2], q[3][2]]);
  const tileX: [number, number] = [Math.min(...xs), Math.max(...xs)];
  const tileZ: [number, number] = [Math.min(...zs), Math.max(...zs)];
  const b = demoDynScene.bounds;
  assert.ok(b.x[0] >= tileX[0], `bounds.x[0]=${b.x[0]} west of floor tiles ${tileX[0]}`);
  assert.ok(b.x[1] <= tileX[1], `bounds.x[1]=${b.x[1]} east of floor tiles ${tileX[1]}`);
  assert.ok(b.z[0] >= tileZ[0], `bounds.z[0]=${b.z[0]} south of floor tiles ${tileZ[0]}`);
  assert.ok(b.z[1] <= tileZ[1], `bounds.z[1]=${b.z[1]} north of floor tiles ${tileZ[1]}`);
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
  assert.equal(sph.physical, 0);
  const box = resolveDynObject({ kind: 'box', pos: [0, 0, 0], halfExtents: [0.2, 0.4, 0.6], material: { albedo: [0, 0, 0] }, pushable: true, physical: true });
  assert.equal(box.kindCode, 3);
  assert.equal(box.pushable, 1);
  assert.equal(box.physical, 1);
});

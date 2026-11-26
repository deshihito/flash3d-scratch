/**
 * physics.test.ts — Phase-3 unit tests for the scene-side physics API.
 *
 * Covers the host-side half of phase 3 (device behavior is covered
 * structurally by demo.test.ts): provisional physics defaults and
 * per-scene overrides, and the rest-height derivation that decides the
 * initial sleep state. Also pins that the temple build carries no
 * phase-3 data at all (phase-1 invariance at the data level).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DYN_PHYSICS_DEFAULTS, dynHalfHeight, resolveDynObject, resolvePhysics } from '../src/scene/dynamic.js';
import { buildTemple } from '../src/scene/temple.js';

test('resolvePhysics falls back to the provisional defaults', () => {
  assert.deepEqual(resolvePhysics(undefined), DYN_PHYSICS_DEFAULTS);
  assert.deepEqual(resolvePhysics({}), DYN_PHYSICS_DEFAULTS);
});

test('resolvePhysics applies per-scene overrides only where given', () => {
  const p = resolvePhysics({ gravity: 0.03, grabReach: 2.5 });
  assert.equal(p.gravity, 0.03);
  assert.equal(p.grabReach, 2.5);
  assert.equal(p.throwSpeed, DYN_PHYSICS_DEFAULTS.throwSpeed);
  assert.equal(p.holdLerp, DYN_PHYSICS_DEFAULTS.holdLerp);
});

test('dynHalfHeight matches the collision convention per kind', () => {
  const sph = resolveDynObject({ kind: 'sphere', pos: [0, 0, 0], radius: 0.4, material: { albedo: [0, 0, 0] } });
  assert.equal(dynHalfHeight(sph), 0.4);
  const cyl = resolveDynObject({ kind: 'cylinder', pos: [0, 0, 0], radius: 0.3, height: 1.5, material: { albedo: [0, 0, 0] } });
  assert.equal(dynHalfHeight(cyl), 0.75);
  const box = resolveDynObject({ kind: 'box', pos: [0, 0, 0], halfExtents: [0.2, 0.45, 0.6], material: { albedo: [0, 0, 0] } });
  assert.equal(dynHalfHeight(box), 0.45);
});

test('temple build has no phase-3 data (phase-1 invariance)', () => {
  const pb = buildTemple();
  const proj = pb.buildProject() as {
    targets: Array<{ isStage: boolean; variables: Record<string, [string, unknown]>; lists: Record<string, [string, unknown[]]> }>;
    monitors: unknown[];
  };
  const sprite = proj.targets.find((t) => !t.isStage)!;
  const varNames = Object.values(sprite.variables).map(([n]) => n);
  const listNames = Object.values(sprite.lists).map(([n]) => n);
  for (const n of ['psX', 'psHeld', 'inMF', 'inGrab', 'physGrav', 'evLastImpact']) {
    assert.ok(!varNames.includes(n), `temple should not have var ${n}`);
  }
  for (const n of ['dynVX', 'dynPhys', 'dynSleep', 'dynHeld', 'evType', 'evVal']) {
    assert.ok(!listNames.includes(n), `temple should not have list ${n}`);
  }
  assert.deepEqual(proj.monitors, []);
});

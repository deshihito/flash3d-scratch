/**
 * demo.ts — L3 sample scene for phases 2+3: dynamic objects in the temple.
 *
 * The static baked temple scene (phase 1) plus four dynamic objects on
 * the open floor, exercising the engine components:
 * - a physical sphere you can push, grab (hold F), carry and throw (G),
 * - a physical box, same interactions,
 * - a small physical sphere that starts in the air and falls at start,
 *   landing with an impact event (recorded in the ev* lists; build
 *   with FLASH_MONITORS=1 to also show the evLastImpact / evVal stage
 *   monitors — they are hidden in the shipped build),
 * - a fixed (non-physical) cylinder that blocks the player.
 *
 * Controls (PROVISIONAL demo bindings; key assignment is game-side):
 * WASD/QE move, arrows or drag look, F hold = grab/carry, release F =
 * drop, G while holding = throw.
 *
 * This is an engine feature demo, not a game (design-repo-core.md
 * section 2: game logic lives in a future separate repo). Placement,
 * bounds and physics values are demo choices / provisional defaults.
 */
import * as path from 'node:path';
import { ProjectBuilder } from '../builder/index';
import { bakeCinemaScene } from '../bake/temple-bake';
import { buildTempleProject } from '../engine/hybrid-engine';
import type { DynSceneSpec } from './dynamic';

export const demoDynScene: DynSceneSpec = {
  floorY: -1.2, // the temple floor plane (transcribed from the phase-1 scene)
  // Bounds must stay inside the actual floor tiles (from the bake:
  // x[-3.55, 6.2], z[-4, 4.3]) so pushed/thrown objects never leave the
  // floor and float over the mirror-sky void south of the platform.
  // (Phase 2 used z down to -6.1, misremembering the tile extent as
  // z[-5,4]; that was the 2026-11-26 render-bug report — see
  // tests/demo.test.ts "demo bounds keep dynamic objects over the
  // floor tiles".) x[1]/z[1] also stay within camera reach.
  bounds: { x: [-3.5, 4.1], z: [-3.95, 3.5] },
  playerRadius: 0.35,
  objects: [
    {
      kind: 'sphere',
      pos: [1.1, -0.85, -2.6], // rests on the floor: y = floorY + radius
      radius: 0.35,
      material: { albedo: [0.85, 0.55, 0.20] },
      pushable: true,
      physical: true,
    },
    {
      kind: 'box',
      pos: [-1.5, -0.9, -1.6], // y = floorY + hy
      halfExtents: [0.3, 0.3, 0.3],
      yawDeg: 25,
      material: { albedo: [0.40, 0.52, 0.78] },
      pushable: true,
      physical: true,
    },
    {
      kind: 'cylinder',
      pos: [2.6, -0.45, -3.4], // y = floorY + height/2
      radius: 0.3,
      height: 1.5,
      material: { albedo: [0.80, 0.78, 0.72] }, // (cylinder shading is the kernel's stone path)
      pushable: false,
      physical: false,
    },
    {
      // Starts airborne: falls ~2.7 units on the first frames and lands
      // with an impact event (type 2) recorded in the ev* lists.
      kind: 'sphere',
      pos: [0.2, 1.7, -3.4],
      radius: 0.22,
      material: { albedo: [0.78, 0.30, 0.26] },
      pushable: true,
      physical: true,
    },
  ],
};

/** Build the demo scene's ProjectBuilder (temple static scene + dynamic objects). */
export function buildDemo(debugMonitors = false): ProjectBuilder {
  return buildTempleProject(bakeCinemaScene(), { ...demoDynScene, debugMonitors });
}

/** Build and save dist/demo.sb3 (or a caller-provided path). Returns the output path. */
export function buildDemoSb3(outPath?: string, debugMonitors = false): string {
  const pb = buildDemo(debugMonitors);
  const out = outPath ?? path.join(__dirname, '..', '..', '..', 'dist', 'demo.sb3');
  return pb.saveSb3(out);
}

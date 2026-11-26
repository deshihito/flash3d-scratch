/**
 * demo.ts — L3 sample scene for phases 2+3: dynamic objects in the temple.
 *
 * The static baked temple scene (phase 1) plus four dynamic objects on
 * the open floor, exercising the engine components:
 * - a physical sphere you can push, grab (hold F), carry and throw (G),
 * - a physical box, same interactions,
 * - a small physical sphere that starts in the air and falls at start,
 *   landing with an impact event (watch the evLastImpact / evVal stage
 *   monitors: the impact magnitude is shown and recorded),
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
  // Inside the temple camera clamps x[-3.15, 4.5] / z[-6.5, 3.85], with
  // margin so pushed objects stay on the floor tiles (x[-4,4], z[-5,4]).
  bounds: { x: [-3.6, 4.1], z: [-6.1, 3.5] },
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
export function buildDemo(): ProjectBuilder {
  return buildTempleProject(bakeCinemaScene(), demoDynScene);
}

/** Build and save dist/demo.sb3 (or a caller-provided path). Returns the output path. */
export function buildDemoSb3(outPath?: string): string {
  const pb = buildDemo();
  const out = outPath ?? path.join(__dirname, '..', '..', '..', 'dist', 'demo.sb3');
  return pb.saveSb3(out);
}

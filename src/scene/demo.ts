/**
 * demo.ts — L3 sample scene for phase 2: dynamic objects in the temple.
 *
 * The static baked temple scene (phase 1) plus three dynamic objects on
 * the open floor, exercising the phase-2 engine components:
 * - a pushable sphere (runtime-shaded dyn_draw_sphere),
 * - a pushable box with a yaw rotation (dyn_draw_box; collision is the
 *   AABB of its half extents),
 * - a fixed (non-pushable) cylinder rendered by render_smooth_cylinder.
 * Walk into the sphere or the box to push them; they slide on the floor
 * and stop at the scene bounds. The cylinder blocks the player instead.
 *
 * This is an engine feature demo, not a game (design-repo-core.md
 * section 2: game logic lives in a future separate repo). Placement and
 * bounds values are demo choices, marked PROVISIONAL where they act as
 * engine defaults.
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
    },
    {
      kind: 'box',
      pos: [-1.5, -0.9, -1.6], // y = floorY + hy
      halfExtents: [0.3, 0.3, 0.3],
      yawDeg: 25,
      material: { albedo: [0.40, 0.52, 0.78] },
      pushable: true,
    },
    {
      kind: 'cylinder',
      pos: [2.6, -0.45, -3.4], // y = floorY + height/2
      radius: 0.3,
      height: 1.5,
      material: { albedo: [0.80, 0.78, 0.72] }, // (cylinder shading is the kernel's stone path)
      pushable: false,
      fluted: 0,
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

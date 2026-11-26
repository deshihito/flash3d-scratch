/**
 * temple.ts — L2 scene description API + the temple scene (L3 sample).
 *
 * The scene is declared as data (SceneSpec): environment, lights,
 * camera, and objects with materials. This is the declarative form of
 * the scene that build_ue5_lumen_hybrid.py hard-coded as
 * bake_cinema_scene() plus scene constants. All numeric values are
 * transcribed from the original; nothing new was decided here
 * (design section 2). Fields the current L1/L2.5 pipeline consumes are
 * marked as such; the rest document the scene in the API's terms and
 * are the extension points for later phases.
 */
import * as path from 'node:path';
import { ProjectBuilder } from '../builder/index';
import { bakeCinemaScene } from '../bake/temple-bake';
import { buildTempleProject } from '../engine/hybrid-engine';
import {
  BEAM_Y0, BEAM_Y1, BEAMS_Z, COL_R, COLS, CRY_X, CRY_Y, CRY_Z,
  GOLD_R, HERO_X, HERO_Y, HERO_Z, OBS_R, OBS_X, OBS_Y, OBS_Z,
  RING_R1, RING_R2, SUN_X, SUN_Y, SUN_Z,
} from './temple-constants';

export type Vec3 = [number, number, number];

export interface MaterialSpec {
  /** Baked/RGB albedo tint used by the original scene's lighting eval. */
  albedo: Vec3;
  roughness?: number;
  metalness?: number;
  f0?: number;
  emissive?: boolean;
}

export interface DirectionalLightSpec {
  kind: 'directional';
  dir: Vec3;
}

export interface PointLightSpec {
  kind: 'point';
  pos: Vec3;
  /** MVP: point lights only feed the static bake (design section 5 #5). */
  bakeOnly: boolean;
}

export type LightSpec = DirectionalLightSpec | PointLightSpec;

export interface CameraSpec {
  kind: 'fps';
  startPos: Vec3;
  startYawDeg: number;
  startPitchDeg: number;
  /** Single FOV source: focal length in px for the rasterizer (FOCAL). */
  focal: number;
  /** fov scale variable used by the RT hero renderer. */
  fovScale: number;
  bounds: { x: [number, number]; y: [number, number]; z: [number, number]; pitchDeg: [number, number] };
}

export type ObjectSpec =
  | { kind: 'floorGrid'; y: number; materialNote: string }
  | { kind: 'architecture'; materialNote: string }
  | { kind: 'cylinder'; centerXZ: [number, number]; radius: number; fluted: boolean }
  | { kind: 'heroSphere'; center: Vec3; radius: number; material: string; ring?: { radius: number; tube: number; tiltDeg: [number, number] } }
  | { kind: 'sphere'; center: Vec3; radius: number; material: string }
  | { kind: 'crystal'; center: Vec3; light: string };

export interface SceneSpec {
  name: string;
  environment: { fogColor: Vec3; sky: 'gradient'; sunCorona: boolean };
  lights: LightSpec[];
  camera: CameraSpec;
  input: { move: string; look: string[]; touch: boolean };
  shadows: 'bake';
  floorReflection: boolean;
  objects: ObjectSpec[];
}

/**
 * The temple scene — the UE5 hybrid's cinema scene, declared.
 * Geometry detail (floor tiling, arch segmentation, shadow layer
 * shapes) is produced by the L2.5 bake from these declarations plus
 * the original's procedural construction, exactly as in the source.
 */
export const templeScene: SceneSpec = {
  name: 'UE5_Lumen_Cinema_Hybrid',
  environment: { fogColor: [1.38, 1.02, 0.76], sky: 'gradient', sunCorona: true },
  lights: [
    { kind: 'directional', dir: [SUN_X, SUN_Y, SUN_Z] },
    { kind: 'point', pos: [CRY_X, CRY_Y, CRY_Z], bakeOnly: true },
  ],
  camera: {
    kind: 'fps',
    startPos: [-0.32, 0.52, -5.25],
    startYawDeg: 4.5,
    startPitchDeg: -5.5,
    focal: 248.4,
    fovScale: 1.38,
    bounds: { x: [-3.15, 4.5], y: [-0.85, 2.55], z: [-6.5, 3.85], pitchDeg: [-48, 42] },
  },
  input: { move: 'WASD+QE', look: ['arrows', 'drag', 'flick'], touch: true },
  shadows: 'bake',
  floorReflection: true,
  objects: [
    { kind: 'floorGrid', y: -1.2, materialNote: 'marble/basalt checker, per-tile gloss & F0 baked into SoA columns' },
    { kind: 'architecture', materialNote: 'gouraud sandstone: back wall with dual roman arches, left wall, 3 roof beams' },
    ...COLS.map(
      (c): ObjectSpec => ({ kind: 'cylinder', centerXZ: [c[0], c[1]], radius: COL_R, fluted: true }),
    ),
    {
      kind: 'heroSphere',
      center: [HERO_X, HERO_Y, HERO_Z],
      radius: GOLD_R,
      material: 'gold',
      ring: { radius: RING_R1, tube: RING_R2, tiltDeg: [-19, 16] },
    },
    { kind: 'sphere', center: [OBS_X, OBS_Y, OBS_Z], radius: OBS_R, material: 'obsidian' },
    { kind: 'crystal', center: [CRY_X, CRY_Y, CRY_Z], light: 'crystal point light (bake)' },
  ],
};

/** Roof beam layout consumed by the bake (shadow projection + arch). */
export const templeBeams = { zRanges: BEAMS_Z, y0: BEAM_Y0, y1: BEAM_Y1 };

/** Build the temple scene's ProjectBuilder (L2 -> L2.5 bake -> L1 engine -> L0 builder). */
export function buildTemple(): ProjectBuilder {
  const baked = bakeCinemaScene();
  return buildTempleProject(baked);
}

/** Build and save dist/temple.sb3 (or a caller-provided path). Returns the output path. */
export function buildTempleSb3(outPath?: string): string {
  const pb = buildTemple();
  const out = outPath ?? path.join(__dirname, '..', '..', '..', 'dist', 'temple.sb3');
  return pb.saveSb3(out);
}

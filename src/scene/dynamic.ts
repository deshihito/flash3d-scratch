/**
 * dynamic.ts — L2 scene API for dynamic objects (phase 2).
 *
 * A dynamic object is a scene object whose transform lives in a device
 * side SoA table (dynX/dynY/dynZ/...) and can change every frame, unlike
 * the baked static scene. This module is host code: it only declares
 * and normalizes the data; the device side lives in
 * src/engine/dynamic.ts and is emitted by buildTempleProject when a
 * DynSceneSpec is passed.
 *
 * Engine/generic only — no game-specific logic (design-repo-core.md
 * section 2). Kinds are the analytic shapes that already have runtime
 * shading paths in the kernel: sphere, cylinder, box.
 *
 * PROVISIONAL / REVERSIBLE defaults (phase 2, not user-decided spec):
 * the values below are engine-side working defaults so the demo runs;
 * they are parameters, not decisions. See phase2-report.md.
 */
import type { Vec3 } from './temple';

export type DynKindName = 'sphere' | 'cylinder' | 'box';

/** Device-side kind codes stored in the dynKind SoA list. */
export const DYN_KIND: Record<DynKindName, number> = { sphere: 1, cylinder: 2, box: 3 };

export interface DynObjectSpec {
  kind: DynKindName;
  /** Center position in world units. y is the center height. */
  pos: Vec3;
  /** Yaw rotation in degrees (rendering; box collision stays AABB — see engine/dynamic.ts). */
  yawDeg?: number;
  /** Sphere / cylinder radius. */
  radius?: number;
  /** Cylinder height. */
  height?: number;
  /** Box half extents [hx, hy, hz]. */
  halfExtents?: Vec3;
  /** Runtime-shaded material: albedo in 0..1 per channel. */
  material: { albedo: Vec3 };
  /** Whether the player can push this object (default false). */
  pushable?: boolean;
  /** Cylinder fluting, forwarded to render_smooth_cylinder (default 0). */
  fluted?: number;
  /**
   * Whether the simple physics step (phase 3: gravity, velocity, floor
   * grounding, sleep, impact events) applies to this object, and whether
   * it can be grabbed/carried. Default false = phase-2 behavior (fixed
   * rest height, kinematic push displacement only).
   */
  physical?: boolean;
  /**
   * Room this object belongs to (phase 5, 1-based room id in the
   * RoomsSpec passed alongside). Only used when a RoomsSpec is given:
   * objects in inactive rooms are skipped by physics, player collision
   * and rendering. Default 1.
   */
  room?: number;
}

/**
 * Engine-side physics / interaction parameters (phase 3). Every value
 * here is a PROVISIONAL, REVERSIBLE working default chosen so the demo
 * runs — none of them is a user-decided game specification (design
 * section 6: gravity strength, throw speed etc. are game-side G1).
 * Velocities are in world units per frame (1 frame = 1 physics step).
 */
export interface DynPhysicsSpec {
  /** Gravity acceleration, units/frame^2. PROVISIONAL 0.02. */
  gravity?: number;
  /** Terminal fall speed, units/frame. PROVISIONAL 0.5. */
  maxFallSpeed?: number;
  /** Minimum |delta-v| that raises an impact event. PROVISIONAL 0.05. */
  impactMin?: number;
  /** Horizontal speed below which a grounded object sleeps. PROVISIONAL 0.01. */
  sleepSpeed?: number;
  /** Horizontal velocity multiplier per grounded frame. PROVISIONAL 0.8. */
  groundFriction?: number;
  /** Max raycast distance for grabbing. PROVISIONAL 3.0. */
  grabReach?: number;
  /** Distance of the hold point in front of the camera. PROVISIONAL 1.1. */
  holdDistance?: number;
  /** Kinematic hold follow lerp factor 0..1 per frame. PROVISIONAL 0.5. */
  holdLerp?: number;
  /** Throw initial speed along the view direction. PROVISIONAL 0.30. */
  throwSpeed?: number;
  /** Speed imparted to a physical object when the player shoves it. PROVISIONAL 0.10. */
  pushSpeed?: number;
}

export const DYN_PHYSICS_DEFAULTS: Required<DynPhysicsSpec> = {
  gravity: 0.02,
  maxFallSpeed: 0.5,
  impactMin: 0.05,
  sleepSpeed: 0.01,
  groundFriction: 0.8,
  grabReach: 3.0,
  holdDistance: 1.1,
  holdLerp: 0.5,
  throwSpeed: 0.30,
  pushSpeed: 0.10,
};

export function resolvePhysics(spec?: DynPhysicsSpec): Required<DynPhysicsSpec> {
  return { ...DYN_PHYSICS_DEFAULTS, ...(spec ?? {}) };
}

export interface DynSceneSpec {
  objects: DynObjectSpec[];
  /** World y of the floor plane the objects rest on. */
  floorY: number;
  /** World bounds dynamic objects are clamped into (their centers, before radius margin). */
  bounds: { x: [number, number]; z: [number, number] };
  /** Player collision radius in the XZ plane. PROVISIONAL default 0.35. */
  playerRadius?: number;
  /** Physics / interaction parameters (phase 3). Defaults are provisional. */
  physics?: DynPhysicsSpec;
}

/** Normalized per-object fields, as consumed by the device emitter. */
export interface DynObjectResolved {
  kindCode: number;
  pos: Vec3;
  yawDeg: number;
  radius: number;
  height: number;
  halfExtents: Vec3;
  /** Albedo as 0..255 integers for the runtime shading registers. */
  col255: [number, number, number];
  pushable: number;
  fluted: number;
  physical: number;
  /** 1-based room id (phase 5; 1 when no RoomsSpec is in play). */
  room: number;
}

export function resolveDynObject(o: DynObjectSpec): DynObjectResolved {
  const halfExtents = o.halfExtents ?? [0.3, 0.3, 0.3];
  const radius = o.radius ?? 0.35;
  const height = o.height ?? 1.5;
  // Sphere/cylinder collision uses the XZ circle; box collision uses the
  // AABB half extents. hy drives the vertical-overlap test for all kinds:
  // spheres use their radius, cylinders half their height, boxes hy.
  return {
    kindCode: DYN_KIND[o.kind],
    pos: o.pos,
    yawDeg: o.yawDeg ?? 0,
    radius,
    height,
    halfExtents,
    col255: [
      Math.round(o.material.albedo[0] * 255),
      Math.round(o.material.albedo[1] * 255),
      Math.round(o.material.albedo[2] * 255),
    ],
    pushable: o.pushable ? 1 : 0,
    fluted: o.fluted ?? 0,
    physical: o.physical ? 1 : 0,
    room: o.room ?? 1,
  };
}

/** Vertical half extent used for floor rest height and overlap tests. */
export function dynHalfHeight(o: DynObjectResolved): number {
  return o.kindCode === 1 ? o.radius : o.kindCode === 2 ? o.height / 2 : o.halfExtents[1];
}

/** Player radius used when the spec does not override it. PROVISIONAL. */
export const DYN_PLAYER_RADIUS_DEFAULT = 0.35;

export function dynPlayerRadius(spec: DynSceneSpec): number {
  return spec.playerRadius ?? DYN_PLAYER_RADIUS_DEFAULT;
}

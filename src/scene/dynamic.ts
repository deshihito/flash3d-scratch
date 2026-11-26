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
}

export interface DynSceneSpec {
  objects: DynObjectSpec[];
  /** World y of the floor plane the objects rest on. */
  floorY: number;
  /** World bounds dynamic objects are clamped into (their centers, before radius margin). */
  bounds: { x: [number, number]; z: [number, number] };
  /** Player collision radius in the XZ plane. PROVISIONAL default 0.35. */
  playerRadius?: number;
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
  };
}

/** Player radius used when the spec does not override it. PROVISIONAL. */
export const DYN_PLAYER_RADIUS_DEFAULT = 0.35;

export function dynPlayerRadius(spec: DynSceneSpec): number {
  return spec.playerRadius ?? DYN_PLAYER_RADIUS_DEFAULT;
}

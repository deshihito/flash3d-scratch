/**
 * rooms.ts — L2 scene API for room-based maps (phase 5).
 *
 * Design: design-repo-core.md section 3.7. A map is a set of rooms.
 * Each room has an XZ rectangle (used for the player-room query, AI
 * patrol ranges and activation), an adjacency set, and optionally its
 * own static geometry:
 *
 * - floor tiles: flat-shaded quads on the scene floor plane, and
 * - wall boxes: AABBs expanded host-side into gouraud quads (top + 4
 *   sides, lit by the temple bake's evalLumenHdr so they match the
 *   temple's static lighting) plus a static AABB collider entry.
 *
 * Room 1 is special only by convention: in the rooms demo it is the
 * temple hall, whose geometry is the phase-1 bake drawn by the kernel
 * procs (render_floor / render_arch / the fixed sorted objects). The
 * engine gates those procs on room 1 being active, and draws every
 * declared tile/wall here through render_rooms with per-quad room
 * checks — so "player room + neighbours" is the only static geometry
 * ever drawn (the room-culling load reduction measured in the phase-5
 * report).
 *
 * Activation: a room is active when it is the player's room or adjacent
 * to it. Physics, player collision, rendering and AI updates are
 * skipped for objects in inactive rooms (design sections 3.7 / 4.2:
 * room-based activation is a premise mechanism, not an optimization).
 *
 * Host code only: this module declares and resolves data; the device
 * side lives in src/engine/rooms.ts. Engine/generic only — no game
 * logic (what the rooms contain is the scene author's business).
 */
import { acesRgbTuple, evalLumenHdr } from '../bake/temple-bake';
import { SUN_X, SUN_Y, SUN_Z } from './temple-constants';
import type { Vec3 } from './temple';

export interface RoomRect { x: [number, number]; z: [number, number] }

export interface RoomSpec {
  /** Room footprint used by the player-room query and activation. */
  rect: RoomRect;
  /** 1-based ids of adjacent rooms (symmetrized at resolve time). */
  neighbors: number[];
}

export interface RoomFloorTileSpec {
  /** 1-based room id this tile belongs to. */
  room: number;
  x: [number, number];
  z: [number, number];
  /** Albedo in 0..1 per channel, lit host-side with the floor normal. */
  albedo: Vec3;
}

export interface RoomWallSpec {
  /** 1-based room id this wall belongs to. */
  room: number;
  /** Axis-aligned wall box. Becomes 5 gouraud quads + 1 static collider. */
  box: { x: [number, number]; z: [number, number]; y: [number, number] };
  /** Albedo tint in 0..1 per channel (default: the temple arch tint). */
  tint?: Vec3;
}

export interface RoomsSpec {
  /** Rooms in declaration order; ids are 1-based positions in this array. */
  rooms: RoomSpec[];
  /** World y of the floor plane the room tiles lie on. */
  floorY: number;
  floorTiles?: RoomFloorTileSpec[];
  walls?: RoomWallSpec[];
  /**
   * Player clamp for the main loop (replaces the phase-1 temple clamp
   * in DynSceneSpec builds). Must cover every room rect (shrunk by the
   * player radius) or rooms become unreachable.
   */
  playerClamp?: { x: [number, number]; y: [number, number]; z: [number, number] };
}

/** Flattened N x N adjacency matrix (row-major, includes self = 1). */
export function resolveAdjacency(rooms: RoomSpec[]): number[] {
  const n = rooms.length;
  const adj = new Array<number>(n * n).fill(0);
  const set = (a: number, b: number) => { adj[(a - 1) * n + (b - 1)] = 1; };
  rooms.forEach((r, i) => {
    set(i + 1, i + 1);
    for (const nb of r.neighbors) { set(i + 1, nb); set(nb, i + 1); }
  });
  return adj;
}

/** Active-room flags at spawn, assuming the player starts in room 1. */
export function initialActive(rooms: RoomSpec[]): number[] {
  const adj = resolveAdjacency(rooms);
  return rooms.map((_r, i) => adj[i]); // row of room 1
}

export interface ResolvedTile {
  room: number;
  /** Corners [v0..v3] in the bake's floor winding: (x0,z0),(x1,z0),(x1,z1),(x0,z1). */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** Final RGB packed as one integer (drawn flat, like the temple's shadow quads). */
  colInt: number;
}

export interface ResolvedWallQuad {
  room: number;
  corners: [Vec3, Vec3, Vec3, Vec3];
  top: [number, number, number];
  bot: [number, number, number];
  n: Vec3;
}

export interface ResolvedCollider {
  room: number;
  x: [number, number];
  z: [number, number];
  y: [number, number];
}

export interface ResolvedRoomGeometry {
  tiles: ResolvedTile[];
  quads: ResolvedWallQuad[];
  colliders: ResolvedCollider[];
}

const WALL_TINT_DEFAULT: Vec3 = [0.78, 0.63, 0.46];

function litRgb(px: number, py: number, pz: number, n: Vec3, alb: Vec3, ao: number): [number, number, number] {
  const [r, g, b] = evalLumenHdr(px, py, pz, n[0], n[1], n[2], alb[0], alb[1], alb[2], 1.0, ao);
  return acesRgbTuple(r, g, b) as [number, number, number];
}

/** Resolve the declared tiles/walls into render quads + static colliders. */
export function resolveRoomGeometry(spec: RoomsSpec): ResolvedRoomGeometry {
  const fy = spec.floorY;
  const tiles: ResolvedTile[] = (spec.floorTiles ?? []).map((t) => {
    const cx = (t.x[0] + t.x[1]) / 2, cz = (t.z[0] + t.z[1]) / 2;
    const [r, g, b] = litRgb(cx, fy, cz, [0, 1, 0], t.albedo, 1.0);
    return {
      room: t.room,
      corners: [
        [t.x[0], fy, t.z[0]], [t.x[1], fy, t.z[0]],
        [t.x[1], fy, t.z[1]], [t.x[0], fy, t.z[1]],
      ] as [Vec3, Vec3, Vec3, Vec3],
      colInt: r * 65536 + g * 256 + b,
    };
  });

  const quads: ResolvedWallQuad[] = [];
  const colliders: ResolvedCollider[] = [];
  for (const w of spec.walls ?? []) {
    const tint = w.tint ?? WALL_TINT_DEFAULT;
    const [x0, x1] = w.box.x, [z0, z1] = w.box.z, [y0, y1] = w.box.y;
    colliders.push({ room: w.room, x: w.box.x, z: w.box.z, y: w.box.y });
    // Faces in the bake's addGarch winding (v0/v1 = bottom edge,
    // v2/v3 = top edge), lit like the temple arch (ao 0.96 top / 0.72
    // bottom). Bottom face is never visible and not emitted.
    const faces: Array<{ c: [Vec3, Vec3, Vec3, Vec3]; n: Vec3 }> = [
      // top
      { c: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], n: [0, 1, 0] },
      // south (z0, normal -z)
      { c: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], n: [0, 0, -1] },
      // north (z1, normal +z)
      { c: [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], n: [0, 0, 1] },
      // west (x0, normal -x)
      { c: [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], n: [-1, 0, 0] },
      // east (x1, normal +x)
      { c: [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], n: [1, 0, 0] },
    ];
    for (const f of faces) {
      const cx = (f.c[0][0] + f.c[2][0]) / 2, cz = (f.c[0][2] + f.c[2][2]) / 2;
      quads.push({
        room: w.room,
        corners: f.c,
        top: litRgb(cx, y1, cz, f.n, tint, 0.96),
        bot: litRgb(cx, y0, cz, f.n, tint, 0.72),
        n: f.n,
      });
    }
  }
  return { tiles, quads, colliders };
}

/** Sun direction re-export for scene authors building lit geometry. */
export const ROOM_SUN: Vec3 = [SUN_X, SUN_Y, SUN_Z];

/**
 * rooms-demo.ts — L3 sample scene for phase 5: rooms + generic AI.
 *
 * The temple hall (room 1, the phase-1 bake) plus three annex rooms
 * declared through the RoomsSpec API:
 *   room 2: west annex (own floor tiles + perimeter walls, door gap
 *           on the shared east edge)
 *   room 3: east annex (same construction, doors west and east)
 *   room 4: a small vault east of room 3
 * Adjacency: 1-2, 1-3, 3-4. Walking east into the vault deactivates
 * rooms 1-2: the temple's floor/arch/sorted objects are not drawn at
 * all (room culling — measured in the phase-5 report), and the vault's
 * falling sphere only starts falling once its room is active.
 *
 * Two dummy agents run on the generic FSM base (engine/ai.ts):
 *   agent A (dark red box) patrols rooms 3-4, agent B (dark teal box)
 *   patrols room 2. Both pursue the player on sight/sound and give up
 *   back to patrol. Watch the agState stage monitor (1=patrol,
 *   2=pursue, 3=return) and the psRoom monitor.
 *
 * This is an engine feature demo, not a game. All placement, speeds
 * and sense ranges are DEMO-SIDE PROVISIONAL values (design section 6:
 * enemy parameters are game-side G4); the engine takes them as
 * per-agent parameters only.
 *
 * Known demo limitations (documented, not hidden):
 * - Dynamic-object bounds are one global rectangle, so a pushed object
 *   can cross a doorway line anywhere, not only through the gap, and
 *   can leave an annex floor sideways. Per-room object clamping is
 *   future work; the player *is* blocked by the wall colliders.
 * - The agents' line of sight does not see the room walls (the
 *   raycast's static set is floor + scene-bounds walls, phase-3
 *   limitation), so an agent may spot the player through a wall at
 *   close range. Distance + FOV still apply.
 */
import * as path from 'node:path';
import { ProjectBuilder } from '../builder/index';
import { bakeCinemaScene } from '../bake/temple-bake';
import { buildTempleProject } from '../engine/hybrid-engine';
import type { DynSceneSpec } from './dynamic';
import type { RoomFloorTileSpec, RoomsSpec } from './rooms';
import type { AgentSpec } from './ai';

const FLOOR_Y = -1.2;
const WALL_Y: [number, number] = [-1.2, 1.8];

/** Checkerboard floor tiles over a rect, in the temple floor's albedos. */
function checkerTiles(room: number, xEdges: number[], zEdges: number[]): RoomFloorTileSpec[] {
  const out: RoomFloorTileSpec[] = [];
  for (let iz = 0; iz < zEdges.length - 1; iz++) {
    for (let ix = 0; ix < xEdges.length - 1; ix++) {
      out.push({
        room,
        x: [xEdges[ix], xEdges[ix + 1]],
        z: [zEdges[iz], zEdges[iz + 1]],
        albedo: (ix + iz) % 2 === 0 ? [0.72, 0.64, 0.54] : [0.065, 0.072, 0.095],
      });
    }
  }
  return out;
}

export const roomsMapSpec: RoomsSpec = {
  floorY: FLOOR_Y,
  playerClamp: { x: [-7.3, 12.9], y: [-0.85, 2.55], z: [-6.5, 3.85] },
  rooms: [
    { rect: { x: [-3.55, 6.2], z: [-4, 4.3] }, neighbors: [2, 3] }, // 1: temple hall (phase-1 bake)
    { rect: { x: [-7.6, -3.55], z: [-2, 2] }, neighbors: [1] },     // 2: west annex
    { rect: { x: [6.2, 10.2], z: [-2, 2] }, neighbors: [1, 4] },    // 3: east annex
    { rect: { x: [10.2, 13.2], z: [-1.5, 1.5] }, neighbors: [3] },  // 4: vault
  ],
  floorTiles: [
    ...checkerTiles(2, [-7.6, -6.6, -5.6, -4.6, -3.55], [-2, -1, 0, 1, 2]),
    ...checkerTiles(3, [6.2, 7.2, 8.2, 9.2, 10.2], [-2, -1, 0, 1, 2]),
    ...checkerTiles(4, [10.2, 11.2, 12.2, 13.2], [-1.5, -0.5, 0.5, 1.5]),
  ],
  walls: [
    // Room 2 perimeter; east edge is shared with room 1 and has the door gap z[-0.6, 0.6].
    { room: 2, box: { x: [-7.75, -7.45], z: [-2, 2], y: WALL_Y } },
    { room: 2, box: { x: [-7.6, -3.55], z: [1.85, 2.15], y: WALL_Y } },
    { room: 2, box: { x: [-7.6, -3.55], z: [-2.15, -1.85], y: WALL_Y } },
    { room: 2, box: { x: [-3.7, -3.4], z: [-2, -0.6], y: WALL_Y } },
    { room: 2, box: { x: [-3.7, -3.4], z: [0.6, 2], y: WALL_Y } },
    // Room 3 perimeter; west edge shared with room 1, east with room 4, both with door gaps.
    { room: 3, box: { x: [6.2, 10.2], z: [1.85, 2.15], y: WALL_Y } },
    { room: 3, box: { x: [6.2, 10.2], z: [-2.15, -1.85], y: WALL_Y } },
    { room: 3, box: { x: [6.05, 6.35], z: [-2, -0.6], y: WALL_Y } },
    { room: 3, box: { x: [6.05, 6.35], z: [0.6, 2], y: WALL_Y } },
    { room: 3, box: { x: [10.05, 10.35], z: [-2, -0.6], y: WALL_Y } },
    { room: 3, box: { x: [10.05, 10.35], z: [0.6, 2], y: WALL_Y } },
    // Room 4 perimeter; west edge is room 3's east wall (shared, declared above).
    { room: 4, box: { x: [10.2, 13.2], z: [1.35, 1.65], y: WALL_Y } },
    { room: 4, box: { x: [10.2, 13.2], z: [-1.65, -1.35], y: WALL_Y } },
    { room: 4, box: { x: [13.05, 13.35], z: [-1.5, 1.5], y: WALL_Y } },
  ],
};

export const roomsDynScene: DynSceneSpec = {
  floorY: FLOOR_Y,
  // One global rectangle covering all four room floors (see the header
  // note on per-room object clamping).
  bounds: { x: [-7.4, 13.0], z: [-3.9, 4.2] },
  playerRadius: 0.35,
  objects: [
    {
      kind: 'sphere',
      pos: [1.1, -0.85, -2.6],
      radius: 0.35,
      material: { albedo: [0.85, 0.55, 0.20] },
      pushable: true,
      physical: true,
      room: 1,
    },
    {
      kind: 'box',
      pos: [-5.5, -0.9, 0],
      halfExtents: [0.3, 0.3, 0.3],
      material: { albedo: [0.40, 0.52, 0.78] },
      pushable: true,
      physical: true,
      room: 2,
    },
    {
      // Agent A's body (driven by the FSM, not by physics).
      kind: 'box',
      pos: [8.2, -0.3, 0],
      halfExtents: [0.32, 0.9, 0.32],
      material: { albedo: [0.45, 0.16, 0.14] },
      pushable: false,
      physical: false,
      room: 3,
    },
    {
      // Agent B's body.
      kind: 'box',
      pos: [-5.5, -0.3, -1.0],
      halfExtents: [0.32, 0.9, 0.32],
      material: { albedo: [0.14, 0.30, 0.32] },
      pushable: false,
      physical: false,
      room: 2,
    },
    {
      // Falls (and records an impact) only once room 4 is active.
      kind: 'sphere',
      pos: [11.7, 1.2, 0],
      radius: 0.22,
      material: { albedo: [0.78, 0.30, 0.26] },
      pushable: true,
      physical: true,
      room: 4,
    },
  ],
};

export const roomsAgents: AgentSpec[] = [
  {
    object: 3,
    waypoints: [[7.0, -1.2], [9.6, 1.2], [11.6, 0.8], [11.6, -0.8], [8.0, 0.0]],
    patrolSpeed: 0.03,
    chaseSpeed: 0.055,
    viewDistance: 4.5,
    viewHalfAngleCos: 0.57,
    hearDistance: 2.2,
    loseFrames: 150,
    perceptEvery: 5,
  },
  {
    object: 4,
    waypoints: [[-6.8, -1.2], [-4.4, -1.2], [-4.4, 1.2], [-6.8, 1.2]],
    patrolSpeed: 0.03,
    chaseSpeed: 0.05,
    viewDistance: 4.0,
    viewHalfAngleCos: 0.57,
    hearDistance: 2.0,
    loseFrames: 150,
    perceptEvery: 5,
  },
];

/** Build the rooms demo's ProjectBuilder (temple + rooms + AI). */
export function buildRoomsDemo(debugMonitors = false): ProjectBuilder {
  return buildTempleProject(bakeCinemaScene(), { ...roomsDynScene, debugMonitors }, roomsMapSpec, roomsAgents);
}

/** Build and save dist/rooms.sb3 (or a caller-provided path). Returns the output path. */
export function buildRoomsSb3(outPath?: string, debugMonitors = false): string {
  const pb = buildRoomsDemo(debugMonitors);
  const out = outPath ?? path.join(__dirname, '..', '..', '..', 'dist', 'rooms.sb3');
  return pb.saveSb3(out);
}

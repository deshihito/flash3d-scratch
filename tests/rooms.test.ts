/**
 * rooms.test.ts — Phase-5 regression tests: room representation,
 * room activation/culling data, generic AI base.
 *
 * Asserts the rooms demo (temple + RoomsSpec + agents) builds with the
 * room/AI procedures and tables, that the adjacency matrix is
 * symmetric with self = 1, that dynamic objects carry their room ids,
 * that room geometry resolves to the declared counts (tiles, wall
 * quads = walls x 5, colliders = walls), that agent waypoint tables
 * are consistent, and that the build is deterministic. The temple and
 * phase-3 demo signatures are covered by their own test files and must
 * not move.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRoomsDemo, roomsAgents, roomsDynScene, roomsMapSpec } from '../src/scene/rooms-demo.js';
import { initialActive, resolveAdjacency, resolveRoomGeometry } from '../src/scene/rooms.js';
import { resolveAgents } from '../src/scene/ai.js';
import { resolveDynObject } from '../src/scene/dynamic.js';

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

function roomsProject(): { proj: Proj; sprite: Proj['targets'][number] } {
  const proj = buildRoomsDemo().buildProject() as Proj;
  const sprite = proj.targets.find((t) => !t.isStage)!;
  return { proj, sprite };
}

function listsOf(sprite: Proj['targets'][number]): Map<string, unknown[]> {
  return new Map(Object.values(sprite.lists).map(([name, vals]) => [name, vals]));
}

test('rooms project has the phase-5 procedures and pen-only extensions', () => {
  const { proj, sprite } = roomsProject();
  assert.deepEqual(proj.extensions, ['pen']);
  const procs = Object.values(sprite.blocks)
    .filter((b) => b.opcode === 'procedures_prototype')
    .map((b) => b.mutation?.proccode);
  // 21 phase-3 demo procs + room_update / room_collide / render_rooms
  // + ai_perceive / ai_steer / ai_update.
  assert.equal(procs.length, 27);
  for (const p of ['room_update', 'room_collide', 'render_rooms', 'ai_perceive', 'ai_steer', 'ai_update']) {
    assert.ok(procs.includes(p), `missing proc ${p}`);
  }
  const ids = new Set(Object.keys(sprite.blocks));
  for (const b of Object.values(sprite.blocks)) {
    if (b.next) assert.ok(ids.has(b.next), `dangling next ${b.next}`);
    if (b.parent) assert.ok(ids.has(b.parent), `dangling parent ${b.parent}`);
  }
  // Demo readouts: phase-3 impact monitors + psRoom + agState.
  const monParams = proj.monitors.map((m) => Object.values(m.params ?? {}));
  assert.deepEqual(monParams, [['evLastImpact'], ['evLastObj'], ['evVal'], ['psRoom'], ['agState']]);
});

test('room tables: adjacency symmetric, dynRoom matches the scene spec', () => {
  const { sprite } = roomsProject();
  const lists = listsOf(sprite);
  const n = roomsMapSpec.rooms.length;
  const adj = resolveAdjacency(roomsMapSpec.rooms);
  assert.deepEqual(lists.get('rmAdj'), adj);
  for (let a = 1; a <= n; a++) {
    assert.equal(adj[(a - 1) * n + (a - 1)], 1, 'self adjacency');
    for (let b = 1; b <= n; b++) {
      assert.equal(adj[(a - 1) * n + (b - 1)], adj[(b - 1) * n + (a - 1)], `adjacency ${a}<->${b}`);
    }
  }
  // Spawn state: player starts in room 1, so room 1 + neighbours active.
  assert.deepEqual(lists.get('rmActive'), initialActive(roomsMapSpec.rooms));
  assert.deepEqual(lists.get('rmActive'), [1, 1, 1, 0]);
  const objs = roomsDynScene.objects.map(resolveDynObject);
  assert.deepEqual(lists.get('dynRoom'), objs.map((o) => o.room));
  assert.deepEqual(lists.get('dynRoom'), [1, 2, 3, 2, 4]);
  const vars = new Map(Object.values(sprite.variables).map(([name, val]) => [name, val]));
  assert.equal(vars.get('rmN'), 4);
  assert.equal(vars.get('psRoom'), 1);
});

test('room geometry resolves to the declared counts', () => {
  const geo = resolveRoomGeometry(roomsMapSpec);
  assert.equal(geo.tiles.length, roomsMapSpec.floorTiles!.length);
  assert.equal(geo.tiles.length, 41); // 16 + 16 + 9
  assert.equal(geo.colliders.length, roomsMapSpec.walls!.length);
  assert.equal(geo.quads.length, roomsMapSpec.walls!.length * 5); // top + 4 sides per wall box
  const { sprite } = roomsProject();
  const lists = listsOf(sprite);
  const vars = new Map(Object.values(sprite.variables).map(([name, val]) => [name, val]));
  assert.equal(vars.get('rmFlN'), 41);
  assert.equal(vars.get('rmWN'), 14 * 5);
  assert.equal(vars.get('rmColN'), 14);
  // Every tile/wall quad belongs to a declared room >= 2 (room 1 is the bake).
  for (const r of lists.get('rmFlRoom')!) assert.ok((r as number) >= 2);
  for (const r of lists.get('rmWRoom')!) assert.ok((r as number) >= 2);
  // Tile corners lie on the floor plane.
  for (let ci = 0; ci < 4; ci++) {
    for (const y of lists.get(`rmFlY${ci}`)!) assert.equal(y, roomsMapSpec.floorY);
  }
});

test('agent tables: waypoint offsets, initial state, parameters', () => {
  const { sprite } = roomsProject();
  const lists = listsOf(sprite);
  const resolved = resolveAgents(roomsAgents, roomsDynScene.objects.map((o) => [o.pos[0], o.pos[2]]));
  assert.deepEqual(lists.get('agObj'), [3, 4]);
  assert.deepEqual(lists.get('agState'), [1, 1]); // both start in PATROL
  assert.deepEqual(lists.get('agWpN'), roomsAgents.map((a) => a.waypoints.length));
  assert.deepEqual(lists.get('agWpOff'), resolved.map((a) => a.wpOff));
  assert.deepEqual(lists.get('agWpX'), roomsAgents.flatMap((a) => a.waypoints.map((w) => w[0])));
  assert.deepEqual(lists.get('agWpZ'), roomsAgents.flatMap((a) => a.waypoints.map((w) => w[1])));
  assert.deepEqual(lists.get('agPerEvery'), [5, 5]);
  // Every waypoint lies inside at least one room rect (patrols stay in the map).
  for (const a of roomsAgents) {
    for (const [wx, wz] of a.waypoints) {
      const inside = roomsMapSpec.rooms.some((r) =>
        wx >= r.rect.x[0] && wx <= r.rect.x[1] && wz >= r.rect.z[0] && wz <= r.rect.z[1]);
      assert.ok(inside, `waypoint ${wx},${wz} outside all rooms`);
    }
  }
  // The player clamp must let the player *enter* every room (the
  // room-activation trigger): the clamp range must overlap each room
  // rect shrunk by the player radius. (Fully covering room 1's rect is
  // not required — the phase-1 temple clamp has always kept the player
  // off the platform's northern strip.)
  const clamp = roomsMapSpec.playerClamp!;
  const pr = roomsDynScene.playerRadius!;
  for (const r of roomsMapSpec.rooms) {
    assert.ok(clamp.x[0] <= r.rect.x[1] - pr && clamp.x[1] >= r.rect.x[0] + pr, 'clamp x enters room');
    assert.ok(clamp.z[0] <= r.rect.z[1] - pr && clamp.z[1] >= r.rect.z[0] + pr, 'clamp z enters room');
  }
});

test('rooms build is deterministic', () => {
  const a = JSON.stringify(buildRoomsDemo().buildProject());
  const b = JSON.stringify(buildRoomsDemo().buildProject());
  assert.equal(a, b);
});

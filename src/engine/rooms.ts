/**
 * rooms.ts — L1 device code for room-based maps (phase 5).
 *
 * Emitted only when buildTempleProject receives a RoomsSpec (which in
 * turn requires a DynSceneSpec); the temple and phase-2/3 demo builds
 * are untouched.
 *
 * What this provides (design-repo-core.md section 3.7):
 * - Room table: SoA lists rmX0/rmX1/rmZ0/rmZ1 (room rects), rmAdj
 *   (flattened adjacency matrix, symmetrized host-side, self = 1) and
 *   rmActive (per-frame flags: player's room + its neighbours).
 * - dynRoom: the room id of each dynamic object (from DynObjectSpec),
 *   used to gate physics / collision / rendering / AI per room.
 * - room_update: recomputes psRoom (the room rect containing the
 *   player; unchanged when the player is between rooms) and rmActive.
 * - Room static geometry: floor tiles (rmFl*) and wall quads (rmW*),
 *   resolved host-side in scene/rooms.ts, drawn by render_rooms with a
 *   per-quad rmActive check. Room 1's geometry is the temple bake,
 *   gated in render_frame itself (hybrid-engine.ts).
 * - room_collide: the player (XZ circle, radius dynPR) vs the static
 *   wall AABBs (rmCol*), minimum-penetration-axis push-out — the
 *   static counterpart of dyn_collide's box path (design section 3.3).
 *   Dynamic objects do not collide with room walls yet (their world
 *   is still the scene bounds); that is a documented remaining item.
 *
 * The player body vertical span (camY-1.25 .. camY+0.35) matches the
 * PROVISIONAL span used by dyn_collide.
 */
import type { ProcHandle } from '../builder/index';
import type { DynCtx } from './dynamic';
import type { DynSceneSpec } from '../scene/dynamic';
import {
  initialActive, resolveAdjacency, resolveRoomGeometry, type RoomsSpec,
} from '../scene/rooms';

export interface RoomProcs { update: ProcHandle; collide: ProcHandle; render: ProcHandle }

/** True when the room with the given id expression is currently active. */
export function roomActiveExpr(s: any, roomId: any): any {
  return s.eq(s.itemOf('rmActive', roomId), 1);
}

/** True when the room of dynamic object `dynIdx` (1-based slot) is active. */
export function dynRoomActiveExpr(s: any, dynIdx: any): any {
  return roomActiveExpr(s, s.itemOf('dynRoom', dynIdx));
}

/** Declare the room tables, room geometry lists and scratch registers. */
export function declareRoomData(s: any, rooms: RoomsSpec, dyn: DynSceneSpec | null): void {
  const n = rooms.rooms.length;
  s.lst('rmX0', rooms.rooms.map((r) => r.rect.x[0]));
  s.lst('rmX1', rooms.rooms.map((r) => r.rect.x[1]));
  s.lst('rmZ0', rooms.rooms.map((r) => r.rect.z[0]));
  s.lst('rmZ1', rooms.rooms.map((r) => r.rect.z[1]));
  s.lst('rmAdj', resolveAdjacency(rooms.rooms));
  s.lst('rmActive', initialActive(rooms.rooms));
  s.var('rmN', n);
  s.var('psRoom', 1);
  s.var('rmFloorY', rooms.floorY);
  s.var('rmI', 0);
  // Room of each dynamic object (1 when no dyn scene).
  s.lst('dynRoom', (dyn?.objects ?? []).map((o) => o.room ?? 1));

  const geo = resolveRoomGeometry(rooms);
  // Floor tiles: corners + packed color + room.
  s.lst('rmFlRoom', geo.tiles.map((t) => t.room));
  for (let ci = 0; ci < 4; ci++) {
    s.lst(`rmFlX${ci}`, geo.tiles.map((t) => t.corners[ci][0]));
    s.lst(`rmFlY${ci}`, geo.tiles.map((t) => t.corners[ci][1]));
    s.lst(`rmFlZ${ci}`, geo.tiles.map((t) => t.corners[ci][2]));
  }
  s.lst('rmFlCol', geo.tiles.map((t) => t.colInt));
  s.var('rmFlN', geo.tiles.length);
  // Wall quads: corners + gouraud colors + normal + room.
  s.lst('rmWRoom', geo.quads.map((q) => q.room));
  for (let ci = 0; ci < 4; ci++) {
    s.lst(`rmWX${ci}`, geo.quads.map((q) => q.corners[ci][0]));
    s.lst(`rmWY${ci}`, geo.quads.map((q) => q.corners[ci][1]));
    s.lst(`rmWZ${ci}`, geo.quads.map((q) => q.corners[ci][2]));
  }
  s.lst('rmWTopR', geo.quads.map((q) => q.top[0]));
  s.lst('rmWTopG', geo.quads.map((q) => q.top[1]));
  s.lst('rmWTopB', geo.quads.map((q) => q.top[2]));
  s.lst('rmWBotR', geo.quads.map((q) => q.bot[0]));
  s.lst('rmWBotG', geo.quads.map((q) => q.bot[1]));
  s.lst('rmWBotB', geo.quads.map((q) => q.bot[2]));
  s.lst('rmWNx', geo.quads.map((q) => q.n[0]));
  s.lst('rmWNy', geo.quads.map((q) => q.n[1]));
  s.lst('rmWNz', geo.quads.map((q) => q.n[2]));
  s.var('rmWN', geo.quads.length);
  // Static wall colliders (AABBs).
  s.lst('rmColRoom', geo.colliders.map((c) => c.room));
  s.lst('rmColX0', geo.colliders.map((c) => c.x[0]));
  s.lst('rmColX1', geo.colliders.map((c) => c.x[1]));
  s.lst('rmColZ0', geo.colliders.map((c) => c.z[0]));
  s.lst('rmColZ1', geo.colliders.map((c) => c.z[1]));
  s.lst('rmColY0', geo.colliders.map((c) => c.y[0]));
  s.lst('rmColY1', geo.colliders.map((c) => c.y[1]));
  s.var('rmColN', geo.colliders.length);
}

export function defineRoomProcs(ctx: DynCtx): RoomProcs {
  const { s } = ctx;
  const v = (n: string) => s.var(n);

  // ---------- room_update: player room + active set ----------
  const update = s.defineProc('room_update', undefined, true, [
    s.setVar('rmI', 1),
    s.repeat(v('rmN'), [
      s.if(s.land(
        s.land(s.lnot(s.lt(v('psX'), s.itemOf('rmX0', v('rmI')))), s.lnot(s.gt(v('psX'), s.itemOf('rmX1', v('rmI'))))),
        s.land(s.lnot(s.lt(v('psZ'), s.itemOf('rmZ0', v('rmI')))), s.lnot(s.gt(v('psZ'), s.itemOf('rmZ1', v('rmI'))))),
      ), [s.setVar('psRoom', v('rmI'))]),
      s.changeVar('rmI', 1),
    ]),
    s.setVar('rmI', 1),
    s.repeat(v('rmN'), [
      // rmAdj index of (psRoom, rmI) in the flattened matrix.
      s.replaceItem('rmActive', v('rmI'),
        s.itemOf('rmAdj', s.add(s.mul(s.sub(v('psRoom'), 1), v('rmN')), v('rmI')))),
      s.changeVar('rmI', 1),
    ]),
  ]);

  // ---------- room_collide: player vs static wall AABBs ----------
  const collide = s.defineProc('room_collide', undefined, true, [
    s.setVar('rmI', 1),
    s.repeat(v('rmColN'), [
      s.if(roomActiveExpr(s, s.itemOf('rmColRoom', v('rmI'))), [
        // Vertical overlap (provisional player span, as in dyn_collide).
        s.if(s.land(
          s.lt(s.sub(v('camY'), 1.25), s.itemOf('rmColY1', v('rmI'))),
          s.gt(s.add(v('camY'), 0.35), s.itemOf('rmColY0', v('rmI'))),
        ), [
          // dT1/dT2 = box center, dT3/dT4 = extents + player radius,
          // dT5/dT6 = player offset from center, dT7/dT8 = penetrations.
          s.setVar('dT1', s.mul(s.add(s.itemOf('rmColX0', v('rmI')), s.itemOf('rmColX1', v('rmI'))), 0.5)),
          s.setVar('dT2', s.mul(s.add(s.itemOf('rmColZ0', v('rmI')), s.itemOf('rmColZ1', v('rmI'))), 0.5)),
          s.setVar('dT3', s.add(s.mul(s.sub(s.itemOf('rmColX1', v('rmI')), s.itemOf('rmColX0', v('rmI'))), 0.5), v('dynPR'))),
          s.setVar('dT4', s.add(s.mul(s.sub(s.itemOf('rmColZ1', v('rmI')), s.itemOf('rmColZ0', v('rmI'))), 0.5), v('dynPR'))),
          s.setVar('dT5', s.sub(v('camX'), v('dT1'))),
          s.setVar('dT6', s.sub(v('camZ'), v('dT2'))),
          s.if(s.land(s.lt(s.abs(v('dT5')), v('dT3')), s.lt(s.abs(v('dT6')), v('dT4'))), [
            s.setVar('dT7', s.sub(v('dT3'), s.abs(v('dT5')))),
            s.setVar('dT8', s.sub(v('dT4'), s.abs(v('dT6')))),
            s.ifElse(s.lt(v('dT7'), v('dT8')), [
              s.ifElse(s.lt(v('dT5'), 0),
                [s.setVar('camX', s.sub(v('dT1'), v('dT3')))],
                [s.setVar('camX', s.add(v('dT1'), v('dT3')))]),
            ], [
              s.ifElse(s.lt(v('dT6'), 0),
                [s.setVar('camZ', s.sub(v('dT2'), v('dT4')))],
                [s.setVar('camZ', s.add(v('dT2'), v('dT4')))]),
            ]),
            s.setVar('dynMoved', 1),
          ]),
        ]),
      ]),
      s.changeVar('rmI', 1),
    ]),
  ]);

  // ---------- render_rooms: declared room geometry, active rooms only ----------
  const setQuad = (prefix: string): any[] => [0, 1, 2, 3].flatMap((ci) => [
    s.setVar(`qx${ci}`, s.itemOf(`${prefix}X${ci}`, v('rmI'))),
    s.setVar(`qy${ci}`, s.itemOf(`${prefix}Y${ci}`, v('rmI'))),
    s.setVar(`qz${ci}`, s.itemOf(`${prefix}Z${ci}`, v('rmI'))),
  ]);
  const render = s.defineProc('render_rooms', undefined, true, [
    // Floor tiles lie on the mirror plane itself, so they are drawn in
    // the normal pass only (the temple floor does the same).
    s.if(s.eq(v('mirrorFlag'), 0), [
      s.penSetSize(v('adaptStep')), s.setVar('quadMode', 1), s.setVar('cullFlag', 0),
      s.setVar('rmI', 1),
      s.repeat(v('rmFlN'), [
        s.if(roomActiveExpr(s, s.itemOf('rmFlRoom', v('rmI'))), [
          ...setQuad('rmFl'),
          s.setVar('triCol', s.itemOf('rmFlCol', v('rmI'))),
          s.callProc(ctx.drawQuad),
        ]),
        s.changeVar('rmI', 1),
      ]),
    ]),
    // Wall quads: gouraud in the normal pass, flat-averaged in the
    // mirror pass (the render_arch LOD convention).
    s.ifElse(s.eq(v('mirrorFlag'), 1),
      [s.penSetSize(5.2), s.setVar('quadMode', 1), s.setVar('fillLOD', 1)],
      [s.penSetSize(s.mul(1.3, v('adaptStep'))), s.setVar('quadMode', 2), s.setVar('fillLOD', 0)]),
    s.setVar('cullFlag', 1),
    s.setVar('rmI', 1),
    s.repeat(v('rmWN'), [
      s.if(roomActiveExpr(s, s.itemOf('rmWRoom', v('rmI'))), [
        ...setQuad('rmW'),
        s.setVar('qnx', s.itemOf('rmWNx', v('rmI'))),
        s.setVar('qny', s.itemOf('rmWNy', v('rmI'))),
        s.setVar('qnz', s.itemOf('rmWNz', v('rmI'))),
        s.ifElse(s.eq(v('mirrorFlag'), 1), [
          s.setVar('triCol', s.add(
            s.mul(s.floor(s.mul(s.add(s.itemOf('rmWTopR', v('rmI')), s.itemOf('rmWBotR', v('rmI'))), 0.5)), 65536),
            s.add(
              s.mul(s.floor(s.mul(s.add(s.itemOf('rmWTopG', v('rmI')), s.itemOf('rmWBotG', v('rmI'))), 0.5)), 256),
              s.floor(s.mul(s.add(s.itemOf('rmWTopB', v('rmI')), s.itemOf('rmWBotB', v('rmI'))), 0.5)),
            ),
          )),
        ], [
          s.setVar('topR', s.itemOf('rmWTopR', v('rmI'))),
          s.setVar('topG', s.itemOf('rmWTopG', v('rmI'))),
          s.setVar('topB', s.itemOf('rmWTopB', v('rmI'))),
          s.setVar('botR', s.itemOf('rmWBotR', v('rmI'))),
          s.setVar('botG', s.itemOf('rmWBotG', v('rmI'))),
          s.setVar('botB', s.itemOf('rmWBotB', v('rmI'))),
        ]),
        s.callProc(ctx.drawQuad),
      ]),
      s.changeVar('rmI', 1),
    ]),
    s.setVar('fillLOD', 0),
  ]);

  return { update, collide, render };
}

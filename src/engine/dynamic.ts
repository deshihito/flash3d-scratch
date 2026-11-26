/**
 * dynamic.ts — L1 device code for dynamic objects (phase 2).
 *
 * Emitted only when buildTempleProject receives a DynSceneSpec; the
 * phase-1 temple build is untouched (zero extra blocks/vars/lists).
 *
 * What this provides (design-repo-core.md section 3.1 / 3.3, phase 2):
 * - Object table: SoA lists dynKind/dynX/dynY/dynZ/dynYaw/dynR/dynH/
 *   dynHx/dynHy/dynHz/dynColR/dynColG/dynColB/dynPush/dynFlute.
 *   Row index = object slot; render-sort ids are 101+slot. Registration
 *   is compile-time (scene declaration); rows are rewritten in place at
 *   runtime when objects move, so spawn/despawn is "activate/deactivate
 *   a row" for later phases.
 * - Sorting: dynamic rows are appended to the existing objId/objDist
 *   painter sort (sort_5_objects generalized to 5+N entries), so dyn
 *   objects interleave with the temple's sorted objects by distance.
 * - Rendering: runtime shading only (no baked vertex colors):
 *   sphere -> the kernel's shared RT sphere renderer
 *   (render_rt_hero / render_mirror_sphere) with spMat = 2, the
 *   generic material in the hero spheres' own parameter system
 *   (see dynDrawDispatch), cylinder ->
 *   the existing render_smooth_cylinder, box -> dyn_draw_box (6 faces
 *   built per frame, sun-dot gouraud through draw_quad_3d). Plus a blob
 *   contact shadow on the floor plane (generalizing the temple's
 *   hand-placed contact AO ellipses).
 * - Collision (phase 2 scope): player (XZ circle, radius dynPR) vs
 *   dynamic objects (sphere/cylinder as XZ circles, box as AABB),
 *   pushable objects are displaced and clamped to the scene bounds;
 *   if a pushed object cannot fully clear the player (bounds), the
 *   player is pushed out instead. Phase 3 (engine/physics.ts) adds
 *   gravity/velocity/impact on top: physical objects additionally
 *   receive a shove velocity here and held objects are exempt. Player
 *   vs static map stays the temple's existing camera clamp.
 *
 * PROVISIONAL / REVERSIBLE values (engine working defaults, not spec):
 * player body vertical span (camY-1.25 .. camY+0.35) for the overlap
 * test, box ambient shade floor 0.35, blob shadow scale/alpha. The box
 * collider is the world-axis AABB of the declared half extents; yaw is
 * applied to rendering only (OBB is out of scope, design section 3.3).
 */
import type { ProcHandle } from '../builder/index';
import { dynRoomActiveExpr } from './rooms';
import { dynHalfHeight, dynPlayerRadius, resolveDynObject, type DynSceneSpec } from '../scene/dynamic';

export interface DynCtx {
  s: any;
  dyn: DynSceneSpec;
  focal: number;
  sun: [number, number, number];
  drawQuad: ProcHandle;
  smoothCyl: ProcHandle;
  /** render_rt_hero — the kernel's per-pixel RT sphere renderer (shared with the hero spheres). */
  rtHero: ProcHandle;
  /** render_mirror_sphere — the kernel's mirror-pass sphere impostor. */
  mirrorSphere: ProcHandle;
  /**
   * Phase 5: a RoomsSpec is present — dynRoom / rmActive exist and
   * collision + rendering skip objects in inactive rooms.
   */
  rooms?: boolean;
}

const LIST_NAMES = [
  'dynKind', 'dynX', 'dynY', 'dynZ', 'dynYaw', 'dynR', 'dynH',
  'dynHx', 'dynHy', 'dynHz', 'dynColR', 'dynColG', 'dynColB',
  'dynPush', 'dynFlute', 'dynMetal',
] as const;

/** Declare the SoA lists and registers. Call before any proc emission that references them. */
export function declareDynData(s: any, dyn: DynSceneSpec): void {
  const objs = dyn.objects.map(resolveDynObject);
  const cols: Record<string, unknown[]> = {
    dynKind: objs.map((o) => o.kindCode),
    dynX: objs.map((o) => o.pos[0]),
    dynY: objs.map((o) => o.pos[1]),
    dynZ: objs.map((o) => o.pos[2]),
    dynYaw: objs.map((o) => o.yawDeg),
    dynR: objs.map((o) => o.radius),
    dynH: objs.map((o) => o.height),
    dynHx: objs.map((o) => o.halfExtents[0]),
    dynHy: objs.map((o) => dynHalfHeight(o)),
    dynHz: objs.map((o) => o.halfExtents[2]),
    dynColR: objs.map((o) => o.col255[0]),
    dynColG: objs.map((o) => o.col255[1]),
    dynColB: objs.map((o) => o.col255[2]),
    dynPush: objs.map((o) => o.pushable),
    dynFlute: objs.map((o) => o.fluted),
    dynMetal: objs.map((o) => o.metal),
  };
  for (const name of LIST_NAMES) s.lst(name, cols[name]);
  s.var('dynN', dyn.objects.length);
  s.var('dynFloorY', dyn.floorY);
  s.var('dynPR', dynPlayerRadius(dyn));
  s.var('dynBdX0', dyn.bounds.x[0]);
  s.var('dynBdX1', dyn.bounds.x[1]);
  s.var('dynBdZ0', dyn.bounds.z[0]);
  s.var('dynBdZ1', dyn.bounds.z[1]);
  s.var('dynMoved', 0);
  s.var('dynI', 0);
  s.var('dynIdx', 0);
  for (const v of ['oKind', 'oX', 'oY', 'oZ', 'oYaw', 'oR', 'oH', 'oHx', 'oHy', 'oHz', 'oPush', 'oFlute', 'oColR', 'oColG', 'oColB', 'oMetal', 'oPhys', 'oHeld', 'oSleep', 'oVX', 'oVY', 'oVZ']) s.var(v, 0);
  for (const v of ['dT1', 'dT2', 'dT3', 'dT4', 'dT5', 'dT6', 'dT7', 'dT8', 'dT9', 'dT10', 'dT11', 'dT12', 'dT13', 'dT14', 'dCos', 'dSin', 'dExx', 'dExz', 'dEzx', 'dEzz', 'dShade', 'dN', 'dStep', 'dI', 'dChord']) s.var(v, 0);
}

/** Extra sort entries appended inside sort_5_objects (ids 101+slot, squared distance to camera). */
export function dynSortEntries(ctx: DynCtx): any[] {
  const { s } = ctx;
  const camX = s.var('camX'), camY = s.var('camY'), camZ = s.var('camZ');
  const out: any[] = [];
  ctx.dyn.objects.forEach((_o, ix) => {
    const k = ix + 1;
    const dx = s.sub(s.itemOf('dynX', k), camX);
    const dy = s.sub(s.itemOf('dynY', k), camY);
    const dz = s.sub(s.itemOf('dynZ', k), camZ);
    out.push(
      s.replaceItem('objId', 5 + k, 100 + k),
      s.replaceItem('objDist', 5 + k, s.add(s.mul(dx, dx), s.add(s.mul(dy, dy), s.mul(dz, dz)))),
    );
  });
  return out;
}

/** Camera-space transform by register name — same math as the temple kernel's camXform closure. */
function camXform(s: any, vx: any, vy: any, vz: any, ox: string, oy: string, oz: string): any[] {
  const dx = s.var('dx'), dy = s.var('dy'), dz = s.var('dz');
  return [
    s.setVar('dx', s.sub(vx, s.var('camX'))),
    s.ifElse(s.eq(s.var('mirrorFlag'), 1),
      [s.setVar('dy', s.sub(s.sub(-2.4, vy), s.var('camY')))],
      [s.setVar('dy', s.sub(vy, s.var('camY')))]),
    s.setVar('dz', s.sub(vz, s.var('camZ'))),
    s.setVar(ox, s.add(s.mul(dx, s.var('rgtX')), s.mul(dz, s.var('rgtZ')))),
    s.setVar(oy, s.add(s.mul(dx, s.var('upX')), s.add(s.mul(dy, s.var('upY')), s.mul(dz, s.var('upZ'))))),
    s.setVar(oz, s.add(s.mul(dx, s.var('fwdX')), s.add(s.mul(dy, s.var('fwdY')), s.mul(dz, s.var('fwdZ'))))),
  ];
}

/**
 * Load the current object's row (register dynIdx) into the o* registers.
 * Includes the phase-3 physics columns (dynPhys/dynHeld/dynSleep/dynV*);
 * those lists are declared by declarePhysData (engine/physics.ts), which
 * buildTempleProject calls before any proc emission.
 */
export function loadRow(s: any, idx: any): any[] {
  const pairs: Array<[string, string]> = [
    ['oKind', 'dynKind'], ['oX', 'dynX'], ['oY', 'dynY'], ['oZ', 'dynZ'],
    ['oYaw', 'dynYaw'], ['oR', 'dynR'], ['oH', 'dynH'], ['oHx', 'dynHx'],
    ['oHy', 'dynHy'], ['oHz', 'dynHz'], ['oColR', 'dynColR'], ['oColG', 'dynColG'],
    ['oColB', 'dynColB'], ['oPush', 'dynPush'], ['oFlute', 'dynFlute'],
    ['oMetal', 'dynMetal'],
    ['oPhys', 'dynPhys'], ['oHeld', 'dynHeld'], ['oSleep', 'dynSleep'],
    ['oVX', 'dynVX'], ['oVY', 'dynVY'], ['oVZ', 'dynVZ'],
  ];
  return pairs.map(([v, l]) => s.setVar(v, s.itemOf(l, idx)));
}

export interface DynProcs { box: ProcHandle; collide: ProcHandle }

/** Define dyn_draw_box / dyn_collide. Call after draw_quad_3d exists. */
export function defineDynProcs(ctx: DynCtx): DynProcs {
  const { s, focal, sun } = ctx;
  const v = (n: string) => s.var(n);
  // --- dyn_draw_box: 6 faces from center + yaw + half extents, sun-dot gouraud via draw_quad_3d.
  const ex = (su: number, sw: number) =>
    s.add(v('oX'), s.add(s.mul(su, v('dExx')), s.mul(sw, v('dEzx'))));
  const ez = (su: number, sw: number) =>
    s.add(v('oZ'), s.add(s.mul(su, v('dExz')), s.mul(sw, v('dEzz'))));
  const ey = (sv: number) => s.add(v('oY'), s.mul(sv, v('oHy')));
  // Per-face Blinn specular (look pass, 2026-11-26): ndoth^8 against the
  // half vector prepared in the box proc (dT2..dT4 = h, dT8 = |h|), added
  // as (255 - albedo) * spec * 0.5 so it whitens toward white and can
  // never overflow a channel (albedo*shade <= albedo, plus at most
  // (255-albedo)/2). Specular result lands in dT5. Computed in the
  // original world space in both passes, same convention as the
  // existing diffuse term.
  // Environment tint per face orientation (look pass 2, light touch):
  // the top face leans toward the sky color, the bottom toward the
  // floor's warm checker average, sides toward the horizon tone, so
  // boxes sit in the same environment as the reflective spheres
  // instead of reading as flat-shaded icons. Blend weight scales
  // with the face's sun shade; 0.30 and the env colors are working
  // values matched to the kernel's sky/floor palette.
  const face = (n: [any, any, any], ndotl: any, corners: Array<[number, number, number]>): any[] => {
    const env: [number, number, number] = n[1] === 1 ? [172, 196, 232] : n[1] === -1 ? [150, 134, 110] : [178, 172, 158];
    return [
    s.setVar('dT1', ndotl),
    s.if(s.lt(v('dT1'), 0), [s.setVar('dT1', 0)]),
    s.setVar('dShade', s.add(0.35, s.mul(0.65, v('dT1')))),
    s.setVar('dT1', s.div(s.add(s.mul(n[0], v('dT2')), s.add(s.mul(n[1], v('dT3')), s.mul(n[2], v('dT4')))), v('dT8'))),
    s.if(s.lt(v('dT1'), 0), [s.setVar('dT1', 0)]),
    s.setVar('dT5', s.mul(v('dT1'), v('dT1'))),
    s.setVar('dT5', s.mul(v('dT5'), v('dT5'))),
    s.setVar('dT5', s.mul(v('dT5'), v('dT5'))),
    s.setVar('colR', s.floor(s.add(s.mul(v('oColR'), v('dShade')), s.mul(s.sub(255, v('oColR')), s.mul(v('dT5'), 0.5))))),
    s.setVar('colG', s.floor(s.add(s.mul(v('oColG'), v('dShade')), s.mul(s.sub(255, v('oColG')), s.mul(v('dT5'), 0.5))))),
    s.setVar('colB', s.floor(s.add(s.mul(v('oColB'), v('dShade')), s.mul(s.sub(255, v('oColB')), s.mul(v('dT5'), 0.5))))),
    s.setVar('colR', s.floor(s.add(v('colR'), s.mul(s.sub(env[0], v('colR')), s.mul(0.30, v('dShade')))))),
    s.setVar('colG', s.floor(s.add(v('colG'), s.mul(s.sub(env[1], v('colG')), s.mul(0.30, v('dShade')))))),
    s.setVar('colB', s.floor(s.add(v('colB'), s.mul(s.sub(env[2], v('colB')), s.mul(0.30, v('dShade')))))),
    ...corners.flatMap(([su, sv, sw], ci) => [
      s.setVar(`qx${ci}`, ex(su, sw)), s.setVar(`qy${ci}`, ey(sv)), s.setVar(`qz${ci}`, ez(su, sw)),
    ]),
    s.setVar('qnx', n[0]), s.setVar('qny', n[1]), s.setVar('qnz', n[2]),
    s.setVar('topR', v('colR')), s.setVar('topG', v('colG')), s.setVar('topB', v('colB')),
    s.setVar('botR', v('colR')), s.setVar('botG', v('colG')), s.setVar('botB', v('colB')),
    s.callProc(ctx.drawQuad),
    ];
  };
  const nU: [any, any, any] = [v('dCos'), 0, s.mul(v('dSin'), -1)];
  const nW: [any, any, any] = [v('dSin'), 0, v('dCos')];
  const dotU = s.add(s.mul(sun[0], v('dCos')), s.mul(sun[2], s.mul(v('dSin'), -1)));
  const dotW = s.add(s.mul(sun[0], v('dSin')), s.mul(sun[2], v('dCos')));
  const box = s.defineProc('dyn_draw_box', undefined, true, [
    s.setVar('dCos', s.cos(v('oYaw'))), s.setVar('dSin', s.sin(v('oYaw'))),
    s.setVar('dExx', s.mul(v('dCos'), v('oHx'))), s.setVar('dExz', s.mul(s.mul(v('dSin'), -1), v('oHx'))),
    s.setVar('dEzx', s.mul(v('dSin'), v('oHz'))), s.setVar('dEzz', s.mul(v('dCos'), v('oHz'))),
    s.penSetSize(s.mul(1.2, v('adaptStep'))), s.setVar('quadMode', 2), s.setVar('cullFlag', 1), s.setVar('fillLOD', 0),
    // Half vector for the per-face specular: view (center -> camera,
    // dT5..dT7 scratch) normalized, plus the sun; h kept in dT2..dT4
    // with |h| in dT8 (guarded against the degenerate sun = -view case).
    s.setVar('dT5', s.sub(v('camX'), v('oX'))),
    s.setVar('dT6', s.sub(v('camY'), v('oY'))),
    s.setVar('dT7', s.sub(v('camZ'), v('oZ'))),
    s.setVar('dT8', s.sqrt(s.add(s.mul(v('dT5'), v('dT5')), s.add(s.mul(v('dT6'), v('dT6')), s.mul(v('dT7'), v('dT7')))))),
    s.if(s.lt(v('dT8'), 0.001), [s.setVar('dT8', 1)]),
    s.setVar('dT2', s.add(sun[0], s.div(v('dT5'), v('dT8')))),
    s.setVar('dT3', s.add(sun[1], s.div(v('dT6'), v('dT8')))),
    s.setVar('dT4', s.add(sun[2], s.div(v('dT7'), v('dT8')))),
    s.setVar('dT8', s.sqrt(s.add(s.mul(v('dT2'), v('dT2')), s.add(s.mul(v('dT3'), v('dT3')), s.mul(v('dT4'), v('dT4')))))),
    s.if(s.lt(v('dT8'), 0.01), [s.setVar('dT2', 0), s.setVar('dT3', 1), s.setVar('dT4', 0), s.setVar('dT8', 1)]),
    ...face(nU, dotU, [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]]),
    ...face([s.mul(v('dCos'), -1), 0, v('dSin')], s.mul(dotU, -1), [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]]),
    ...face([0, 1, 0], sun[1], [[1, 1, 1], [-1, 1, 1], [-1, 1, -1], [1, 1, -1]]),
    ...face([0, -1, 0], -sun[1], [[1, -1, -1], [-1, -1, -1], [-1, -1, 1], [1, -1, 1]]),
    ...face(nW, dotW, [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]]),
    ...face([s.mul(v('dSin'), -1), 0, s.mul(v('dCos'), -1)], s.mul(dotW, -1), [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]]),
  ]);

  // --- dyn_collide: player vs dynamic objects, with pushing.
  const clampTo = (val: any, lo: any, hi: any, reg: string): any[] => [
    s.setVar(reg, val),
    s.if(s.lt(v(reg), lo), [s.setVar(reg, lo)]),
    s.if(s.gt(v(reg), hi), [s.setVar(reg, hi)]),
  ];
  const circlePath: any[] = [
    // dT1=dx, dT2=dz (object -> player), dT3=minDist, dT4=dist^2
    s.setVar('dT1', s.sub(v('camX'), v('oX'))),
    s.setVar('dT2', s.sub(v('camZ'), v('oZ'))),
    s.setVar('dT3', s.add(v('oR'), v('dynPR'))),
    s.setVar('dT4', s.add(s.mul(v('dT1'), v('dT1')), s.mul(v('dT2'), v('dT2')))),
    s.if(s.land(s.lt(v('dT4'), s.mul(v('dT3'), v('dT3'))), s.gt(v('dT4'), 0.000001)), [
      s.setVar('dT4', s.sqrt(v('dT4'))), // dist
      s.setVar('dT5', s.div(v('dT1'), v('dT4'))), // ux
      s.setVar('dT6', s.div(v('dT2'), v('dT4'))), // uz
      s.setVar('dT7', s.sub(v('dT3'), v('dT4'))), // overlap
      s.ifElse(s.eq(v('oPush'), 1), [
        // Move the object away from the player, clamped to bounds (radius margin).
        ...clampTo(s.sub(v('oX'), s.mul(v('dT5'), v('dT7'))), s.add(v('dynBdX0'), v('oR')), s.sub(v('dynBdX1'), v('oR')), 'dT8'),
        s.replaceItem('dynX', v('dynI'), v('dT8')),
        ...clampTo(s.sub(v('oZ'), s.mul(v('dT6'), v('dT7'))), s.add(v('dynBdZ0'), v('oR')), s.sub(v('dynBdZ1'), v('oR')), 'dT8'),
        s.replaceItem('dynZ', v('dynI'), v('dT8')),
        s.setVar('dynMoved', 1),
        // Phase 3: a physical object also receives a shove velocity (and
        // wakes), so it keeps sliding under the physics step. dT5/dT6 are
        // the unit vector object -> player, hence the negative sign.
        s.if(s.eq(v('oPhys'), 1), [
          s.replaceItem('dynSleep', v('dynI'), 0),
          s.replaceItem('dynVX', v('dynI'), s.mul(v('dT5'), s.mul(v('physPushSpd'), -1))),
          s.replaceItem('dynVZ', v('dynI'), s.mul(v('dT6'), s.mul(v('physPushSpd'), -1))),
        ]),
        // If the object could not fully clear (bounds), push the player out instead.
        s.setVar('oX', s.itemOf('dynX', v('dynI'))),
        s.setVar('oZ', s.itemOf('dynZ', v('dynI'))),
        s.setVar('dT1', s.sub(v('camX'), v('oX'))),
        s.setVar('dT2', s.sub(v('camZ'), v('oZ'))),
        s.setVar('dT4', s.add(s.mul(v('dT1'), v('dT1')), s.mul(v('dT2'), v('dT2')))),
        s.if(s.land(s.lt(v('dT4'), s.mul(v('dT3'), v('dT3'))), s.gt(v('dT4'), 0.000001)), [
          s.setVar('dT4', s.sqrt(v('dT4'))),
          s.setVar('camX', s.add(v('oX'), s.mul(s.div(v('dT1'), v('dT4')), v('dT3')))),
          s.setVar('camZ', s.add(v('oZ'), s.mul(s.div(v('dT2'), v('dT4')), v('dT3')))),
        ]),
      ], [
        s.setVar('camX', s.add(v('oX'), s.mul(v('dT5'), v('dT3')))),
        s.setVar('camZ', s.add(v('oZ'), s.mul(v('dT6'), v('dT3')))),
      ]),
    ]),
  ];
  const boxAxis = (axis: 'x' | 'z'): any[] => {
    const d = axis === 'x' ? 'dT1' : 'dT2';
    const pen = axis === 'x' ? 'dT5' : 'dT6';
    const ext = axis === 'x' ? 'dT3' : 'dT4';
    const oPos = axis === 'x' ? 'oX' : 'oZ';
    const list = axis === 'x' ? 'dynX' : 'dynZ';
    const half = axis === 'x' ? 'oHx' : 'oHz';
    const bd0 = axis === 'x' ? 'dynBdX0' : 'dynBdZ0';
    const bd1 = axis === 'x' ? 'dynBdX1' : 'dynBdZ1';
    const cam = axis === 'x' ? 'camX' : 'camZ';
    return [
      s.setVar('dT7', 1),
      s.if(s.lt(v(d), 0), [s.setVar('dT7', -1)]),
      s.ifElse(s.eq(v('oPush'), 1), [
        ...clampTo(s.sub(v(oPos), s.mul(v('dT7'), v(pen))), s.add(v(bd0), v(half)), s.sub(v(bd1), v(half)), 'dT8'),
        s.replaceItem(list, v('dynI'), v('dT8')),
        s.setVar('dynMoved', 1),
        // Phase 3: physical boxes also get a shove velocity along the axis.
        s.if(s.eq(v('oPhys'), 1), [
          s.replaceItem('dynSleep', v('dynI'), 0),
          s.replaceItem(axis === 'x' ? 'dynVX' : 'dynVZ', v('dynI'), s.mul(v('dT7'), s.mul(v('physPushSpd'), -1))),
        ]),
        s.setVar(oPos, s.itemOf(list, v('dynI'))),
        s.setVar(d, s.sub(v(cam), v(oPos))),
        s.if(s.lt(s.abs(v(d)), v(ext)), [
          s.setVar('dT7', 1),
          s.if(s.lt(v(d), 0), [s.setVar('dT7', -1)]),
          s.setVar(cam, s.add(v(oPos), s.mul(v('dT7'), v(ext)))),
        ]),
      ], [
        s.setVar(cam, s.add(v(oPos), s.mul(v('dT7'), v(ext)))),
      ]),
    ];
  };
  const boxPath: any[] = [
    s.setVar('dT1', s.sub(v('camX'), v('oX'))),
    s.setVar('dT2', s.sub(v('camZ'), v('oZ'))),
    s.setVar('dT3', s.add(v('oHx'), v('dynPR'))),
    s.setVar('dT4', s.add(v('oHz'), v('dynPR'))),
    s.if(s.land(s.lt(s.abs(v('dT1')), v('dT3')), s.lt(s.abs(v('dT2')), v('dT4'))), [
      s.setVar('dT5', s.sub(v('dT3'), s.abs(v('dT1')))),
      s.setVar('dT6', s.sub(v('dT4'), s.abs(v('dT2')))),
      s.ifElse(s.lt(v('dT5'), v('dT6')), boxAxis('x'), boxAxis('z')),
    ]),
  ];
  const collide = s.defineProc('dyn_collide', undefined, true, [
    s.setVar('dynMoved', 0),
    s.setVar('dynI', 1),
    s.repeat(v('dynN'), [
      ...loadRow(s, v('dynI')),
      // Vertical overlap: player body span camY-1.25..camY+0.35 (PROVISIONAL).
      // A held object (phase 3) is exempt: it rides in front of the camera.
      // Phase 5: objects in inactive rooms do not collide either.
      s.if(s.land(s.eq(v('oHeld'), 0), s.land(
        s.lt(s.sub(v('camY'), 1.25), s.add(v('oY'), v('oHy'))),
        s.gt(s.add(v('camY'), 0.35), s.sub(v('oY'), v('oHy'))),
      )), [
        ...(ctx.rooms
          ? [s.if(dynRoomActiveExpr(s, v('dynI')), [s.ifElse(s.eq(v('oKind'), 3), boxPath, circlePath)])]
          : [s.ifElse(s.eq(v('oKind'), 3), boxPath, circlePath)]),
      ]),
      s.changeVar('dynI', 1),
    ]),
  ]);

  return { box, collide };
}

/**
 * Render dispatch for sort ids > 100, called from renderSortedObjects.
 * Loads the row into o* registers, draws a blob contact shadow (normal
 * pass only), then dispatches to the shape renderer.
 */
export function dynDrawDispatch(ctx: DynCtx, isMirror: boolean, procs: { box: ProcHandle }): any[] {
  const { s, focal } = ctx;
  const v = (n: string) => s.var(n);
  const blob: any[] = isMirror ? [] : [
    s.setVar('dT1', v('oR')),
    s.if(s.eq(v('oKind'), 3), [
      s.setVar('dT1', v('oHx')),
      s.if(s.gt(v('oHz'), v('oHx')), [s.setVar('dT1', v('oHz'))]),
    ]),
    ...camXform(s, v('oX'), s.add(v('dynFloorY'), 0.02), v('oZ'), 'cx0', 'cy0', 'cz0'),
    s.if(s.gt(v('cz0'), 0.5), [
      s.setVar('sx0', s.mul(s.div(v('cx0'), v('cz0')), focal)),
      s.setVar('sy0', s.mul(s.div(v('cy0'), v('cz0')), focal)),
      s.setVar('dT2', s.div(s.mul(200, v('dT1')), v('cz0'))), // half-width px (PROVISIONAL scale)
      s.setVar('dT3', s.mul(v('dT2'), 0.38)),
      ...([[1.0, 10], [0.7, 14], [0.45, 20]] as Array<[number, number]>).flatMap(([sc, al]) => [
        s.penSetSize(s.mul(v('dT3'), sc)),
        s.penSetColor(((al * 16777216) + (18 * 65536) + (20 * 256) + 32)),
        s.gotoXy(s.sub(v('sx0'), s.mul(v('dT2'), sc * 0.45)), v('sy0')),
        s.penDown(),
        s.gotoXy(s.add(v('sx0'), s.mul(v('dT2'), sc * 0.45)), v('sy0')),
        s.penUp(),
      ]),
    ]),
  ];
  // --- sphere: the kernel's shared RT sphere renderer (spMat = 2).
  // Dynamic spheres are NOT drawn by a look-alike: they go through
  // render_rt_hero (and render_mirror_sphere in the mirror pass),
  // the exact per-pixel path that draws the gold / obsidian hero
  // spheres, with the object's position / radius in spX/spY/spZ/spR.
  // The material registers are filled from the object's tint
  // (oColR/G/B, 0..255) and metalness (oMetal) by mixing the two hero
  // presets in their own parameter system (see hybrid-engine.ts):
  //   F0   = mix(0.16 gray, tint, metal)      (obsidian .. gold)
  //   rise = mix(0.72, 1 - F0, metal)         (per channel)
  //   base = tint * 0.14 * (1 - metal)        (obsidian body color;
  //          (0.03, 0.035, 0.05) at its tint, 0 for metals)
  //   spec scale = mix((8.5, 6.5, 4.5), 6.3 * F0, metal)
  //          (gold's (6.2, 4.1, 1.4) ~= 6.3 * its F0 (0.94, 0.70, 0.22))
  // and the specular exponent follows metalness (16 metal / 24
  // dielectric) inside render_rt_hero's spMat = 2 branch.
  const matChan = (col: string, f0: string, ris: string, bas: string, spc: string, obsSpc: number): any[] => [
    s.setVar(f0, s.add(0.16, s.mul(s.sub(s.div(v(col), 255), 0.16), v('oMetal')))),
    s.setVar(ris, s.add(0.72, s.mul(s.sub(s.sub(1, v(f0)), 0.72), v('oMetal')))),
    s.setVar(bas, s.mul(s.mul(s.div(v(col), 255), 0.14), s.sub(1, v('oMetal')))),
    s.setVar(spc, s.add(obsSpc, s.mul(s.sub(s.mul(6.3, v(f0)), obsSpc), v('oMetal')))),
  ];
  const sphereSetup: any[] = [
    s.setVar('spX', v('oX')), s.setVar('spY', v('oY')), s.setVar('spZ', v('oZ')),
    s.setVar('spR', v('oR')), s.setVar('spMat', 2),
    s.setVar('mMetal', v('oMetal')),
    s.setVar('mColR', v('oColR')), s.setVar('mColG', v('oColG')), s.setVar('mColB', v('oColB')),
    ...matChan('oColR', 'mF0R', 'mRisR', 'mBasR', 'mSpcR', 8.5),
    ...matChan('oColG', 'mF0G', 'mRisG', 'mBasG', 'mSpcG', 6.5),
    ...matChan('oColB', 'mF0B', 'mRisB', 'mBasB', 'mSpcB', 4.5),
  ];
  const sphereCall: any[] = isMirror
    ? [...sphereSetup, s.callProc(ctx.mirrorSphere)]
    : [
        ...sphereSetup,
        // Resolution rides on the hero spheres' SPHERE_STEP mechanism
        // (render_rt_hero reads SPHERE_STEP for its sample grid, pen
        // size and the checkerboard split): pick the step from the
        // projected radius so small / far spheres don't pay full
        // resolution, and save / restore SPHERE_STEP around the call
        // (dT13 = save slot) so hero spheres sorted after this object
        // in the same frame keep the frame's step.
        ...camXform(s, v('oX'), v('oY'), v('oZ'), 'cx0', 'cy0', 'cz0'),
        s.setVar('dT13', v('SPHERE_STEP')),
        s.if(s.gt(v('cz0'), 0.2), [
          s.setVar('dT14', s.mul(s.div(v('oR'), v('cz0')), focal)), // projected radius, px
          s.ifElse(s.gt(v('dT14'), 56), [s.setVar('SPHERE_STEP', 1)], [
            s.ifElse(s.gt(v('dT14'), 28), [s.setVar('SPHERE_STEP', 2)], [
              s.ifElse(s.gt(v('dT14'), 14), [s.setVar('SPHERE_STEP', 3)], [s.setVar('SPHERE_STEP', 4)]),
            ]),
          ]),
        ]),
        s.callProc(ctx.rtHero),
        s.setVar('SPHERE_STEP', v('dT13')),
      ];
  const body: any[] = [
    s.setVar('dynIdx', s.sub(v('curObj'), 100)),
    ...loadRow(s, v('dynIdx')),
    ...blob,
    s.ifElse(s.eq(v('oKind'), 1), sphereCall, [
      s.ifElse(s.eq(v('oKind'), 2), [
        s.setVar('cylX', v('oX')), s.setVar('cylZ', v('oZ')),
        s.setVar('cylY0', s.sub(v('oY'), s.div(v('oH'), 2))),
        s.setVar('cylY1', s.add(v('oY'), s.div(v('oH'), 2))),
        s.setVar('cylR', v('oR')), s.setVar('cylFlute', v('oFlute')),
        s.callProc(ctx.smoothCyl),
      ], [s.callProc(procs.box)]),
    ]),
  ];
  // Phase 5: skip rendering objects in inactive rooms entirely.
  if (ctx.rooms) {
    return [body[0], s.if(dynRoomActiveExpr(s, v('dynIdx')), body.slice(1))];
  }
  return body;
}

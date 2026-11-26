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
 *   sphere -> dyn_draw_sphere (layered-disc shading in the style of
 *   render_mirror_sphere, material color from the table), cylinder ->
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
import { dynHalfHeight, dynPlayerRadius, resolveDynObject, type DynSceneSpec } from '../scene/dynamic';

export interface DynCtx {
  s: any;
  dyn: DynSceneSpec;
  focal: number;
  sun: [number, number, number];
  drawQuad: ProcHandle;
  smoothCyl: ProcHandle;
}

const LIST_NAMES = [
  'dynKind', 'dynX', 'dynY', 'dynZ', 'dynYaw', 'dynR', 'dynH',
  'dynHx', 'dynHy', 'dynHz', 'dynColR', 'dynColG', 'dynColB',
  'dynPush', 'dynFlute',
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
  for (const v of ['oKind', 'oX', 'oY', 'oZ', 'oYaw', 'oR', 'oH', 'oHx', 'oHy', 'oHz', 'oPush', 'oFlute', 'oColR', 'oColG', 'oColB', 'oPhys', 'oHeld', 'oSleep', 'oVX', 'oVY', 'oVZ']) s.var(v, 0);
  for (const v of ['dT1', 'dT2', 'dT3', 'dT4', 'dT5', 'dT6', 'dT7', 'dT8', 'dCos', 'dSin', 'dExx', 'dExz', 'dEzx', 'dEzz', 'dShade']) s.var(v, 0);
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
    ['oPhys', 'dynPhys'], ['oHeld', 'dynHeld'], ['oSleep', 'dynSleep'],
    ['oVX', 'dynVX'], ['oVY', 'dynVY'], ['oVZ', 'dynVZ'],
  ];
  return pairs.map(([v, l]) => s.setVar(v, s.itemOf(l, idx)));
}

export interface DynProcs { sphere: ProcHandle; box: ProcHandle; collide: ProcHandle }

/** Define dyn_draw_sphere / dyn_draw_box / dyn_collide. Call after draw_quad_3d exists. */
export function defineDynProcs(ctx: DynCtx): DynProcs {
  const { s, focal, sun } = ctx;
  const v = (n: string) => s.var(n);
  const pack = (r: any, g: any, b: any) => s.add(s.mul(r, 65536), s.add(s.mul(g, 256), b));
  const packA = (a: any, r: any, g: any, b: any) => s.add(s.mul(a, 16777216), pack(r, g, b));

  // --- dyn_draw_sphere: layered discs, runtime-lit from the material color.
  const sphere = s.defineProc('dyn_draw_sphere', undefined, true, [
    ...camXform(s, v('oX'), v('oY'), v('oZ'), 'cx0', 'cy0', 'cz0'),
    s.if(s.gt(v('cz0'), s.add(v('oR'), 0.2)), [
      s.setVar('sx0', s.mul(s.div(v('cx0'), v('cz0')), focal)),
      s.setVar('sy0', s.mul(s.div(v('cy0'), v('cz0')), focal)),
      s.setVar('sr', s.mul(s.div(v('oR'), v('cz0')), focal)),
      // base disc
      s.gotoXy(v('sx0'), v('sy0')), s.penSetSize(s.mul(v('sr'), 2.0)),
      s.penSetColor(pack(v('oColR'), v('oColG'), v('oColB'))), s.penDown(), s.penUp(),
      // light disc (toward the sun side, lerped to white, translucent)
      s.setVar('dT1', s.floor(s.add(v('oColR'), s.mul(s.sub(255, v('oColR')), 0.4)))),
      s.setVar('dT2', s.floor(s.add(v('oColG'), s.mul(s.sub(255, v('oColG')), 0.4)))),
      s.setVar('dT3', s.floor(s.add(v('oColB'), s.mul(s.sub(255, v('oColB')), 0.4)))),
      s.gotoXy(s.add(v('sx0'), s.mul(v('sr'), 0.16)), s.sub(v('sy0'), s.mul(v('sr'), 0.16))),
      s.penSetSize(s.mul(v('sr'), 1.3)), s.penSetColor(packA(150, v('dT1'), v('dT2'), v('dT3'))), s.penDown(), s.penUp(),
      // specular dot
      s.setVar('dT1', s.floor(s.add(v('oColR'), s.mul(s.sub(255, v('oColR')), 0.85)))),
      s.setVar('dT2', s.floor(s.add(v('oColG'), s.mul(s.sub(255, v('oColG')), 0.85)))),
      s.setVar('dT3', s.floor(s.add(v('oColB'), s.mul(s.sub(255, v('oColB')), 0.85)))),
      s.gotoXy(s.add(v('sx0'), s.mul(v('sr'), 0.34)), s.sub(v('sy0'), s.mul(v('sr'), 0.34))),
      s.penSetSize(s.mul(v('sr'), 0.38)), s.penSetColor(packA(230, v('dT1'), v('dT2'), v('dT3'))), s.penDown(), s.penUp(),
    ]),
  ]);

  // --- dyn_draw_box: 6 faces from center + yaw + half extents, sun-dot gouraud via draw_quad_3d.
  const ex = (su: number, sw: number) =>
    s.add(v('oX'), s.add(s.mul(su, v('dExx')), s.mul(sw, v('dEzx'))));
  const ez = (su: number, sw: number) =>
    s.add(v('oZ'), s.add(s.mul(su, v('dExz')), s.mul(sw, v('dEzz'))));
  const ey = (sv: number) => s.add(v('oY'), s.mul(sv, v('oHy')));
  const face = (n: [any, any, any], ndotl: any, corners: Array<[number, number, number]>): any[] => [
    s.setVar('dT1', ndotl),
    s.if(s.lt(v('dT1'), 0), [s.setVar('dT1', 0)]),
    s.setVar('dShade', s.add(0.35, s.mul(0.65, v('dT1')))),
    s.setVar('colR', s.floor(s.mul(v('oColR'), v('dShade')))),
    s.setVar('colG', s.floor(s.mul(v('oColG'), v('dShade')))),
    s.setVar('colB', s.floor(s.mul(v('oColB'), v('dShade')))),
    ...corners.flatMap(([su, sv, sw], ci) => [
      s.setVar(`qx${ci}`, ex(su, sw)), s.setVar(`qy${ci}`, ey(sv)), s.setVar(`qz${ci}`, ez(su, sw)),
    ]),
    s.setVar('qnx', n[0]), s.setVar('qny', n[1]), s.setVar('qnz', n[2]),
    s.setVar('topR', v('colR')), s.setVar('topG', v('colG')), s.setVar('topB', v('colB')),
    s.setVar('botR', v('colR')), s.setVar('botG', v('colG')), s.setVar('botB', v('colB')),
    s.callProc(ctx.drawQuad),
  ];
  const nU: [any, any, any] = [v('dCos'), 0, s.mul(v('dSin'), -1)];
  const nW: [any, any, any] = [v('dSin'), 0, v('dCos')];
  const dotU = s.add(s.mul(sun[0], v('dCos')), s.mul(sun[2], s.mul(v('dSin'), -1)));
  const dotW = s.add(s.mul(sun[0], v('dSin')), s.mul(sun[2], v('dCos')));
  const box = s.defineProc('dyn_draw_box', undefined, true, [
    s.setVar('dCos', s.cos(v('oYaw'))), s.setVar('dSin', s.sin(v('oYaw'))),
    s.setVar('dExx', s.mul(v('dCos'), v('oHx'))), s.setVar('dExz', s.mul(s.mul(v('dSin'), -1), v('oHx'))),
    s.setVar('dEzx', s.mul(v('dSin'), v('oHz'))), s.setVar('dEzz', s.mul(v('dCos'), v('oHz'))),
    s.penSetSize(2.4), s.setVar('quadMode', 2), s.setVar('cullFlag', 1),
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
      s.if(s.land(s.eq(v('oHeld'), 0), s.land(
        s.lt(s.sub(v('camY'), 1.25), s.add(v('oY'), v('oHy'))),
        s.gt(s.add(v('camY'), 0.35), s.sub(v('oY'), v('oHy'))),
      )), [
        s.ifElse(s.eq(v('oKind'), 3), boxPath, circlePath),
      ]),
      s.changeVar('dynI', 1),
    ]),
  ]);

  return { sphere, box, collide };
}

/**
 * Render dispatch for sort ids > 100, called from renderSortedObjects.
 * Loads the row into o* registers, draws a blob contact shadow (normal
 * pass only), then dispatches to the shape renderer.
 */
export function dynDrawDispatch(ctx: DynCtx, isMirror: boolean, procs: { sphere: ProcHandle; box: ProcHandle }): any[] {
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
  return [
    s.setVar('dynIdx', s.sub(v('curObj'), 100)),
    ...loadRow(s, v('dynIdx')),
    ...blob,
    s.ifElse(s.eq(v('oKind'), 1), [s.callProc(procs.sphere)], [
      s.ifElse(s.eq(v('oKind'), 2), [
        s.setVar('cylX', v('oX')), s.setVar('cylZ', v('oZ')),
        s.setVar('cylY0', s.sub(v('oY'), s.div(v('oH'), 2))),
        s.setVar('cylY1', s.add(v('oY'), s.div(v('oH'), 2))),
        s.setVar('cylR', v('oR')), s.setVar('cylFlute', v('oFlute')),
        s.callProc(ctx.smoothCyl),
      ], [s.callProc(procs.box)]),
    ]),
  ];
}

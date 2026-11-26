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
 *   sphere -> dyn_draw_sphere (environment-reflection strips via
 *   trace_refl_fast, material-tinted; see the proc's own comment),
 *   cylinder ->
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
  /** trace_refl_fast — used by dyn_draw_sphere's environment-reflection strips. */
  traceRefl: ProcHandle;
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

export interface DynProcs { sphere: ProcHandle; box: ProcHandle; collide: ProcHandle }

/** Define dyn_draw_sphere / dyn_draw_box / dyn_collide. Call after draw_quad_3d exists. */
export function defineDynProcs(ctx: DynCtx): DynProcs {
  const { s, focal, sun } = ctx;
  const v = (n: string) => s.var(n);
  const pack = (r: any, g: any, b: any) => s.add(s.mul(r, 65536), s.add(s.mul(g, 256), b));
  const packA = (a: any, r: any, g: any, b: any) => s.add(s.mul(a, 16777216), pack(r, g, b));

  // --- dyn_draw_sphere: environment-reflection strips.
  // Look pass 2 (2026-11-26, user feedback on the rooms screenshot:
  // the phase-4 specular pass still read as a pasted-on icon next to
  // the RT hero spheres). The hero spheres blend in because they are
  // shaded by ENVIRONMENT REFLECTION — the reflected ray is traced
  // into the scene, so the lower half shows the floor checker, the
  // upper half the sky gradient, and the sun appears as a glint.
  // This proc now uses the same recipe at strip resolution: the disc
  // is drawn as dN horizontal strips; per strip the sphere normal at
  // the strip's center column is reconstructed (n = eta*up - w*fwd
  // with w = sqrt(1-eta^2)), the reflection vector is traced with the
  // kernel's trace_refl_fast (ro = surface point + 0.02n, spMat = 1
  // so the trace tests the gold hero sphere), and the returned HDR
  // environment color is material-tinted: for metal (oMetal = 1) the
  // tinted reflection dominates with a fresnel rim boost; for
  // dielectric (oMetal = 0) a sun-diffuse body color sits under a
  // fresnel-weighted reflection. A Blinn specular from the same
  // normal is added, then ACES + gamma exactly like render_rt_hero.
  // Two small discs (specular core + white pinpoint at the
  // sun-projected position, as in the previous pass) sharpen the
  // glint, and a translucent rim shell softens the silhouette.
  // Mirror pass: strips are placed at the mirrored screen offset but
  // shaded from the same normal-space sample, so the floor reflection
  // shows the same environment, flipped — the same approximation the
  // hero spheres' mirror impostor makes.
  // Documented approximations: the trace scene is the temple kernel's
  // (planes, columns, crystal, hero spheres) — dynamic objects and
  // room walls do not appear in dyn-sphere reflections, and each
  // strip samples the center column only (the glint streaks
  // vertically). Scratch registers: dT1 eta, dT2 w, dT3..dT5 normal,
  // dT6..dT8 surface point, dT9..dT11 unit view, dT12 ndotv,
  // dT13 ndotl, dT14 strip screen-y; dN strip count, dStep eta step,
  // dI counter, dChord strip half-width px, dShade reflection weight.
  // trace_refl_fast clobbers tmp*/ox*/hx*/ref*/tile* — none live here.
  const mixTo = (tr: number, tg: number, tb: number, f: number): any[] => [
    s.setVar('dT1', s.floor(s.add(v('oColR'), s.mul(s.sub(tr, v('oColR')), f)))),
    s.setVar('dT2', s.floor(s.add(v('oColG'), s.mul(s.sub(tg, v('oColG')), f)))),
    s.setVar('dT3', s.floor(s.add(v('oColB'), s.mul(s.sub(tb, v('oColB')), f)))),
  ];
  const disc = (ox: any, oy: any, size: any, color: any): any[] => [
    s.gotoXy(ox, oy), s.penSetSize(size), s.penSetColor(color), s.penDown(), s.penUp(),
  ];
  const off = (k: number) => s.add(v('sx0'), s.mul(s.mul(v('sr'), k), v('dT5')));
  const offY = (k: number) => s.add(v('sy0'), s.mul(s.mul(v('sr'), k), v('dT6')));
  // One channel of the strip color: HDR env * albedo tint * reflection
  // weight (dShade, includes metalness and the fresnel boost), plus
  // diffuse body color scaled by (1 - metal), plus the Blinn specular
  // tinted toward the albedo. Constants are working values.
  const stripChan = (ref: string, col: string): any => {
    const tint = s.mul(v(col), 1 / 255);
    return s.add(
      s.mul(s.mul(v(ref), tint), s.mul(v('dShade'), 1.25)),
      s.add(
        s.mul(s.mul(tint, s.add(0.22, s.mul(0.78, v('dT13')))), s.mul(0.85, s.sub(1, v('oMetal')))),
        s.mul(s.mul(v('spec'), 4.5), s.mul(s.add(0.35, s.mul(0.65, tint)), s.add(0.35, s.mul(0.65, v('oMetal'))))),
      ),
    );
  };
  // ACES filmic + gamma, same chain as render_floor / render_rt_hero:
  // pX = colX * 0.88, rational ACES, clamp to [0,1], sqrt gamma.
  const tonemap = (col: string, p: string): any[] => [
    s.setVar(p, s.mul(v(col), 0.88)),
    s.setVar(p, s.div(s.mul(v(p), s.add(s.mul(2.51, v(p)), 0.03)), s.add(s.mul(v(p), s.add(s.mul(2.43, v(p)), 0.59)), 0.14))),
    s.if(s.lt(v(p), 0), [s.setVar(p, 0)]),
    s.if(s.gt(v(p), 1), [s.setVar(p, 1)]),
  ];
  const strip: any[] = [
    // eta (band center, -1..1) and w = sqrt(1 - eta^2)
    s.setVar('dT1', s.add(-1, s.mul(s.add(v('dI'), 0.5), v('dStep')))),
    s.setVar('dT2', s.sqrt(s.sub(1, s.mul(v('dT1'), v('dT1'))))),
    // normal at the strip's center column: n = eta*up - w*fwd
    s.setVar('dT3', s.sub(s.mul(v('dT1'), v('upX')), s.mul(v('dT2'), v('fwdX')))),
    s.setVar('dT4', s.sub(s.mul(v('dT1'), v('upY')), s.mul(v('dT2'), v('fwdY')))),
    s.setVar('dT5', s.sub(s.mul(v('dT1'), v('upZ')), s.mul(v('dT2'), v('fwdZ')))),
    // surface point P = O + R n
    s.setVar('dT6', s.add(v('oX'), s.mul(v('oR'), v('dT3')))),
    s.setVar('dT7', s.add(v('oY'), s.mul(v('oR'), v('dT4')))),
    s.setVar('dT8', s.add(v('oZ'), s.mul(v('oR'), v('dT5')))),
    // unit view V = normalize(cam - P)
    s.setVar('dT9', s.sub(v('camX'), v('dT6'))),
    s.setVar('dT10', s.sub(v('camY'), v('dT7'))),
    s.setVar('dT11', s.sub(v('camZ'), v('dT8'))),
    s.setVar('invL', s.div(1.0, s.sqrt(s.add(s.mul(v('dT9'), v('dT9')), s.add(s.mul(v('dT10'), v('dT10')), s.mul(v('dT11'), v('dT11'))))))),
    s.setVar('dT9', s.mul(v('dT9'), v('invL'))),
    s.setVar('dT10', s.mul(v('dT10'), v('invL'))),
    s.setVar('dT11', s.mul(v('dT11'), v('invL'))),
    // ndotv (guarded; the center column of the visible hemisphere is > 0)
    s.setVar('dT12', s.add(s.mul(v('dT3'), v('dT9')), s.add(s.mul(v('dT4'), v('dT10')), s.mul(v('dT5'), v('dT11'))))),
    s.if(s.lt(v('dT12'), 0.001), [s.setVar('dT12', 0.001)]),
    // reflection ray: rd = 2 (n.V) n - V, ro = P + 0.02 n
    s.setVar('rdX', s.sub(s.mul(s.mul(2, v('dT12')), v('dT3')), v('dT9'))),
    s.setVar('rdY', s.sub(s.mul(s.mul(2, v('dT12')), v('dT4')), v('dT10'))),
    s.setVar('rdZ', s.sub(s.mul(s.mul(2, v('dT12')), v('dT5')), v('dT11'))),
    s.setVar('roX', s.add(v('dT6'), s.mul(v('dT3'), 0.02))),
    s.setVar('roY', s.add(v('dT7'), s.mul(v('dT4'), 0.02))),
    s.setVar('roZ', s.add(v('dT8'), s.mul(v('dT5'), 0.02))),
    s.setVar('spMat', 1), s.setVar('hitKind', 0),
    s.callProc(ctx.traceRefl),
    // fresnel (1 - ndotv)^5 in the kernel's registers (free post-trace)
    s.setVar('tmp', s.sub(1, v('dT12'))),
    s.setVar('tmp2', s.mul(v('tmp'), v('tmp'))),
    s.setVar('fres', s.mul(s.mul(v('tmp2'), v('tmp2')), v('tmp'))),
    // Blinn specular: h = sun + V, spec = clamp(h.n / |h|)^8
    s.setVar('hX', s.add(sun[0], v('dT9'))),
    s.setVar('hY', s.add(sun[1], v('dT10'))),
    s.setVar('hZ', s.add(sun[2], v('dT11'))),
    s.setVar('ndoth', s.div(s.add(s.mul(v('hX'), v('dT3')), s.add(s.mul(v('hY'), v('dT4')), s.mul(v('hZ'), v('dT5')))), s.sqrt(s.add(s.mul(v('hX'), v('hX')), s.add(s.mul(v('hY'), v('hY')), s.mul(v('hZ'), v('hZ'))))))),
    s.if(s.lt(v('ndoth'), 0), [s.setVar('ndoth', 0)]),
    s.setVar('spec', s.mul(v('ndoth'), v('ndoth'))),
    s.setVar('spec', s.mul(v('spec'), v('spec'))),
    s.setVar('spec', s.mul(v('spec'), v('spec'))),
    // ndotl for the diffuse body term
    s.setVar('dT13', s.add(s.mul(v('dT3'), sun[0]), s.add(s.mul(v('dT4'), sun[1]), s.mul(v('dT5'), sun[2])))),
    s.if(s.lt(v('dT13'), 0), [s.setVar('dT13', 0)]),
    // reflection weight: metal * (0.8 + 0.45 fresnel)
    s.setVar('dShade', s.mul(v('oMetal'), s.add(0.8, s.mul(0.45, v('fres'))))),
    s.setVar('colR', stripChan('refR', 'oColR')),
    s.setVar('colG', stripChan('refG', 'oColG')),
    s.setVar('colB', stripChan('refB', 'oColB')),
    ...tonemap('colR', 'pR'),
    ...tonemap('colG', 'pG'),
    ...tonemap('colB', 'pB'),
    s.penSetColor(pack(
      s.floor(s.mul(s.sqrt(v('pR')), 255)),
      s.floor(s.mul(s.sqrt(v('pG')), 255)),
      s.floor(s.mul(s.sqrt(v('pB')), 255)),
    )),
    // chord half-width at the band's outer edge (no corner spill)
    s.setVar('tmp', s.add(v('dT1'), s.mul(v('dStep'), 0.5))),
    s.if(s.lt(v('dT1'), 0), [s.setVar('tmp', s.sub(v('dT1'), s.mul(v('dStep'), 0.5)))]),
    s.setVar('dChord', s.mul(v('sr'), s.sqrt(s.sub(1, s.mul(v('tmp'), v('tmp')))))),
    // strip screen-y (mirrored in the floor-reflection pass)
    s.ifElse(s.eq(v('mirrorFlag'), 1),
      [s.setVar('dT14', s.sub(v('sy0'), s.mul(v('dT1'), v('sr'))))],
      [s.setVar('dT14', s.add(v('sy0'), s.mul(v('dT1'), v('sr'))))]),
    s.gotoXy(s.sub(v('sx0'), v('dChord')), v('dT14')),
    s.penDown(),
    s.gotoXy(s.add(v('sx0'), v('dChord')), v('dT14')),
    s.penUp(),
    s.changeVar('dI', 1),
  ];
  const sphere = s.defineProc('dyn_draw_sphere', undefined, true, [
    ...camXform(s, v('oX'), v('oY'), v('oZ'), 'cx0', 'cy0', 'cz0'),
    s.if(s.gt(v('cz0'), s.add(v('oR'), 0.2)), [
      s.setVar('sx0', s.mul(s.div(v('cx0'), v('cz0')), focal)),
      s.setVar('sy0', s.mul(s.div(v('cy0'), v('cz0')), focal)),
      s.setVar('sr', s.mul(s.div(v('oR'), v('cz0')), focal)),
      // strip count from screen size: ~2.5 strips per 10px of radius,
      // clamped 5..15 (bounds the per-sphere trace count)
      s.setVar('dN', s.floor(s.mul(v('sr'), 0.4))),
      s.if(s.lt(v('dN'), 5), [s.setVar('dN', 5)]),
      s.if(s.gt(v('dN'), 15), [s.setVar('dN', 15)]),
      s.setVar('dStep', s.div(2, v('dN'))),
      // rim shell: translucent sky tint, slightly oversized (softens
      // the silhouette against the scene, as in the previous pass)
      ...mixTo(168, 199, 235, 0.5),
      ...disc(v('sx0'), v('sy0'), s.mul(v('sr'), 2.05), packA(46, v('dT1'), v('dT2'), v('dT3'))),
      // environment-reflection strips (pen size = strip height * 1.3)
      s.penSetSize(s.mul(s.div(s.mul(2, v('sr')), v('dN')), 1.3)),
      s.setVar('dI', 0),
      s.repeat(v('dN'), strip),
      // Sun screen direction for the glint discs (render_sky
      // convention; mirror pass negates SUN_Y).
      s.ifElse(s.eq(v('mirrorFlag'), 1), [s.setVar('dT1', -sun[1])], [s.setVar('dT1', sun[1])]),
      s.setVar('dT2', s.add(s.mul(sun[0], v('rgtX')), s.mul(sun[2], v('rgtZ')))),
      s.setVar('dT3', s.add(s.mul(sun[0], v('upX')), s.add(s.mul(v('dT1'), v('upY')), s.mul(sun[2], v('upZ'))))),
      s.setVar('dT4', s.sqrt(s.add(s.mul(v('dT2'), v('dT2')), s.mul(v('dT3'), v('dT3'))))),
      s.ifElse(s.lt(v('dT4'), 0.08),
        [s.setVar('dT5', 0.85), s.setVar('dT6', 0.52)],
        [s.setVar('dT5', s.div(v('dT2'), v('dT4'))), s.setVar('dT6', s.div(v('dT3'), v('dT4')))]),
      // specular core + pure-white pinpoint (crisp sun glint)
      ...mixTo(255, 255, 255, 0.85),
      ...disc(off(0.55), offY(0.55), s.mul(v('sr'), 0.42), packA(190, v('dT1'), v('dT2'), v('dT3'))),
      ...disc(off(0.62), offY(0.62), s.mul(v('sr'), 0.16), pack(255, 255, 255)),
    ]),
  ]);

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
    s.penSetSize(2.4), s.setVar('quadMode', 2), s.setVar('cullFlag', 1), s.setVar('fillLOD', 0),
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
  const body: any[] = [
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
  // Phase 5: skip rendering objects in inactive rooms entirely.
  if (ctx.rooms) {
    return [body[0], s.if(dynRoomActiveExpr(s, v('dynIdx')), body.slice(1))];
  }
  return body;
}

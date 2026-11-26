/**
 * physics.ts — L1 device code for phase 3: input intent + PlayerState,
 * raycast query, grab/carry, simple physics, impact events.
 *
 * Emitted only when buildTempleProject receives a DynSceneSpec (same
 * rule as engine/dynamic.ts); the phase-1 temple build is untouched.
 *
 * Contents (design-repo-core.md sections 2.3, 3.2, 3.4, 3.5):
 * - PlayerState: the player's position/pose/held-object state is kept
 *   in one dedicated register group (psX/psY/psZ/psYaw/psPitch/psHeld)
 *   instead of being scattered across the kernel registers. The main
 *   loop syncs ps* -> cam* once per frame for the existing kernel.
 * - Intent: the input layer writes an intent record per frame
 *   (inMF/inMS/inMU = move axes, inLookYaw/inLookPitch = look deltas,
 *   inGrab/inThrow = action levels). Simulation code reads only the
 *   intent, never keys directly, so the intent source can later be
 *   replaced (design section 2.3, multiplayer headroom — not built).
 * - dyn_raycast: generic view-ray query. Dynamic objects (sphere exact,
 *   cylinder by bounding sphere, box by slab AABB) plus the static
 *   shapes available as data: the floor plane and the scene-bounds
 *   walls. Returns rcKind (0 none / 1 dynamic / 2 floor / 3 wall),
 *   rcId (dyn slot when kind 1), rcT, hit point and normal.
 * - dyn_grab: grab/carry on top of the raycast. Hold mode is
 *   KINEMATIC follow (position lerp toward the hold point) — the
 *   provisional default for design open item E1. The spring mode is
 *   NOT implemented (remaining item, see phase3-report.md). Release
 *   drops the object (physics resumes); throw gives it an initial
 *   velocity along the view direction.
 * - dyn_physics: per-frame step for objects flagged dynPhys: gravity,
 *   velocity integration (semi-implicit Euler, 1 frame = 1 step),
 *   scene-bounds collision, floor grounding with friction, sleep, and
 *   object-vs-object response (XZ-circle broad phase + inelastic
 *   normal-velocity merge; design section 3.3's simple form).
 * - Impact events: collisions and landings append to the event lists
 *   evType/evObj/evOther/evVal/evFrame and mirror the latest into
 *   evLastObj/evLastOther/evLastImpact (+evCount). Event types:
 *   1 = object vs static (bounds wall), 2 = landing on the floor,
 *   3 = object vs object. evVal is the impact magnitude |delta-v|
 *   (normal-direction relative speed destroyed by the contact). The
 *   engine only detects and quantifies; what an impact *means*
 *   (damage, breakage) is game-side and not computed here.
 *
 * All numeric parameters come from DynSceneSpec.physics with the
 * PROVISIONAL defaults in scene/dynamic.ts (DYN_PHYSICS_DEFAULTS);
 * they are engine working values, not decided game specifications.
 */
import type { ProcHandle } from '../builder/index';
import { loadRow, type DynCtx } from './dynamic';
import { dynHalfHeight, resolveDynObject, resolvePhysics, type DynSceneSpec } from '../scene/dynamic';

export interface PhysProcs { raycast: ProcHandle; physics: ProcHandle; grab: ProcHandle }

/** Declare the phase-3 SoA columns, parameters, PlayerState, intent and event store. */
export function declarePhysData(s: any, dyn: DynSceneSpec): void {
  const objs = dyn.objects.map(resolveDynObject);
  const p = resolvePhysics(dyn.physics);
  s.lst('dynVX', objs.map(() => 0));
  s.lst('dynVY', objs.map(() => 0));
  s.lst('dynVZ', objs.map(() => 0));
  s.lst('dynPhys', objs.map((o) => o.physical));
  // Objects that start resting on the floor start asleep; anything
  // starting above its rest height starts awake so it falls.
  s.lst('dynSleep', objs.map((o) => (o.physical === 1 && o.pos[1] <= dyn.floorY + dynHalfHeight(o) + 0.001 ? 1 : 0)));
  s.lst('dynHeld', objs.map(() => 0));
  // Impact event queue (append-only; game side reads/clears).
  s.lst('evType', []);
  s.lst('evObj', []);
  s.lst('evOther', []);
  s.lst('evVal', []);
  s.lst('evFrame', []);
  // Parameters (provisional defaults, overridable per scene / at runtime).
  s.var('physGrav', p.gravity);
  s.var('physMaxFall', p.maxFallSpeed);
  s.var('physImpactMin', p.impactMin);
  s.var('physSleepEps', p.sleepSpeed);
  s.var('physFriction', p.groundFriction);
  s.var('grabReach', p.grabReach);
  s.var('holdDist', p.holdDistance);
  s.var('holdLerp', p.holdLerp);
  s.var('throwSpd', p.throwSpeed);
  s.var('physPushSpd', p.pushSpeed);
  // PlayerState (design section 2.3). Initial pose = the phase-1 camera
  // initial pose (camX/camY/camZ/camYaw/camPitch in hybrid-engine.ts).
  s.var('psX', -0.32);
  s.var('psY', 0.52);
  s.var('psZ', -5.25);
  s.var('psYaw', 4.5);
  s.var('psPitch', -5.5);
  s.var('psHeld', 0);
  // Intent record (rewritten every frame by the input layer).
  for (const n of ['inMF', 'inMS', 'inMU', 'inLookYaw', 'inLookPitch', 'inGrab', 'inThrow']) s.var(n, 0);
  s.var('gPrevGrab', 0);
  s.var('gPrevThrow', 0);
  // Raycast registers.
  for (const n of ['rayOX', 'rayOY', 'rayOZ', 'rayDX', 'rayDY', 'rayDZ', 'rcT', 'rcId', 'rcKind', 'rcNx', 'rcNy', 'rcNz', 'rcHx', 'rcHy', 'rcHz']) s.var(n, 0);
  // Physics state / scratch.
  for (const n of ['physFrame', 'physActive', 'physDirty', 'evLastObj', 'evLastOther', 'evLastImpact', 'evCount', 'pI', 'pJ', 'pGround', 'pNX', 'pNY', 'pNZ', 'eKind', 'eX', 'eY', 'eZ', 'eR', 'eHx', 'eHy', 'eHz', 'ePhys', 'eHeld', 'eSleep', 'eVX', 'eVY', 'eVZ']) s.var(n, 0);
}

/** Append an impact event (type/obj/other/|delta-v|) to the event queue. */
function emitImpact(s: any, type: number, obj: any, other: any, val: any): any[] {
  const v = (n: string) => s.var(n);
  return [
    s.addToList('evType', type),
    s.addToList('evObj', obj),
    s.addToList('evOther', other),
    s.addToList('evVal', val),
    s.addToList('evFrame', v('physFrame')),
    s.setVar('evLastObj', obj),
    s.setVar('evLastOther', other),
    s.setVar('evLastImpact', val),
    s.changeVar('evCount', 1),
    s.setVar('physDirty', 1),
  ];
}

/** Load dyn row idx into the e* registers (second object, obj-vs-obj pass). */
function loadRowE(s: any, idx: any): any[] {
  const pairs: Array<[string, string]> = [
    ['eKind', 'dynKind'], ['eX', 'dynX'], ['eY', 'dynY'], ['eZ', 'dynZ'],
    ['eR', 'dynR'], ['eHx', 'dynHx'], ['eHy', 'dynHy'], ['eHz', 'dynHz'],
    ['ePhys', 'dynPhys'], ['eHeld', 'dynHeld'],
    ['eSleep', 'dynSleep'], ['eVX', 'dynVX'], ['eVY', 'dynVY'], ['eVZ', 'dynVZ'],
  ];
  return pairs.map(([v, l]) => s.setVar(v, s.itemOf(l, idx)));
}

export function definePhysProcs(ctx: DynCtx): PhysProcs {
  const { s } = ctx;
  const v = (n: string) => s.var(n);

  // ---------- dyn_raycast ----------
  // One wall plane test: axis dir/org registers, plane value, normal.
  const wallTest = (
    dir: string, org: string, plane: any, n: [number, number, number],
    rangeChecks: any[],
  ): any[] => [
    s.if(s.gt(s.abs(v(dir)), 0.0001), [
      s.setVar('dT1', s.div(s.sub(plane, v(org)), v(dir))),
      s.if(s.land(s.gt(v('dT1'), 0.01), s.lt(v('dT1'), v('rcT'))), [
        s.setVar('dT2', s.add(v('rayOY'), s.mul(v('rayDY'), v('dT1')))),
        s.setVar('dT3', s.add(v('rayOX'), s.mul(v('rayDX'), v('dT1')))),
        s.setVar('dT4', s.add(v('rayOZ'), s.mul(v('rayDZ'), v('dT1')))),
        s.if(s.land(rangeChecks[0], rangeChecks[1]), [
          s.setVar('rcT', v('dT1')), s.setVar('rcId', 0), s.setVar('rcKind', 3),
          s.setVar('rcNx', n[0]), s.setVar('rcNy', n[1]), s.setVar('rcNz', n[2]),
        ]),
      ]),
    ]),
  ];
  const yInRange = s.land(s.gt(v('dT2'), v('dynFloorY')), s.lt(v('dT2'), s.add(v('dynFloorY'), 4.2)));
  const raycast = s.defineProc('dyn_raycast', undefined, true, [
    s.setVar('rcT', 9999), s.setVar('rcId', 0), s.setVar('rcKind', 0),
    s.setVar('rcNx', 0), s.setVar('rcNy', 1), s.setVar('rcNz', 0),
    // Floor plane.
    s.if(s.lt(v('rayDY'), -0.0001), [
      s.setVar('dT1', s.div(s.sub(v('dynFloorY'), v('rayOY')), v('rayDY'))),
      s.if(s.land(s.gt(v('dT1'), 0.01), s.lt(v('dT1'), v('rcT'))), [
        s.setVar('rcT', v('dT1')), s.setVar('rcKind', 2),
        s.setVar('rcNx', 0), s.setVar('rcNy', 1), s.setVar('rcNz', 0),
      ]),
    ]),
    // Scene-bounds walls (x min/max, z min/max), height range floor..floor+4.2.
    ...wallTest('rayDX', 'rayOX', v('dynBdX0'), [1, 0, 0], [yInRange, s.land(s.gt(v('dT4'), v('dynBdZ0')), s.lt(v('dT4'), v('dynBdZ1')))]),
    ...wallTest('rayDX', 'rayOX', v('dynBdX1'), [-1, 0, 0], [yInRange, s.land(s.gt(v('dT4'), v('dynBdZ0')), s.lt(v('dT4'), v('dynBdZ1')))]),
    ...wallTest('rayDZ', 'rayOZ', v('dynBdZ0'), [0, 0, 1], [yInRange, s.land(s.gt(v('dT3'), v('dynBdX0')), s.lt(v('dT3'), v('dynBdX1')))]),
    ...wallTest('rayDZ', 'rayOZ', v('dynBdZ1'), [0, 0, -1], [yInRange, s.land(s.gt(v('dT3'), v('dynBdX0')), s.lt(v('dT3'), v('dynBdX1')))]),
    // Dynamic objects.
    s.setVar('pI', 1),
    s.repeat(v('dynN'), [
      ...loadRow(s, v('pI')),
      s.ifElse(s.eq(v('oKind'), 3), [
        // Box: slab test. dT1=tmin, dT2=tmax, dT5=miss, pN*=entry normal.
        s.setVar('dT1', -9999), s.setVar('dT2', 9999), s.setVar('dT5', 0),
        s.setVar('pNX', 0), s.setVar('pNY', 0), s.setVar('pNZ', 0),
        ...(['X', 'Y', 'Z'] as const).flatMap((ax) => {
          const dir = `rayD${ax}`, org = `rayO${ax}`, c = `o${ax}`, h = ax === 'Y' ? 'oHy' : `oH${ax.toLowerCase()}`;
          const nReg = `pN${ax}`;
          return [
            s.ifElse(s.lt(s.abs(v(dir)), 0.0001), [
              s.if(s.lor(s.lt(v(org), s.sub(v(c), v(h))), s.gt(v(org), s.add(v(c), v(h)))), [s.setVar('dT5', 1)]),
            ], [
              s.setVar('dT6', s.div(s.sub(s.sub(v(c), v(h)), v(org)), v(dir))),
              s.setVar('dT7', s.div(s.sub(s.add(v(c), v(h)), v(org)), v(dir))),
              s.setVar('dT8', -1),
              s.if(s.lt(v(dir), 0), [s.setVar('dT8', 1)]),
              s.if(s.gt(v('dT6'), v('dT7')), [
                s.setVar('dT3', v('dT6')), s.setVar('dT6', v('dT7')), s.setVar('dT7', v('dT3')),
              ]),
              s.if(s.gt(v('dT6'), v('dT1')), [
                s.setVar('dT1', v('dT6')),
                s.setVar('pNX', 0), s.setVar('pNY', 0), s.setVar('pNZ', 0),
                s.setVar(nReg, v('dT8')),
              ]),
              s.if(s.lt(v('dT7'), v('dT2')), [s.setVar('dT2', v('dT7'))]),
            ]),
          ];
        }),
        s.if(s.land(s.eq(v('dT5'), 0), s.land(s.lnot(s.gt(v('dT1'), v('dT2'))), s.land(s.gt(v('dT1'), 0.01), s.lt(v('dT1'), v('rcT'))))), [
          s.setVar('rcT', v('dT1')), s.setVar('rcId', v('pI')), s.setVar('rcKind', 1),
          s.setVar('rcNx', v('pNX')), s.setVar('rcNy', v('pNY')), s.setVar('rcNz', v('pNZ')),
        ]),
      ], [
        // Sphere (kind 1) exact; cylinder (kind 2) by bounding sphere.
        s.setVar('dT8', v('oR')),
        s.if(s.eq(v('oKind'), 2), [s.setVar('dT8', s.sqrt(s.add(s.mul(v('oR'), v('oR')), s.mul(v('oHy'), v('oHy')))))]),
        s.setVar('dT1', s.sub(v('rayOX'), v('oX'))),
        s.setVar('dT2', s.sub(v('rayOY'), v('oY'))),
        s.setVar('dT3', s.sub(v('rayOZ'), v('oZ'))),
        s.setVar('dT4', s.add(s.mul(v('dT1'), v('rayDX')), s.add(s.mul(v('dT2'), v('rayDY')), s.mul(v('dT3'), v('rayDZ'))))),
        s.setVar('dT5', s.sub(s.add(s.mul(v('dT1'), v('dT1')), s.add(s.mul(v('dT2'), v('dT2')), s.mul(v('dT3'), v('dT3')))), s.mul(v('dT8'), v('dT8')))),
        s.setVar('dT6', s.sub(s.mul(v('dT4'), v('dT4')), v('dT5'))),
        s.if(s.gt(v('dT6'), 0), [
          s.setVar('dT7', s.sub(s.mul(v('dT4'), -1), s.sqrt(v('dT6')))),
          s.if(s.land(s.gt(v('dT7'), 0.01), s.lt(v('dT7'), v('rcT'))), [
            s.setVar('rcT', v('dT7')), s.setVar('rcId', v('pI')), s.setVar('rcKind', 1),
            s.setVar('eX', s.add(v('rayOX'), s.mul(v('rayDX'), v('dT7')))),
            s.setVar('eY', s.add(v('rayOY'), s.mul(v('rayDY'), v('dT7')))),
            s.setVar('eZ', s.add(v('rayOZ'), s.mul(v('rayDZ'), v('dT7')))),
            s.setVar('rcNx', s.div(s.sub(v('eX'), v('oX')), v('dT8'))),
            s.setVar('rcNy', s.div(s.sub(v('eY'), v('oY')), v('dT8'))),
            s.setVar('rcNz', s.div(s.sub(v('eZ'), v('oZ')), v('dT8'))),
          ]),
        ]),
      ]),
      s.changeVar('pI', 1),
    ]),
    // Hit point (uniform, from the winning t).
    s.if(s.gt(v('rcKind'), 0), [
      s.setVar('rcHx', s.add(v('rayOX'), s.mul(v('rayDX'), v('rcT')))),
      s.setVar('rcHy', s.add(v('rayOY'), s.mul(v('rayDY'), v('rcT')))),
      s.setVar('rcHz', s.add(v('rayOZ'), s.mul(v('rayDZ'), v('rcT')))),
    ]),
  ]);

  // ---------- dyn_physics ----------
  const wallClamp = (
    pos: string, vel: string, bound: any, margin: any, sign: 1 | -1,
  ): any[] => {
    const cond = sign === 1 ? s.lt(v(pos), s.add(bound, margin)) : s.gt(v(pos), s.sub(bound, margin));
    const target = sign === 1 ? s.add(bound, margin) : s.sub(bound, margin);
    return [
      s.if(cond, [
        s.if(s.gt(s.abs(v(vel)), v('physImpactMin')), emitImpact(s, 1, v('pI'), 0, s.abs(v(vel)))),
        s.setVar(pos, target),
        s.setVar(vel, 0),
      ]),
    ];
  };
  const physics = s.defineProc('dyn_physics', undefined, true, [
    s.changeVar('physFrame', 1),
    s.setVar('physActive', 0),
    s.setVar('pI', 1),
    s.repeat(v('dynN'), [
      ...loadRow(s, v('pI')),
      s.if(s.land(s.eq(v('oPhys'), 1), s.land(s.eq(v('oHeld'), 0), s.eq(v('oSleep'), 0))), [
        s.changeVar('physActive', 1),
        // Semi-implicit Euler: gravity, terminal velocity, integrate.
        s.changeVar('oVY', s.mul(v('physGrav'), -1)),
        s.if(s.lt(v('oVY'), s.mul(v('physMaxFall'), -1)), [s.setVar('oVY', s.mul(v('physMaxFall'), -1))]),
        s.setVar('pNX', s.add(v('oX'), v('oVX'))),
        s.setVar('pNY', s.add(v('oY'), v('oVY'))),
        s.setVar('pNZ', s.add(v('oZ'), v('oVZ'))),
        // Bounds walls (margins: box half extents, else radius).
        s.setVar('dT7', v('oR')),
        s.setVar('dT8', v('oR')),
        s.if(s.eq(v('oKind'), 3), [s.setVar('dT7', v('oHx')), s.setVar('dT8', v('oHz'))]),
        ...wallClamp('pNX', 'oVX', v('dynBdX0'), v('dT7'), 1),
        ...wallClamp('pNX', 'oVX', v('dynBdX1'), v('dT7'), -1),
        ...wallClamp('pNZ', 'oVZ', v('dynBdZ0'), v('dT8'), 1),
        ...wallClamp('pNZ', 'oVZ', v('dynBdZ1'), v('dT8'), -1),
        // Floor grounding, friction, sleep.
        s.setVar('pGround', 0),
        s.setVar('dT6', s.add(v('dynFloorY'), v('oHy'))),
        s.if(s.lnot(s.gt(v('pNY'), v('dT6'))), [
          s.if(s.lt(v('oVY'), 0), [
            s.if(s.gt(s.mul(v('oVY'), -1), v('physImpactMin')), emitImpact(s, 2, v('pI'), 0, s.mul(v('oVY'), -1))),
          ]),
          s.setVar('pNY', v('dT6')),
          s.setVar('oVY', 0),
          s.setVar('pGround', 1),
          s.setVar('oVX', s.mul(v('oVX'), v('physFriction'))),
          s.setVar('oVZ', s.mul(v('oVZ'), v('physFriction'))),
          s.if(s.land(s.lt(s.abs(v('oVX')), v('physSleepEps')), s.lt(s.abs(v('oVZ')), v('physSleepEps'))), [
            s.setVar('oVX', 0), s.setVar('oVZ', 0),
            s.replaceItem('dynSleep', v('pI'), 1),
          ]),
        ]),
        s.replaceItem('dynX', v('pI'), v('pNX')),
        s.replaceItem('dynY', v('pI'), v('pNY')),
        s.replaceItem('dynZ', v('pI'), v('pNZ')),
        s.replaceItem('dynVX', v('pI'), v('oVX')),
        s.replaceItem('dynVY', v('pI'), v('oVY')),
        s.replaceItem('dynVZ', v('pI'), v('oVZ')),
        s.setVar('physDirty', 1),
      ]),
      s.changeVar('pI', 1),
    ]),
    // Object vs object: XZ-circle broad phase, inelastic normal merge.
    s.setVar('pI', 1),
    s.repeat(v('dynN'), [
      ...loadRow(s, v('pI')),
      s.if(s.land(s.eq(v('oPhys'), 1), s.eq(v('oHeld'), 0)), [
        s.setVar('pJ', s.add(v('pI'), 1)),
        s.repeat(s.sub(v('dynN'), v('pI')), [
          ...loadRowE(s, v('pJ')),
          // Earlier pairs in this pass may have moved object i; refresh
          // its position/velocity registers from the table.
          s.setVar('oX', s.itemOf('dynX', v('pI'))),
          s.setVar('oZ', s.itemOf('dynZ', v('pI'))),
          s.setVar('oVX', s.itemOf('dynVX', v('pI'))),
          s.setVar('oVZ', s.itemOf('dynVZ', v('pI'))),
          s.if(s.land(s.eq(v('ePhys'), 1), s.eq(v('eHeld'), 0)), [
            s.setVar('dT1', v('oR')),
            s.if(s.eq(v('oKind'), 3), [s.setVar('dT1', v('oHx')), s.if(s.gt(v('oHz'), v('dT1')), [s.setVar('dT1', v('oHz'))])]),
            s.setVar('dT2', v('eR')),
            s.if(s.eq(v('eKind'), 3), [s.setVar('dT2', v('eHx')), s.if(s.gt(v('eHz'), v('dT2')), [s.setVar('dT2', v('eHz'))])]),
            s.setVar('dT3', s.add(v('dT1'), v('dT2'))),
            s.setVar('dT4', s.sub(v('oX'), v('eX'))),
            s.setVar('dT5', s.sub(v('oZ'), v('eZ'))),
            s.setVar('dT6', s.add(s.mul(v('dT4'), v('dT4')), s.mul(v('dT5'), v('dT5')))),
            s.if(s.land(s.lt(v('dT6'), s.mul(v('dT3'), v('dT3'))), s.land(s.gt(v('dT6'), 0.000001), s.lt(s.abs(s.sub(v('oY'), v('eY'))), s.add(v('oHy'), v('eHy'))))), [
              s.setVar('dT6', s.sqrt(v('dT6'))),
              s.setVar('dT4', s.div(v('dT4'), v('dT6'))),
              s.setVar('dT5', s.div(v('dT5'), v('dT6'))),
              s.setVar('dT7', s.sub(v('dT3'), v('dT6'))), // overlap
              s.replaceItem('dynSleep', v('pI'), 0),
              s.replaceItem('dynSleep', v('pJ'), 0),
              s.replaceItem('dynX', v('pI'), s.add(v('oX'), s.mul(s.mul(v('dT4'), v('dT7')), 0.5))),
              s.replaceItem('dynZ', v('pI'), s.add(v('oZ'), s.mul(s.mul(v('dT5'), v('dT7')), 0.5))),
              s.replaceItem('dynX', v('pJ'), s.sub(v('eX'), s.mul(s.mul(v('dT4'), v('dT7')), 0.5))),
              s.replaceItem('dynZ', v('pJ'), s.sub(v('eZ'), s.mul(s.mul(v('dT5'), v('dT7')), 0.5))),
              // Relative normal velocity (u points j -> i; <0 = closing).
              s.setVar('dT8', s.add(s.mul(s.sub(v('oVX'), v('eVX')), v('dT4')), s.mul(s.sub(v('oVZ'), v('eVZ')), v('dT5')))),
              s.if(s.lt(v('dT8'), 0), [
                s.if(s.gt(s.mul(v('dT8'), -1), v('physImpactMin')), emitImpact(s, 3, v('pI'), v('pJ'), s.mul(v('dT8'), -1))),
                s.setVar('pNX', s.add(s.mul(v('oVX'), v('dT4')), s.mul(v('oVZ'), v('dT5')))),
                s.setVar('pNY', s.add(s.mul(v('eVX'), v('dT4')), s.mul(v('eVZ'), v('dT5')))),
                s.setVar('pNZ', s.mul(s.add(v('pNX'), v('pNY')), 0.5)),
                s.replaceItem('dynVX', v('pI'), s.add(v('oVX'), s.mul(v('dT4'), s.sub(v('pNZ'), v('pNX'))))),
                s.replaceItem('dynVZ', v('pI'), s.add(v('oVZ'), s.mul(v('dT5'), s.sub(v('pNZ'), v('pNX'))))),
                s.replaceItem('dynVX', v('pJ'), s.add(v('eVX'), s.mul(v('dT4'), s.sub(v('pNZ'), v('pNY'))))),
                s.replaceItem('dynVZ', v('pJ'), s.add(v('eVZ'), s.mul(v('dT5'), s.sub(v('pNZ'), v('pNY'))))),
              ]),
              s.setVar('physDirty', 1),
            ]),
          ]),
          s.changeVar('pJ', 1),
        ]),
      ]),
      s.changeVar('pI', 1),
    ]),
  ]);

  // ---------- dyn_grab ----------
  const viewDir = (): any[] => [
    s.setVar('rayDX', s.mul(s.sin(v('psYaw')), s.cos(v('psPitch')))),
    s.setVar('rayDY', s.sin(v('psPitch'))),
    s.setVar('rayDZ', s.mul(s.cos(v('psYaw')), s.cos(v('psPitch')))),
  ];
  const grab = s.defineProc('dyn_grab', undefined, true, [
    s.ifElse(s.eq(v('psHeld'), 0), [
      // Press edge: raycast from the camera, grab a physical object in reach.
      s.if(s.land(s.eq(v('inGrab'), 1), s.eq(v('gPrevGrab'), 0)), [
        s.setVar('rayOX', v('camX')), s.setVar('rayOY', v('camY')), s.setVar('rayOZ', v('camZ')),
        ...viewDir(),
        s.callProc(raycast),
        s.if(s.land(s.eq(v('rcKind'), 1), s.lnot(s.gt(v('rcT'), v('grabReach')))), [
          s.if(s.eq(s.itemOf('dynPhys', v('rcId')), 1), [
            s.setVar('psHeld', v('rcId')),
            s.replaceItem('dynHeld', v('rcId'), 1),
            s.replaceItem('dynSleep', v('rcId'), 0),
            s.replaceItem('dynVX', v('rcId'), 0),
            s.replaceItem('dynVY', v('rcId'), 0),
            s.replaceItem('dynVZ', v('rcId'), 0),
            s.setVar('physDirty', 1),
          ]),
        ]),
      ]),
    ], [
      ...loadRow(s, v('psHeld')),
      s.ifElse(s.land(s.eq(v('inThrow'), 1), s.eq(v('gPrevThrow'), 0)), [
        // Throw: initial velocity along the view direction (+ slight up).
        ...viewDir(),
        s.replaceItem('dynVX', v('psHeld'), s.mul(v('rayDX'), v('throwSpd'))),
        s.replaceItem('dynVY', v('psHeld'), s.add(s.mul(v('rayDY'), v('throwSpd')), 0.03)),
        s.replaceItem('dynVZ', v('psHeld'), s.mul(v('rayDZ'), v('throwSpd'))),
        s.replaceItem('dynHeld', v('psHeld'), 0),
        s.setVar('psHeld', 0),
        s.setVar('physDirty', 1),
      ], [
        s.ifElse(s.eq(v('inGrab'), 0), [
          // Release: drop in place, physics resumes from rest.
          s.replaceItem('dynVX', v('psHeld'), 0),
          s.replaceItem('dynVY', v('psHeld'), 0),
          s.replaceItem('dynVZ', v('psHeld'), 0),
          s.replaceItem('dynHeld', v('psHeld'), 0),
          s.setVar('psHeld', 0),
          s.setVar('physDirty', 1),
        ], [
          // Kinematic follow toward the hold point (provisional E1 default).
          ...viewDir(),
          s.setVar('dT1', s.add(v('camX'), s.mul(v('rayDX'), v('holdDist')))),
          s.setVar('dT2', s.add(v('camY'), s.mul(v('rayDY'), v('holdDist')))),
          s.setVar('dT3', s.add(v('camZ'), s.mul(v('rayDZ'), v('holdDist')))),
          s.setVar('dT4', s.add(v('oX'), s.mul(s.sub(v('dT1'), v('oX')), v('holdLerp')))),
          s.setVar('dT5', s.add(v('oY'), s.mul(s.sub(v('dT2'), v('oY')), v('holdLerp')))),
          s.setVar('dT6', s.add(v('oZ'), s.mul(s.sub(v('dT3'), v('oZ')), v('holdLerp')))),
          s.setVar('dT7', s.add(v('dynFloorY'), v('oHy'))),
          s.if(s.lt(v('dT5'), v('dT7')), [s.setVar('dT5', v('dT7'))]),
          s.setVar('dT8', v('oR')),
          s.if(s.eq(v('oKind'), 3), [s.setVar('dT8', v('oHx'))]),
          s.if(s.lt(v('dT4'), s.add(v('dynBdX0'), v('dT8'))), [s.setVar('dT4', s.add(v('dynBdX0'), v('dT8')))]),
          s.if(s.gt(v('dT4'), s.sub(v('dynBdX1'), v('dT8'))), [s.setVar('dT4', s.sub(v('dynBdX1'), v('dT8')))]),
          s.setVar('dT8', v('oR')),
          s.if(s.eq(v('oKind'), 3), [s.setVar('dT8', v('oHz'))]),
          s.if(s.lt(v('dT6'), s.add(v('dynBdZ0'), v('dT8'))), [s.setVar('dT6', s.add(v('dynBdZ0'), v('dT8')))]),
          s.if(s.gt(v('dT6'), s.sub(v('dynBdZ1'), v('dT8'))), [s.setVar('dT6', s.sub(v('dynBdZ1'), v('dT8')))]),
          s.if(s.gt(s.add(s.abs(s.sub(v('dT4'), v('oX'))), s.add(s.abs(s.sub(v('dT5'), v('oY'))), s.abs(s.sub(v('dT6'), v('oZ'))))), 0.001), [
            s.replaceItem('dynX', v('psHeld'), v('dT4')),
            s.replaceItem('dynY', v('psHeld'), v('dT5')),
            s.replaceItem('dynZ', v('psHeld'), v('dT6')),
            s.setVar('physDirty', 1),
          ]),
        ]),
      ]),
    ]),
    s.setVar('gPrevGrab', v('inGrab')),
    s.setVar('gPrevThrow', v('inThrow')),
  ]);

  return { raycast, physics, grab };
}

/** Context the DYN main loop needs from hybrid-engine.ts. */
export interface DynLoopCtx {
  s: any;
  fwdX: any; fwdZ: any; rgtX: any; rgtZ: any;
  velYaw: any; velPitch: any;
  nowMs: () => any;
  clampR: (s: any, name: string, lo: any, hi: any) => any[];
  collide: ProcHandle;
  physics: ProcHandle;
  grab: ProcHandle;
  renderFrame: ProcHandle;
}

/**
 * The DYN main-loop body (forever contents): intent collection ->
 * PlayerState update -> ps-to-cam sync -> grab -> physics -> collide ->
 * render decision. Replaces the phase-1 direct-manipulation loop only
 * for DynSceneSpec builds; movement speeds, drag/flick feel and clamps
 * are the phase-1 values, re-expressed through the intent record.
 * Keys (PROVISIONAL demo bindings, game-side G6): WASD/QE + arrows +
 * drag as before; F = grab (hold) / release to drop; G = throw.
 */
export function dynLoopBody(ctx: DynLoopCtx): any[] {
  const { s } = ctx;
  const v = (n: string) => s.var(n);
  const key = (k: string, body: any[]): any => s.if(s.keyPressed(k), body);
  return [
    s.setVar('tmp3', 0),
    // --- intent collection ---
    s.setVar('inMF', 0), s.setVar('inMS', 0), s.setVar('inMU', 0),
    s.setVar('inLookYaw', 0), s.setVar('inLookPitch', 0),
    key('w', [s.changeVar('inMF', 1)]),
    key('s', [s.changeVar('inMF', -1)]),
    key('d', [s.changeVar('inMS', 1)]),
    key('a', [s.changeVar('inMS', -1)]),
    key('e', [s.changeVar('inMU', 1)]),
    key('q', [s.changeVar('inMU', -1)]),
    key('left arrow', [s.changeVar('inLookYaw', -2.8)]),
    key('right arrow', [s.changeVar('inLookYaw', 2.8)]),
    key('up arrow', [s.changeVar('inLookPitch', 2.0)]),
    key('down arrow', [s.changeVar('inLookPitch', -2.0)]),
    s.ifElse(s.keyPressed('f'), [s.setVar('inGrab', 1)], [s.setVar('inGrab', 0)]),
    s.ifElse(s.keyPressed('g'), [s.setVar('inThrow', 1)], [s.setVar('inThrow', 0)]),
    // Drag look + flick inertia, feeding the look intent (phase-1 feel).
    s.ifElse(s.mouseDown(), [
      s.ifElse(s.eq(v('wasDown'), 0), [
        s.setVar('prevMX', s.mouseX()), s.setVar('prevMY', s.mouseY()),
        s.setVar('velYaw', 0), s.setVar('velPitch', 0),
        s.setVar('wasDown', 1), s.setVar('lastFlickMs', ctx.nowMs()),
      ], [
        s.setVar('dmx', s.sub(s.mouseX(), v('prevMX'))),
        s.setVar('dmy', s.sub(s.mouseY(), v('prevMY'))),
        s.setVar('prevMX', s.mouseX()), s.setVar('prevMY', s.mouseY()),
        s.if(s.lor(s.gt(s.abs(v('dmx')), 0.2), s.gt(s.abs(v('dmy')), 0.2)), [
          s.changeVar('inLookYaw', s.mul(v('dmx'), 0.3)),
          s.changeVar('inLookPitch', s.mul(v('dmy'), 0.24)),
          s.setVar('velYaw', s.add(s.mul(ctx.velYaw, 0.35), s.mul(v('dmx'), 0.22))),
          s.setVar('velPitch', s.add(s.mul(ctx.velPitch, 0.35), s.mul(v('dmy'), 0.16))),
          ...ctx.clampR(s, 'velYaw', -12.0, 12.0),
          ...ctx.clampR(s, 'velPitch', -9.0, 9.0),
          s.setVar('lastFlickMs', ctx.nowMs()),
        ]),
      ]),
    ], [
      s.setVar('wasDown', 0),
      s.ifElse(s.lor(s.gt(s.abs(ctx.velYaw), 0.12), s.gt(s.abs(ctx.velPitch), 0.12)), [
        s.if(s.gt(s.sub(ctx.nowMs(), v('lastFlickMs')), 15.0), [
          s.setVar('lastFlickMs', ctx.nowMs()),
          s.changeVar('inLookYaw', ctx.velYaw),
          s.changeVar('inLookPitch', ctx.velPitch),
          s.setVar('velYaw', s.mul(ctx.velYaw, 0.85)),
          s.setVar('velPitch', s.mul(ctx.velPitch, 0.85)),
        ]),
      ], [s.setVar('velYaw', 0), s.setVar('velPitch', 0)]),
    ]),
    // Engine quality toggles (not player intent; unchanged from phase 1).
    key('0', [s.setVar('AUTO_STEP', 1), s.setVar('needsRender', 1)]),
    key('1', [s.setVar('AUTO_STEP', 0), s.setVar('SPHERE_STEP', 2), s.setVar('needsRender', 1)]),
    key('2', [s.setVar('AUTO_STEP', 0), s.setVar('SPHERE_STEP', 1), s.setVar('needsRender', 1)]),
    key('3', [s.setVar('FLOOR_REFL', 1), s.setVar('needsRender', 1)]),
    key('4', [s.setVar('FLOOR_REFL', 0), s.setVar('needsRender', 1)]),
    // --- apply intent to PlayerState ---
    s.changeVar('psYaw', v('inLookYaw')),
    s.changeVar('psPitch', v('inLookPitch')),
    ...ctx.clampR(s, 'psPitch', -48, 42),
    s.changeVar('psX', s.mul(ctx.fwdX, s.mul(0.12, v('inMF')))),
    s.changeVar('psX', s.mul(ctx.rgtX, s.mul(0.12, v('inMS')))),
    s.changeVar('psZ', s.mul(ctx.fwdZ, s.mul(0.12, v('inMF')))),
    s.changeVar('psZ', s.mul(ctx.rgtZ, s.mul(0.12, v('inMS')))),
    s.changeVar('psY', s.mul(0.08, v('inMU'))),
    ...ctx.clampR(s, 'psX', -3.15, 4.5),
    ...ctx.clampR(s, 'psY', -0.85, 2.55),
    ...ctx.clampR(s, 'psZ', -6.5, 3.85),
    s.if(s.lor(s.lor(v('inMF'), v('inMS')), s.lor(v('inMU'), s.lor(v('inLookYaw'), v('inLookPitch')))), [s.setVar('tmp3', 1)]),
    // --- sync PlayerState -> kernel camera registers ---
    s.setVar('camX', v('psX')), s.setVar('camY', v('psY')), s.setVar('camZ', v('psZ')),
    s.setVar('camYaw', v('psYaw')), s.setVar('camPitch', v('psPitch')),
    // --- simulation: grab, physics, player collision ---
    s.setVar('physDirty', 0),
    s.callProc(ctx.grab),
    s.callProc(ctx.physics),
    s.callProc(ctx.collide),
    s.if(s.eq(v('dynMoved'), 1), [s.setVar('tmp3', 1)]),
    s.if(s.eq(v('physDirty'), 1), [s.setVar('tmp3', 1)]),
    s.if(s.gt(v('physActive'), 0), [s.setVar('tmp3', 1)]),
    // Collision may have pushed the player out; fold back into PlayerState.
    s.setVar('psX', v('camX')),
    s.setVar('psZ', v('camZ')),
    // --- render decision (same policy as phase 1) ---
    s.ifElse(s.eq(v('tmp3'), 1), [
      s.if(s.eq(v('AUTO_STEP'), 1), [s.setVar('SPHERE_STEP', 2)]),
      s.callProc(ctx.renderFrame),
      s.setVar('needsRender', 1),
    ], [
      s.if(s.eq(v('needsRender'), 1), [
        s.if(s.eq(v('AUTO_STEP'), 1), [s.setVar('SPHERE_STEP', 1)]),
        s.callProc(ctx.renderFrame),
        s.setVar('needsRender', 0),
      ]),
    ]),
  ];
}

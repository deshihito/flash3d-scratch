/**
 * ai.ts — L1 device code for the generic AI state-machine base (phase 5).
 *
 * Emitted only when buildTempleProject receives an AgentSpec list.
 * Design: design-repo-core.md section 3.6 — the engine provides the
 * frame (FSM + perception + steering), never the enemy.
 *
 * Public interface (all readable/writable by game-side code):
 * - Per-agent SoA lists: agState (current state id), agSee / agHear
 *   (last perception result), agLost (frames since last sight while
 *   pursuing), agLastX / agLastZ (last sensed player position),
 *   agFX / agFZ (facing unit vector), agWP (current waypoint index).
 * - ai_perceive: perception for agent agCur — sight (distance + FOV
 *   cone + dyn_raycast line of sight against dynamic objects and the
 *   scene-bounds walls/floor; the baked temple architecture is not in
 *   the raycast data set, the phase-3 limitation) and hearing (player
 *   motion within hearDistance; impact noise: the latest physics
 *   impact event is re-published as a noise at the object's position
 *   with radius |delta-v| * noScale, fresh for 45 frames).
 * - ai_steer: seek steering for agent agCur toward (agTX, agTZ) at
 *   agSpd units/frame. Moves the agent's dynamic object directly
 *   (agents are non-physical objects; player collision is handled by
 *   dyn_collide as usual), clamps to the scene bounds, updates facing
 *   and the object's render yaw, and sets agArr = 1 on arrival.
 * - ai_update: per-frame driver. Refreshes the noise record, throttles
 *   perception (every agPerEvery frames per agent, phase-offset),
 *   skips agents in inactive rooms, and runs the reference FSM for
 *   agents with agAuto = 1:
 *     PATROL(1) -> sense player -> PURSUE(2) -> lost for agLoseF
 *     frames or reached stale position -> RETURN(3) -> at waypoint ->
 *     PATROL(1).
 *
 * Scratch register discipline: ai_perceive calls dyn_raycast, which
 * clobbers the o-, dT-, p- and e- scratch registers; everything
 * ai_update needs across the call lives in the ag- lists and the a-
 * registers declared here, which neither dyn_raycast nor loadRow
 * touches.
 *
 * All numeric parameters are per-agent list values resolved from the
 * AgentSpec (scene/ai.ts); defaults there are provisional.
 */
import type { ProcHandle } from '../builder/index';
import type { DynCtx } from './dynamic';
import { loadRow } from './dynamic';
import { dynRoomActiveExpr } from './rooms';
import { AI_STATE, resolveAgents, type AgentSpec } from '../scene/ai';
import type { DynSceneSpec } from '../scene/dynamic';

export interface AiProcs { perceive: ProcHandle; steer: ProcHandle; update: ProcHandle }

export interface AiCtx extends DynCtx {
  raycast: ProcHandle;
  /** Whether room activation gating applies (RoomsSpec present). */
  rooms: boolean;
}

/** Noise radius per unit of impact |delta-v|. PROVISIONAL working value. */
export const AI_NOISE_SCALE = 30;
/** Frames an impact noise stays hearable. PROVISIONAL working value. */
export const AI_NOISE_FRESH_FRAMES = 45;
/** Impact noise radius cap. PROVISIONAL working value. */
export const AI_NOISE_MAX_RADIUS = 8;

/** Declare the agent tables, waypoint lists and scratch registers. */
export function declareAiData(s: any, agents: AgentSpec[], dyn: DynSceneSpec): void {
  const resolved = resolveAgents(agents, dyn.objects.map((o) => [o.pos[0], o.pos[2]]));
  s.lst('agObj', resolved.map((a) => a.object));
  s.lst('agAuto', resolved.map((a) => a.auto));
  s.lst('agState', resolved.map(() => AI_STATE.patrol));
  s.lst('agWP', resolved.map(() => 0));
  s.lst('agWpOff', resolved.map((a) => a.wpOff));
  s.lst('agWpN', resolved.map((a) => a.wpN));
  s.lst('agWpX', agents.flatMap((a) => a.waypoints.map((w) => w[0])));
  s.lst('agWpZ', agents.flatMap((a) => a.waypoints.map((w) => w[1])));
  s.lst('agSpdP', resolved.map((a) => a.patrolSpeed));
  s.lst('agSpdC', resolved.map((a) => a.chaseSpeed));
  s.lst('agViewD', resolved.map((a) => a.viewDistance));
  s.lst('agViewCos', resolved.map((a) => a.viewHalfAngleCos));
  s.lst('agHearD', resolved.map((a) => a.hearDistance));
  s.lst('agLoseF', resolved.map((a) => a.loseFrames));
  s.lst('agPerEvery', resolved.map((a) => a.perceptEvery));
  s.lst('agSee', resolved.map(() => 0));
  s.lst('agHear', resolved.map(() => 0));
  s.lst('agLost', resolved.map(() => 0));
  s.lst('agLastX', resolved.map((a) => dyn.objects[a.object - 1]?.pos[0] ?? 0));
  s.lst('agLastZ', resolved.map((a) => dyn.objects[a.object - 1]?.pos[2] ?? 0));
  s.lst('agFX', resolved.map((a) => a.face[0]));
  s.lst('agFZ', resolved.map((a) => a.face[1]));
  s.var('agN', agents.length);
  // Scratch / I/O registers (dyn_raycast and loadRow never touch these).
  for (const n of ['agCur', 'agArr', 'agTX', 'agTZ', 'agSpd', 'aObj', 'aState', 'aFlag',
    'aOX', 'aOY', 'aOZ', 'aT1', 'aT2', 'aT3', 'aT4', 'aT5', 'aT6', 'aT7', 'aT8']) s.var(n, 0);
  // Impact-noise record (refreshed by ai_update from the ev* queue).
  s.var('noX', 0);
  s.var('noZ', 0);
  s.var('noR', 0);
  s.var('noFrame', -9999);
  s.var('aiEvSeen', 0);
  s.var('noScale', AI_NOISE_SCALE);
}

export function defineAiProcs(ctx: AiCtx): AiProcs {
  const { s } = ctx;
  const v = (n: string) => s.var(n);
  const item = (list: string, idx: any) => s.itemOf(list, idx);
  const ag = (list: string) => item(list, v('agCur'));

  // ---------- ai_perceive ----------
  const perceive = s.defineProc('ai_perceive', undefined, true, [
    s.setVar('aObj', ag('agObj')),
    ...loadRow(s, v('aObj')),
    // Save the eye position before dyn_raycast clobbers the o* registers.
    s.setVar('aOX', v('oX')),
    s.setVar('aOY', s.add(v('oY'), s.mul(v('oHy'), 0.6))),
    s.setVar('aOZ', v('oZ')),
    s.setVar('aT1', s.sub(v('psX'), v('aOX'))),
    s.setVar('aT2', s.sub(v('psY'), v('aOY'))),
    s.setVar('aT3', s.sub(v('psZ'), v('aOZ'))),
    s.setVar('aT4', s.sqrt(s.add(s.mul(v('aT1'), v('aT1')), s.mul(v('aT3'), v('aT3'))))), // XZ distance
    s.setVar('aT5', s.sqrt(s.add(s.mul(v('aT1'), v('aT1')), s.add(s.mul(v('aT2'), v('aT2')), s.mul(v('aT3'), v('aT3')))))), // 3D distance
    s.replaceItem('agSee', v('agCur'), 0),
    s.replaceItem('agHear', v('agCur'), 0),
    // --- sight ---
    s.if(s.lnot(s.gt(v('aT5'), ag('agViewD'))), [
      s.setVar('aFlag', 1),
      s.if(s.lnot(s.lt(v('aT4'), 0.3)), [
        // FOV cone: dot(facing, dirXZ) >= cos(half-angle).
        s.if(s.lt(
          s.div(s.add(s.mul(ag('agFX'), v('aT1')), s.mul(ag('agFZ'), v('aT3'))), v('aT4')),
          ag('agViewCos'),
        ), [s.setVar('aFlag', 0)]),
      ]),
      s.if(s.eq(v('aFlag'), 1), [
        s.ifElse(s.lt(v('aT5'), 0.05), [s.setVar('aFlag', 2)], [
          // Line of sight via the generic raycast (dynamic objects +
          // floor + bounds walls). A hit strictly before the player
          // (other than the agent itself) blocks the view.
          s.setVar('rayOX', v('aOX')), s.setVar('rayOY', v('aOY')), s.setVar('rayOZ', v('aOZ')),
          s.setVar('rayDX', s.div(v('aT1'), v('aT5'))),
          s.setVar('rayDY', s.div(v('aT2'), v('aT5'))),
          s.setVar('rayDZ', s.div(v('aT3'), v('aT5'))),
          s.callProc(ctx.raycast),
          s.if(s.land(s.gt(v('rcKind'), 0), s.lt(v('rcT'), s.sub(v('aT5'), 0.4))), [
            s.if(s.lor(s.lnot(s.eq(v('rcKind'), 1)), s.lnot(s.eq(v('rcId'), v('aObj')))), [
              s.setVar('aFlag', 0),
            ]),
          ]),
        ]),
        s.if(s.gt(v('aFlag'), 0), [
          s.replaceItem('agSee', v('agCur'), 1),
          s.replaceItem('agLastX', v('agCur'), v('psX')),
          s.replaceItem('agLastZ', v('agCur'), v('psZ')),
          s.replaceItem('agLost', v('agCur'), 0),
        ]),
      ]),
    ]),
    // --- hearing (only when the player was not seen) ---
    s.if(s.eq(ag('agSee'), 0), [
      // Player motion within hearDistance.
      s.if(s.land(
        s.lor(s.lor(v('inMF'), v('inMS')), v('inMU')),
        s.lnot(s.gt(v('aT4'), ag('agHearD'))),
      ), [
        s.replaceItem('agHear', v('agCur'), 1),
        s.replaceItem('agLastX', v('agCur'), v('psX')),
        s.replaceItem('agLastZ', v('agCur'), v('psZ')),
      ]),
      // Fresh impact noise: heard within max(hearDistance, noise radius).
      s.if(s.land(s.eq(ag('agHear'), 0), s.lnot(s.gt(s.sub(v('physFrame'), v('noFrame')), AI_NOISE_FRESH_FRAMES))), [
        s.setVar('aT6', s.sub(v('noX'), v('aOX'))),
        s.setVar('aT7', s.sub(v('noZ'), v('aOZ'))),
        s.setVar('aT8', s.sqrt(s.add(s.mul(v('aT6'), v('aT6')), s.mul(v('aT7'), v('aT7'))))),
        s.setVar('aFlag', ag('agHearD')),
        s.if(s.gt(v('noR'), v('aFlag')), [s.setVar('aFlag', v('noR'))]),
        s.if(s.lnot(s.gt(v('aT8'), v('aFlag'))), [
          s.replaceItem('agHear', v('agCur'), 1),
          s.replaceItem('agLastX', v('agCur'), v('noX')),
          s.replaceItem('agLastZ', v('agCur'), v('noZ')),
        ]),
      ]),
    ]),
  ]);

  // ---------- ai_steer ----------
  const steer = s.defineProc('ai_steer', undefined, true, [
    s.setVar('aObj', ag('agObj')),
    s.setVar('aT1', s.sub(v('agTX'), item('dynX', v('aObj')))),
    s.setVar('aT3', s.sub(v('agTZ'), item('dynZ', v('aObj')))),
    s.setVar('aT4', s.sqrt(s.add(s.mul(v('aT1'), v('aT1')), s.mul(v('aT3'), v('aT3'))))),
    s.setVar('agArr', 0),
    // Bounds margin: the object's XZ radius (box: larger half extent).
    s.setVar('aT6', item('dynR', v('aObj'))),
    s.if(s.gt(item('dynHx', v('aObj')), v('aT6')), [s.setVar('aT6', item('dynHx', v('aObj')))]),
    s.if(s.gt(item('dynHz', v('aObj')), v('aT6')), [s.setVar('aT6', item('dynHz', v('aObj')))]),
    s.ifElse(s.lor(s.lnot(s.gt(v('aT4'), v('agSpd'))), s.lt(v('aT4'), 0.05)), [
      // Arrive: snap to the target (still bounds-clamped below).
      s.setVar('aT7', v('agTX')),
      s.setVar('aT8', v('agTZ')),
      s.setVar('agArr', 1),
    ], [
      s.setVar('aT7', s.add(item('dynX', v('aObj')), s.mul(s.div(v('aT1'), v('aT4')), v('agSpd')))),
      s.setVar('aT8', s.add(item('dynZ', v('aObj')), s.mul(s.div(v('aT3'), v('aT4')), v('agSpd')))),
      // Facing follows the motion; render yaw = atan2(dx, dz) in degrees.
      s.replaceItem('agFX', v('agCur'), s.div(v('aT1'), v('aT4'))),
      s.replaceItem('agFZ', v('agCur'), s.div(v('aT3'), v('aT4'))),
      s.ifElse(s.lt(s.abs(v('aT3')), 0.0001), [
        s.ifElse(s.gt(v('aT1'), 0), [s.setVar('aT5', 90)], [s.setVar('aT5', -90)]),
      ], [
        s.setVar('aT5', s.atan(s.div(v('aT1'), v('aT3')))),
        s.if(s.lt(v('aT3'), 0), [
          s.ifElse(s.lnot(s.lt(v('aT1'), 0)), [s.changeVar('aT5', 180)], [s.changeVar('aT5', -180)]),
        ]),
      ]),
      s.replaceItem('dynYaw', v('aObj'), v('aT5')),
    ]),
    // Clamp into the scene bounds (margin = XZ radius).
    s.if(s.lt(v('aT7'), s.add(v('dynBdX0'), v('aT6'))), [s.setVar('aT7', s.add(v('dynBdX0'), v('aT6')))]),
    s.if(s.gt(v('aT7'), s.sub(v('dynBdX1'), v('aT6'))), [s.setVar('aT7', s.sub(v('dynBdX1'), v('aT6')))]),
    s.if(s.lt(v('aT8'), s.add(v('dynBdZ0'), v('aT6'))), [s.setVar('aT8', s.add(v('dynBdZ0'), v('aT6')))]),
    s.if(s.gt(v('aT8'), s.sub(v('dynBdZ1'), v('aT6'))), [s.setVar('aT8', s.sub(v('dynBdZ1'), v('aT6')))]),
    s.replaceItem('dynX', v('aObj'), v('aT7')),
    s.replaceItem('dynZ', v('aObj'), v('aT8')),
    s.setVar('physDirty', 1),
  ]);

  // ---------- ai_update ----------
  const fsmBody: any[] = [
    // Perception, throttled per agent (phase-offset by agent index).
    s.if(s.eq(s.mod(s.add(v('physFrame'), v('agCur')), ag('agPerEvery')), 0), [
      s.callProc(perceive),
    ]),
    s.if(s.eq(ag('agAuto'), 1), [
      s.setVar('aState', ag('agState')),
      // Sense -> pursue (from any state).
      s.if(s.land(s.lor(s.eq(ag('agSee'), 1), s.eq(ag('agHear'), 1)), s.lnot(s.eq(v('aState'), AI_STATE.pursue))), [
        s.setVar('aState', AI_STATE.pursue),
      ]),
      // While pursuing without sight, count up to the give-up limit.
      s.if(s.land(s.eq(v('aState'), AI_STATE.pursue), s.eq(ag('agSee'), 0)), [
        s.replaceItem('agLost', v('agCur'), s.add(ag('agLost'), 1)),
        s.if(s.gt(ag('agLost'), ag('agLoseF')), [s.setVar('aState', AI_STATE.return)]),
      ]),
      // Steering per state.
      s.ifElse(s.eq(v('aState'), AI_STATE.pursue), [
        s.setVar('agTX', ag('agLastX')),
        s.setVar('agTZ', ag('agLastZ')),
        s.setVar('agSpd', ag('agSpdC')),
        s.callProc(steer),
        // Reached the last known position and still no sight: give up.
        s.if(s.land(s.eq(v('agArr'), 1), s.eq(ag('agSee'), 0)), [
          s.setVar('aState', AI_STATE.return),
        ]),
      ], [
        s.if(s.gt(ag('agWpN'), 0), [
          s.setVar('aT1', s.add(ag('agWpOff'), ag('agWP'))),
          s.setVar('agTX', item('agWpX', v('aT1'))),
          s.setVar('agTZ', item('agWpZ', v('aT1'))),
          s.setVar('agSpd', ag('agSpdP')),
          s.callProc(steer),
          s.if(s.eq(v('agArr'), 1), [
            s.ifElse(s.eq(v('aState'), AI_STATE.patrol), [
              s.replaceItem('agWP', v('agCur'), s.mod(s.add(ag('agWP'), 1), ag('agWpN'))),
            ], [
              s.setVar('aState', AI_STATE.patrol),
            ]),
          ]),
        ]),
      ]),
      s.replaceItem('agState', v('agCur'), v('aState')),
    ]),
  ];
  const update = s.defineProc('ai_update', undefined, true, [
    // Refresh the impact-noise record from the newest physics event.
    s.if(s.lnot(s.eq(v('evCount'), v('aiEvSeen'))), [
      s.setVar('aiEvSeen', v('evCount')),
      s.if(s.gt(v('evLastObj'), 0), [
        s.setVar('noX', item('dynX', v('evLastObj'))),
        s.setVar('noZ', item('dynZ', v('evLastObj'))),
        s.setVar('noR', s.mul(v('evLastImpact'), v('noScale'))),
        s.if(s.gt(v('noR'), AI_NOISE_MAX_RADIUS), [s.setVar('noR', AI_NOISE_MAX_RADIUS)]),
        s.setVar('noFrame', v('physFrame')),
      ]),
    ]),
    s.setVar('agCur', 1),
    s.repeat(v('agN'), [
      ...(ctx.rooms
        ? [s.if(dynRoomActiveExpr(s, ag('agObj')), fsmBody)]
        : fsmBody),
      s.changeVar('agCur', 1),
    ]),
  ]);

  return { perceive, steer, update };
}

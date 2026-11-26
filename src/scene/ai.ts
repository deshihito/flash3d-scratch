/**
 * ai.ts — L2 scene API for the generic AI state-machine base (phase 5).
 *
 * Design: design-repo-core.md section 3.6. The engine provides the
 * frame, not the enemy: a finite-state machine over numeric state ids,
 * perception queries (sight: distance + field-of-view + raycast line of
 * sight; hearing: player motion and impact-noise events) and steering
 * (seek a target point; wall handling is left to the collision step,
 * and room rects keep patrols in bounds). Pathfinding (grid A* etc.)
 * is out of scope per the design; room adjacency is the coarse graph.
 *
 * The reference machine shipped in src/engine/ai.ts is:
 *   1 PATROL — follow the waypoint loop at patrolSpeed
 *   2 PURSUE — seek the last sensed player position at chaseSpeed
 *              (sight refreshes it; losing the player for loseFrames,
 *              or reaching a stale position, drops to RETURN)
 *   3 RETURN — seek the current waypoint at patrolSpeed, then PATROL
 * State ids and the per-agent state list (agState) are public: game
 * code in a future repo can read them, and agents flagged auto = 0
 * skip the reference machine entirely (perception + steering stay
 * available as primitives). Enemy specifics — what the states *mean*,
 * speeds, sense ranges — are game-side; every number below is a
 * per-agent parameter, and the defaults are PROVISIONAL engine working
 * values, not decided specifications (design section 6, E4/G4).
 */

export const AI_STATE = { patrol: 1, pursue: 2, return: 3 } as const;

export interface AgentSpec {
  /** 1-based dynamic-object slot this agent drives (DynSceneSpec order). */
  object: number;
  /** Patrol loop in world XZ; the agent seeks them in order, wrapping. */
  waypoints: Array<[number, number]>;
  /** Run the reference FSM (default true). False = primitives only. */
  auto?: boolean;
  /** Patrol/return speed, units per frame. PROVISIONAL default 0.03. */
  patrolSpeed?: number;
  /** Pursue speed, units per frame. PROVISIONAL default 0.055. */
  chaseSpeed?: number;
  /** Sight range (3D distance to the player). PROVISIONAL default 4.5. */
  viewDistance?: number;
  /**
   * Cosine of the sight half-angle: the player is in view when
   * dot(facing, dirToPlayer) >= this. PROVISIONAL default 0.57
   * (about +/-55 degrees).
   */
  viewHalfAngleCos?: number;
  /** Hearing range for player motion, units. PROVISIONAL default 2.2. */
  hearDistance?: number;
  /**
   * Frames without sight before PURSUE gives up to RETURN.
   * PROVISIONAL default 150.
   */
  loseFrames?: number;
  /**
   * Perception runs every N frames per agent (design section 4.2:
   * perception is throttled by design; the interval is a parameter,
   * open item E4). PROVISIONAL default 5.
   */
  perceptEvery?: number;
}

export interface AgentResolved {
  object: number;
  auto: number;
  /** Index of this agent's first waypoint in the flat waypoint lists (1-based). */
  wpOff: number;
  wpN: number;
  patrolSpeed: number;
  chaseSpeed: number;
  viewDistance: number;
  viewHalfAngleCos: number;
  hearDistance: number;
  loseFrames: number;
  perceptEvery: number;
  /** Initial facing (unit XZ) toward the first waypoint; (0,1) if degenerate. */
  face: [number, number];
}

export const AI_DEFAULTS = {
  patrolSpeed: 0.03,
  chaseSpeed: 0.055,
  viewDistance: 4.5,
  viewHalfAngleCos: 0.57,
  hearDistance: 2.2,
  loseFrames: 150,
  perceptEvery: 5,
} as const;

export function resolveAgents(agents: AgentSpec[], dynPos: Array<[number, number]>): AgentResolved[] {
  let off = 1;
  return agents.map((a) => {
    const start = dynPos[a.object - 1] ?? [0, 0];
    const first = a.waypoints[0] ?? start;
    let fx = first[0] - start[0], fz = first[1] - start[1];
    const len = Math.sqrt(fx * fx + fz * fz);
    if (len > 1e-6) { fx /= len; fz /= len; } else { fx = 0; fz = 1; }
    const r: AgentResolved = {
      object: a.object,
      auto: a.auto === false ? 0 : 1,
      wpOff: off,
      wpN: a.waypoints.length,
      patrolSpeed: a.patrolSpeed ?? AI_DEFAULTS.patrolSpeed,
      chaseSpeed: a.chaseSpeed ?? AI_DEFAULTS.chaseSpeed,
      viewDistance: a.viewDistance ?? AI_DEFAULTS.viewDistance,
      viewHalfAngleCos: a.viewHalfAngleCos ?? AI_DEFAULTS.viewHalfAngleCos,
      hearDistance: a.hearDistance ?? AI_DEFAULTS.hearDistance,
      loseFrames: a.loseFrames ?? AI_DEFAULTS.loseFrames,
      perceptEvery: Math.max(1, Math.round(a.perceptEvery ?? AI_DEFAULTS.perceptEvery)),
      face: [fx, fz],
    };
    off += a.waypoints.length;
    return r;
  });
}

/**
 * temple-constants.ts — L2 scene data: the temple scene's defining constants.
 *
 * Every value is transcribed verbatim from scratch-ue5-pen-research's
 * build_ue5_lumen_hybrid.py section 1 (SCENE CONSTANTS). No new values.
 * Consumed by the L2.5 bake pipeline (src/bake/temple-bake.ts) and the
 * L1 engine core (src/engine/hybrid-engine.ts).
 */
import { degToRad, pyRound } from '../pycompat';

export const [SUN_X, SUN_Y, SUN_Z] = [0.7206, 0.4404, 0.5355];
export const [CRY_X, CRY_Y, CRY_Z] = [(-1.85), 0.08, 0.55];
export const [HERO_X, HERO_Y, HERO_Z] = [0.02, (-0.18), 1.05];
export const GOLD_R = 0.76;
export const RING_R1 = 1.06;
export const RING_R2 = 0.088;
export const [_az, _ax] = [degToRad((-19.0)), degToRad(16.0)];
export const [_cz, _sz] = [Math.cos(_az), Math.sin(_az)];
export const [_cx, _sx] = [Math.cos(_ax), Math.sin(_ax)];
export const [RM00, RM01, RM02] = [pyRound(_cz, 5), pyRound(_sz, 5), 0.0];
export const [RM10, RM11, RM12] = [pyRound(((-_cx) * _sz), 5), pyRound((_cx * _cz), 5), pyRound(_sx, 5)];
export const [RM20, RM21, RM22] = [pyRound((_sx * _sz), 5), pyRound(((-_sx) * _cz), 5), pyRound(_cx, 5)];
export const [OBS_X, OBS_Y, OBS_Z] = [1.48, (-0.62), (-0.35)];
export const OBS_R = 0.58;
export const COLS = [[(-2.35), 2.35], [2.35, 2.35]];
export const COL_R = 0.44;
export const BEAMS_Z = [[(-1.75), (-1.25)], [0.55, 1.05], [2.85, 3.35]];
export const [BEAM_Y0, BEAM_Y1] = [2.9, 3.3];

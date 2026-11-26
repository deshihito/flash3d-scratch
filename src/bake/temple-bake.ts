/**
 * temple-bake.ts — L2.5 bake pipeline (host code, runs at build time).
 *
 * Faithful TS port of the host-side half of build_ue5_lumen_hybrid.py:
 * evalLumenHdr (static HDR lighting evaluation), acesRgbTuple (ACES
 * tonemapping baked into vertex colors) and bakeCinemaScene (the temple
 * geometry: floor quads, gouraud architecture, pedestal, crystal, and the
 * multi-layer soft shadow quads). Static lighting is fully baked here;
 * the Scratch side never evaluates it at runtime (design section 0).
 *
 * Ported mechanically from the Python source and verified by comparing
 * the generated sb3 against the original ue5_lumen_hybrid.sb3
 * (see tools/compare-temple.mjs). Values are the original's, unchanged.
 */
import { enumerate, pyMod, range } from '../pycompat';
import {
  BEAMS_Z, BEAM_Y0, BEAM_Y1, COL_R, COLS, CRY_X, CRY_Y, CRY_Z, SUN_X, SUN_Y, SUN_Z,
} from '../scene/temple-constants';

function clamp(v: any, lo: any, hi: any): any {
  return ((v < lo) ? lo : ((v > hi) ? hi : v));
}

function normalize(x: any, y: any, z: any): any {
  let l: any;
  l = Math.sqrt((((x * x) + (y * y)) + (z * z)));
  return ((l > 1e-09) ? [(x / l), (y / l), (z / l)] : [0.0, 1.0, 0.0]);
}

export function acesRgbTuple(r: any, g: any, b: any, exposure: any = 0.88): any {
  let out: any, c: any, x: any;
  out = [];
  for (c of [r, g, b]) {
    x = Math.max(0.0, (c * exposure));
    x = ((x * ((2.51 * x) + 0.03)) / ((x * ((2.43 * x) + 0.59)) + 0.14));
    x = clamp(x, 0.0, 1.0);
    out.push(Math.trunc(clamp(Math.floor(((Math.sqrt(x) * 255.0) + 0.5)), 0, 255)));
  }
  return out;
}

function rgbInt(rgb: any): any {
  return (((rgb[0] * 65536) + (rgb[1] * 256)) + rgb[2]);
}

export function evalLumenHdr(px: any, py: any, pz: any, nx: any, ny: any, nz: any, alb_r: any, alb_g: any, alb_b: any, sun_vis: any = 1.0, ao: any = 1.0): any {
  let ndotl: any, dr: any, dg: any, db: any, sky_w: any, gi_r: any, gi_g: any, gi_b: any, cx: any, cy: any, cz: any, cd2: any, cd: any, c_ndotl: any, atten: any, c_term: any;
  ndotl = Math.max(0.0, (((nx * SUN_X) + (ny * SUN_Y)) + (nz * SUN_Z)));
  dr = (((alb_r * 3.05) * ndotl) * sun_vis);
  dg = (((alb_g * 2.18) * ndotl) * sun_vis);
  db = (((alb_b * 1.38) * ndotl) * sun_vis);
  sky_w = (0.5 + (0.5 * ny));
  gi_r = (((0.36 * sky_w) + (0.56 * (1.0 - sky_w))) * ao);
  gi_g = (((0.35 * sky_w) + (0.4 * (1.0 - sky_w))) * ao);
  gi_b = (((0.44 * sky_w) + (0.25 * (1.0 - sky_w))) * ao);
  dr += (alb_r * gi_r);
  dg += (alb_g * gi_g);
  db += (alb_b * gi_b);
  ([cx, cy, cz] = [(CRY_X - px), (CRY_Y - py), (CRY_Z - pz)]);
  cd2 = (((cx * cx) + (cy * cy)) + (cz * cz));
  cd = (Math.sqrt(cd2) + 1e-05);
  c_ndotl = Math.max(0.0, ((((cx * nx) + (cy * ny)) + (cz * nz)) / cd));
  atten = (1.0 / (0.28 + (cd2 * 0.85)));
  c_term = ((((c_ndotl * 0.85) + 0.15) * atten) * ao);
  dr += ((alb_r * 0.16) * c_term);
  dg += ((alb_g * 1.6) * c_term);
  db += ((alb_b * 2.3) * c_term);
  return [dr, dg, db];
}

export function bakeCinemaScene(): any {
  let floor_quads: any, fx_edges: any, fz_edges: any, fy: any, iz: any, z0: any, z1: any, ix: any, x0: any, x1: any, cx: any, cz: any, v0: any, v1: any, v2: any, v3: any, is_dark: any, ar: any, ag: any, ab: any, gloss: any, f0: any, vein: any, ao: any, r: any, g: any, b: any, wall_shadow_layers: any, t_bot: any, li: any, pad_top: any, pad_bot: any, x_off: any, p0: any, p1: any, p2: any, p3: any, floor_shadow_layers: any, raw_fl_sh: any, a: any, c: any, d: any, gouraud_arch: any, n_arc1: any, r1: any, cy1: any, i: any, a0: any, a1: any, y0: any, y1: any, amid: any, inx: any, iny: any, sv: any, n_arc2: any, cx2_a: any, r2_a: any, cy2_a: any, ped_quads: any, px0: any, px1: any, py0: any, py1: any, pz0: any, pz1: any, nx: any, ny: any, nz: any, rt: any, gt: any, bt: any, rb: any, gb: any, bb: any, cr_r: any, cr_h: any, top: any, bot: any, ring: any, cry_tris: any, b_pt: any, e1: any, e2: any, lit: any, e2b: any;
  floor_quads = [];
  fx_edges = [(-3.55), (-3.0), (-2.0), (-1.0), 0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.2];
  fz_edges = [(-4.0), (-3.0), (-2.0), (-1.0), 0.0, 1.0, 2.0, 3.0, 4.0, 4.3];
  fy = (-1.2);
  for (iz of range((fz_edges.length - 1))) {
    ([z0, z1] = [fz_edges[iz], fz_edges[(iz + 1)]]);
    for (ix of range((fx_edges.length - 1))) {
      ([x0, x1] = [fx_edges[ix], fx_edges[(ix + 1)]]);
      ([cx, cz] = [(0.5 * (x0 + x1)), (0.5 * (z0 + z1))]);
      ([v0, v1, v2, v3] = [[x0, fy, z0], [x1, fy, z0], [x1, fy, z1], [x0, fy, z1]]);
      is_dark = (pyMod((Math.trunc(Math.floor(cx)) + Math.trunc(Math.floor(cz))), 2) !== 0);
      if (is_dark) {
        ([ar, ag, ab] = [0.065, 0.072, 0.095]);
        ([gloss, f0] = [0.86, 0.3]);
      } else {
        vein = (0.94 + (0.06 * Math.sin(((cx * 2.7) + (cz * 1.9)))));
        ([ar, ag, ab] = [(0.72 * vein), (0.64 * vein), (0.54 * vein)]);
        ([gloss, f0] = [0.44, 0.14]);
      }
      ao = 1.0;
      if ((cx < (-2.6))) {
        ao -= (0.3 * (1.0 - ((cx + 3.55) / 0.95)));
      }
      if ((cz > 3.4)) {
        ao -= (0.25 * (1.0 - ((4.3 - cz) / 0.9)));
      }
      ([r, g, b] = evalLumenHdr(cx, fy, cz, 0.0, 1.0, 0.0, ar, ag, ab, 0.86, clamp(ao, 0.36, 1.0)));
      floor_quads.push([v0, v1, v2, v3, r, g, b, cx, cz, gloss, f0]);
    }
  }
  wall_shadow_layers = [[], [], []];
  t_bot = ((2.95 - (-1.2)) / SUN_Y);
  function wallPt(z_start: any, t_val: any, x_off: any): any {
    let y: any, z: any, t_c: any;
    y = (2.95 - (t_val * SUN_Y));
    z = (z_start - (t_val * SUN_Z));
    if ((z < (-4.05))) {
      t_c = ((z_start - (-4.05)) / SUN_Z);
      z = (-4.05);
      y = (2.95 - (t_c * SUN_Y));
    }
    return [((-3.535) + x_off), clamp(y, (-1.2), 2.95), clamp(z, (-4.05), 4.3)];
  }

  for ([z0, z1] of BEAMS_Z) {
    for ([li, [pad_top, pad_bot, x_off]] of enumerate([[0.08, 0.24, 0.004], [0.03, 0.11, 0.008], [(-0.02), (-0.02), 0.012]])) {
      p0 = wallPt((z0 - pad_top), 0.0, x_off);
      p1 = wallPt((z1 + pad_top), 0.0, x_off);
      p2 = wallPt((z1 + pad_bot), t_bot, x_off);
      p3 = wallPt((z0 - pad_bot), t_bot, x_off);
      wall_shadow_layers[li].push([p0, p1, p2, p3]);
    }
  }
  floor_shadow_layers = [[], []];
  raw_fl_sh = [[[(-3.55), 4.3], [(-1.35), 4.3], [(-3.55), 2.65], [(-3.55), 4.3]], [[1.35, 4.3], [3.55, 4.3], [0.65, 2.15], [(-1.55), 2.15]], [[2.08, 2.58], [2.62, 2.12], [(-0.42), (-0.18)], [(-0.98), 0.28]], [[(-2.58), 2.58], [(-2.12), 2.12], [(-3.55), 1.05], [(-3.55), 1.68]]];
  for ([a, b, c, d] of raw_fl_sh) {
    floor_shadow_layers[1].push([[a[0], (-1.19), a[1]], [b[0], (-1.19), b[1]], [c[0], (-1.19), c[1]], [d[0], (-1.19), d[1]]]);
    floor_shadow_layers[0].push([[a[0], (-1.19), a[1]], [(b[0] + 0.14), (-1.19), (b[1] - 0.14)], [(c[0] + 0.14), (-1.19), (c[1] - 0.16)], [(d[0] - 0.14), (-1.19), (d[1] + 0.14)]]);
  }
  gouraud_arch = [];
  function addGarch(v0: any, v1: any, v2: any, v3: any, nx: any, ny: any, nz: any, sun_vis: any = 1.0, ao_top: any = 0.96, ao_bot: any = 0.72, tint: any = [0.78, 0.63, 0.46]): any {
    let ys: any, y_top: any, y_bot: any, cx: any, cz: any, rt: any, gt: any, bt: any, rb: any, gb: any, bb: any;
    ys = [v0[1], v1[1], v2[1], v3[1]];
    ([y_top, y_bot] = [Math.max(...ys), Math.min(...ys)]);
    cx = (0.25 * (((v0[0] + v1[0]) + v2[0]) + v3[0]));
    cz = (0.25 * (((v0[2] + v1[2]) + v2[2]) + v3[2]));
    ([rt, gt, bt] = evalLumenHdr(cx, y_top, cz, nx, ny, nz, tint[0], tint[1], tint[2], sun_vis, ao_top));
    ([rb, gb, bb] = evalLumenHdr(cx, y_bot, cz, nx, ny, nz, tint[0], tint[1], tint[2], sun_vis, ao_bot));
    gouraud_arch.push([v0, v1, v2, v3, acesRgbTuple(rt, gt, bt), acesRgbTuple(rb, gb, bb), nx, ny, nz]);
  }

  addGarch([(-3.55), (-1.2), 4.3], [(-1.25), (-1.2), 4.3], [(-1.25), 2.95, 4.3], [(-3.55), 2.95, 4.3], 0, 0, (-1), 0.2, 0.88, 0.68);
  addGarch([1.25, (-1.2), 4.3], [1.85, (-1.2), 4.3], [1.85, 2.95, 4.3], [1.25, 2.95, 4.3], 0, 0, (-1), 0.24, 0.92, 0.72);
  addGarch([2.85, (-1.2), 4.3], [3.6, (-1.2), 4.3], [3.6, 2.95, 4.3], [2.85, 2.95, 4.3], 0, 0, (-1), 0.26, 0.92, 0.74);
  n_arc1 = 16;
  ([r1, cy1] = [1.25, 0.72]);
  for (i of range(n_arc1)) {
    a0 = (Math.PI * (1.0 - (i / n_arc1)));
    a1 = (Math.PI * (1.0 - ((i + 1) / n_arc1)));
    ([x0, y0] = [(r1 * Math.cos(a0)), (cy1 + (r1 * Math.sin(a0)))]);
    ([x1, y1] = [(r1 * Math.cos(a1)), (cy1 + (r1 * Math.sin(a1)))]);
    addGarch([x0, y0, 4.3], [x1, y1, 4.3], [x1, 2.95, 4.3], [x0, 2.95, 4.3], 0, 0, (-1), 0.22, 0.88, 0.92);
    amid = (0.5 * (a0 + a1));
    ([inx, iny] = [(-Math.cos(amid)), (-Math.sin(amid))]);
    sv = ((inx > 0.0) ? 1.0 : 0.28);
    addGarch([x0, y0, 4.92], [x1, y1, 4.92], [x1, y1, 4.3], [x0, y0, 4.3], inx, iny, 0, sv, 0.95, 0.85);
  }
  addGarch([(-1.25), (-1.2), 4.92], [(-1.25), (-1.2), 4.3], [(-1.25), 0.72, 4.3], [(-1.25), 0.72, 4.92], 1, 0, 0, 1.0, 0.98, 0.76);
  addGarch([1.25, (-1.2), 4.3], [1.25, (-1.2), 4.92], [1.25, 0.72, 4.92], [1.25, 0.72, 4.3], (-1), 0, 0, 0.22, 0.88, 0.68);
  n_arc2 = 10;
  ([cx2_a, r2_a, cy2_a] = [2.35, 0.5, 0.62]);
  for (i of range(n_arc2)) {
    a0 = (Math.PI * (1.0 - (i / n_arc2)));
    a1 = (Math.PI * (1.0 - ((i + 1) / n_arc2)));
    ([x0, y0] = [(cx2_a + (r2_a * Math.cos(a0))), (cy2_a + (r2_a * Math.sin(a0)))]);
    ([x1, y1] = [(cx2_a + (r2_a * Math.cos(a1))), (cy2_a + (r2_a * Math.sin(a1)))]);
    addGarch([x0, y0, 4.3], [x1, y1, 4.3], [x1, 2.95, 4.3], [x0, 2.95, 4.3], 0, 0, (-1), 0.24, 0.88, 0.92);
  }
  addGarch([(-3.55), (-1.2), (-4.2)], [(-3.55), (-1.2), 4.3], [(-3.55), 2.95, 4.3], [(-3.55), 2.95, (-4.2)], 1, 0, 0, 1.0, 0.98, 0.72);
  for ([z0, z1] of [...BEAMS_Z].reverse()) {
    addGarch([(-3.55), BEAM_Y0, z1], [3.55, BEAM_Y0, z1], [3.55, BEAM_Y0, z0], [(-3.55), BEAM_Y0, z0], 0, (-1), 0, 0.0, 0.84, 0.94);
    addGarch([(-3.55), BEAM_Y0, z0], [3.55, BEAM_Y0, z0], [3.55, BEAM_Y1, z0], [(-3.55), BEAM_Y1, z0], 0, 0, (-1), 0.26, 0.98, 0.82);
    addGarch([3.55, BEAM_Y0, z1], [(-3.55), BEAM_Y0, z1], [(-3.55), BEAM_Y1, z1], [3.55, BEAM_Y1, z1], 0, 0, 1, 0.95, 1.0, 0.85);
    addGarch([3.55, BEAM_Y0, z0], [3.55, BEAM_Y0, z1], [3.55, BEAM_Y1, z1], [3.55, BEAM_Y1, z0], 1, 0, 0, 1.0, 1.0, 0.9);
  }
  ped_quads = [];
  ([px0, px1] = [(CRY_X - 0.36), (CRY_X + 0.36)]);
  ([py0, py1] = [(-1.2), (-0.66)]);
  ([pz0, pz1] = [(CRY_Z - 0.36), (CRY_Z + 0.36)]);
  for ([v0, v1, v2, v3, nx, ny, nz, sv] of [[[px0, py1, pz0], [px1, py1, pz0], [px1, py1, pz1], [px0, py1, pz1], 0, 1, 0, 0.85], [[px0, py0, pz0], [px1, py0, pz0], [px1, py1, pz0], [px0, py1, pz0], 0, 0, (-1), 0.24], [[px1, py0, pz0], [px1, py0, pz1], [px1, py1, pz1], [px1, py1, pz0], 1, 0, 0, 0.95], [[px0, py0, pz1], [px0, py0, pz0], [px0, py1, pz0], [px0, py1, pz1], (-1), 0, 0, 0.18], [[px1, py0, pz1], [px0, py0, pz1], [px0, py1, pz1], [px1, py1, pz1], 0, 0, 1, 0.85]]) {
    cx = (0.25 * (((v0[0] + v1[0]) + v2[0]) + v3[0]));
    cz = (0.25 * (((v0[2] + v1[2]) + v2[2]) + v3[2]));
    ([rt, gt, bt] = evalLumenHdr(cx, Math.max(v0[1], v2[1]), cz, nx, ny, nz, 0.8, 0.68, 0.54, sv, 0.96));
    ([rb, gb, bb] = evalLumenHdr(cx, Math.min(v0[1], v2[1]), cz, nx, ny, nz, 0.8, 0.68, 0.54, sv, 0.72));
    ped_quads.push([v0, v1, v2, v3, acesRgbTuple(rt, gt, bt), acesRgbTuple(rb, gb, bb), nx, ny, nz]);
  }
  ([cr_r, cr_h] = [0.34, 0.54]);
  top = [CRY_X, (CRY_Y + cr_h), CRY_Z];
  bot = [CRY_X, (CRY_Y - cr_h), CRY_Z];
  ring = range(4).map((i: any) => [(CRY_X + (cr_r * Math.cos(((Math.PI * 0.25) + ((i * Math.PI) * 0.5))))), CRY_Y, (CRY_Z + (cr_r * Math.sin(((Math.PI * 0.25) + ((i * Math.PI) * 0.5)))))]);
  cry_tris = [];
  for (i of range(4)) {
    ([a, b_pt] = [ring[i], ring[pyMod((i + 1), 4)]]);
    e1 = [(b_pt[0] - a[0]), (b_pt[1] - a[1]), (b_pt[2] - a[2])];
    e2 = [(top[0] - a[0]), (top[1] - a[1]), (top[2] - a[2])];
    ([nx, ny, nz] = normalize(((e1[1] * e2[2]) - (e1[2] * e2[1])), ((e1[2] * e2[0]) - (e1[0] * e2[2])), ((e1[0] * e2[1]) - (e1[1] * e2[0]))));
    if (((((nx * (a[0] - CRY_X)) + (ny * 0.5)) + (nz * (a[2] - CRY_Z))) < 0)) {
      ([nx, ny, nz] = [(-nx), (-ny), (-nz)]);
    }
    lit = (0.78 + (0.22 * Math.max(0.0, (((nx * SUN_X) + (ny * SUN_Y)) + (nz * SUN_Z)))));
    cry_tris.push([a, b_pt, top, rgbInt(acesRgbTuple(((0.58 * lit) + 0.35), ((3.2 * lit) + 0.95), ((4.2 * lit) + 1.25)))]);
    e2b = [(bot[0] - a[0]), (bot[1] - a[1]), (bot[2] - a[2])];
    ([nx, ny, nz] = normalize(((e1[1] * e2b[2]) - (e1[2] * e2b[1])), ((e1[2] * e2b[0]) - (e1[0] * e2b[2])), ((e1[0] * e2b[1]) - (e1[1] * e2b[0]))));
    if (((((nx * (a[0] - CRY_X)) - (ny * 0.5)) + (nz * (a[2] - CRY_Z))) < 0)) {
      ([nx, ny, nz] = [(-nx), (-ny), (-nz)]);
    }
    lit = (0.62 + (0.22 * Math.max(0.0, (((nx * SUN_X) + (ny * SUN_Y)) + (nz * SUN_Z)))));
    cry_tris.push([b_pt, a, bot, rgbInt(acesRgbTuple(((0.38 * lit) + 0.22), ((2.5 * lit) + 0.75), ((3.4 * lit) + 1.0)))]);
  }
  return [floor_quads, floor_shadow_layers, wall_shadow_layers, gouraud_arch, ped_quads, cry_tris];
}

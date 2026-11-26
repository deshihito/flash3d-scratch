/**
 * pycompat.ts — Python semantics helpers for the faithful TS port.
 *
 * The Flash engine core and bake pipeline are a line-faithful port of
 * scratch-ue5-pen-research's Python code (see src/bake/temple-bake.ts and
 * src/engine/hybrid-engine.ts). A few Python builtins differ from JS
 * defaults; they are centralized here so the ported code stays literal:
 *
 * - pyRound: Python round() — correctly rounds the *exact* binary value,
 *   with exact ties going to even (JS toFixed rounds ties away from zero).
 * - pyMod: Python % — floored modulo (sign follows the divisor).
 * - range / enumerate / sumArr: Python iteration helpers.
 * - degToRad: math.radians.
 */

export function pyRound(x: number, ndigits: number): number {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const ax = Math.abs(x);
  let result = Number(ax.toFixed(ndigits));
  // Exact-tie detection: the digit after the kept digits is 5 and every
  // following digit of the exact decimal expansion is 0.
  const exp = ax.toFixed(60);
  const dot = exp.indexOf('.');
  const frac = dot >= 0 ? exp.slice(dot + 1).padEnd(60, '0') : ''.padEnd(60, '0');
  const nextDigit = frac[ndigits];
  const rest = frac.slice(ndigits + 1);
  if (nextDigit === '5' && /^0*$/.test(rest)) {
    const lastKept = ndigits > 0 ? frac[ndigits - 1] : exp[dot >= 0 ? dot - 1 : exp.length - 1];
    if (Number(lastKept) % 2 === 0) {
      const step = 10 ** -ndigits;
      result = Number((result - step).toFixed(ndigits));
    }
  }
  return neg ? -result : result;
}

export function pyRound0(x: number): number {
  return pyRound(x, 0);
}

export function pyMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export function range(start: number, stop?: number, step = 1): number[] {
  const lo = stop === undefined ? 0 : start;
  const hi = stop === undefined ? start : stop;
  const out: number[] = [];
  if (step > 0) for (let v = lo; v < hi; v += step) out.push(v);
  else for (let v = lo; v > hi; v += step) out.push(v);
  return out;
}

export function enumerate<T>(arr: readonly T[]): [number, T][] {
  return arr.map((v, i) => [i, v] as [number, T]);
}

export function sumArr(arr: readonly number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

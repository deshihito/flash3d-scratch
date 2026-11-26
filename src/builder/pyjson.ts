/**
 * pyjson.ts — Minimal reproduction of Python's `json.dumps` formatting.
 *
 * The Python original (sb3_builder.py) relies on two json.dumps flavours:
 *  - compact:  json.dumps(proj, separators=(",", ":"))   for project.json
 *  - default:  json.dumps(list_of_strings)               for procedure mutations
 * Both use ensure_ascii=True. Numbers follow Python str()/repr() rules for the
 * ranges this builder produces (integers and short decimals). Integral JS
 * numbers serialize like Python ints; Python floats that happen to be integral
 * (e.g. 32.0) would print as "32.0" in Python — that int/float distinction is
 * not representable in JS and is a documented, accepted divergence (see README).
 */

export function pyJsonString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const ch = s[i];
    switch (ch) {
      case '"': out += '\\"'; continue;
      case '\\': out += '\\\\'; continue;
      case '\n': out += '\\n'; continue;
      case '\r': out += '\\r'; continue;
      case '\t': out += '\\t'; continue;
      case '\b': out += '\\b'; continue;
      case '\f': out += '\\f'; continue;
    }
    if (code < 0x20 || code > 0x7e) {
      out += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      out += ch;
    }
  }
  return out + '"';
}

/** Python str() for a number (used inside Scratch input literals like [4, "1.5"]). */
export function pyNumStr(n: number): string {
  if (Number.isInteger(n)) {
    if (Math.abs(n) < 1e16) return String(n);
    // Python switches to exponent form at 1e16 for floats; ints print in full.
    return String(n);
  }
  return String(n);
}

/** Python repr()-style float string used by json.dumps for non-integral floats. */
function pyFloatJson(n: number): string {
  if (!Number.isFinite(n)) throw new Error('json cannot serialize non-finite number');
  return String(n);
}

export function pyNumberJson(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return pyFloatJson(n);
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }
  | Map<string, JsonValue>;

function stringify(value: JsonValue, itemSep: string, keySep: string): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return pyNumberJson(value);
  if (typeof value === 'string') return pyJsonString(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stringify(v, itemSep, keySep)).join(itemSep) + ']';
  }
  const entries: [string, JsonValue][] =
    value instanceof Map ? [...value.entries()] : Object.entries(value);
  return (
    '{' +
    entries.map(([k, v]) => pyJsonString(k) + keySep + stringify(v, itemSep, keySep)).join(itemSep) +
    '}'
  );
}

/** json.dumps(value, separators=(",", ":")) with ensure_ascii=True. */
export function pyDumpsCompact(value: JsonValue): string {
  return stringify(value, ',', ':');
}

/** json.dumps(value) with default separators (", ", ": ") and ensure_ascii=True. */
export function pyDumpsDefault(value: JsonValue): string {
  return stringify(value, ', ', ': ');
}

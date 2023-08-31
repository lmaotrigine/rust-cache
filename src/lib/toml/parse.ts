import TomlError from './error';
import { extractValue } from './extract';
import { parseKey } from './struct';
import { type Primitive, skipVoid } from './util';

const enum Type { DOTTED, EXPLICIT, ARRAY };

type MetaState = { t: Type, d: boolean, i: number, c: MetaRecord };
type MetaRecord = { [k: string]: MetaState };
type PeekResult = [ string, Record<string, Primitive>, MetaRecord ] | null;

function peekTable(key: string[], table: Record<string, Primitive>, meta: MetaRecord, type: Type): PeekResult {
  let t: any = table;
  let m = meta;
  let k: string;
  let hasOwn = false;
  let state: MetaState;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn! ? t[k!] : (t[k!] = {});
      m = (state = m[k!]!).c;
      if (type === Type.DOTTED && state.t === Type.EXPLICIT) {
        return null;
      }
      if (state.t === Type.ARRAY) {
        const l = t.length - 1;
        t = t[l];
        m = m[l]!.c;
      }
    }
    k = key[i]!;
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === Type.DOTTED && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === '__proto__') {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = { t: i < key.length - 1 && type === Type.ARRAY ? Type.DOTTED : type, d: false, i: 0, c: {} };
    }
  }
  state = m[k!]!;
  if (state.t !== type) {
    return null;
  }
  if (type === Type.ARRAY) {
    if (!state.d) {
      state.d = true;
      t[k!] = [];
    }
    t[k!].push(t = {});
    state.c[state.i++] = (state = { t: Type.EXPLICIT, d: false, i: 0, c: {} });
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === Type.EXPLICIT) {
    t = hasOwn ? t[k!] : (t[k!] = {});
  } else if (type === Type.DOTTED && hasOwn) {
    return null;
  }
  return [ k!, t, state.c ];
}

export function parse(toml: string): Record<string, Primitive> {
  const res = {};
  const meta = {};
  let tbl = res;
  let m = meta;
  for (let ptr = skipVoid(toml, 0); ptr < toml.length;) {
    if (toml[ptr] === '[') {
      const isTableArray = toml[++ptr] === '[';
      const k = parseKey(toml, ptr += +isTableArray, ']');
      if (isTableArray) {
        if (toml[k[1] - 1] !== ']') {
          throw new TomlError('expected end of table declaration', { toml, ptr: k[1] - 1});
        }
        k[1]++;
      }
      const p = peekTable(k[0], res, meta, isTableArray ? Type.ARRAY : Type.EXPLICIT);
      if (!p) {
        throw new TomlError('trying to redefine an existing table or value', { toml, ptr });
      }
      m = p[2];
      tbl = p[1];
      ptr = k[1];
    } else {
      const k = parseKey(toml, ptr);
      const p = peekTable(k[0], tbl, m, Type.DOTTED);
      if (!p) {
        throw new TomlError('trying to redefine an existing table or value', { toml, ptr });
      }
      const v = extractValue(toml, k[1]);
      p[1][p[0]] = v[0];
      ptr = v[1];
    }
    ptr = skipVoid(toml, ptr, true);
    if (toml[ptr] && toml[ptr] !== '\n' && toml[ptr] !== '\r') {
      throw new TomlError('each key-value declaration must be followed by an end-of-line', { toml, ptr });
    }
    ptr = skipVoid(toml, ptr);
  }
  return res;
}

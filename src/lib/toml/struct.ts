import TomlError from './error';
import { extractValue } from './extract';
import { parseString } from './primitive';
import { Primitive, getStringEnd, indexOfNewLine, skipComment, skipVoid } from './util';

const KEY_PART_RE = /^[a-zA-Z0-9_-]+[ \t]*$/;

export function parseKey(str: string, ptr: number, end = '='): [ string[], number ] {
  let dot = ptr - 1;
  const parsed = [];
  let endPtr = str.indexOf(end, ptr);
  if (endPtr < 0) {
    throw new TomlError('incomplete key-value: cannot find end of key', { toml: str, ptr });
  }
  do {
    const c = str[ptr = ++dot];
    if (c !== ' ' && c !== '\t') {
      if (c === '"' || c === "'") {
        if (c === str[ptr + 1] && c === str[ptr + 2]) {
          throw new TomlError('multiline strings are not allowed in keys', { toml: str, ptr });
        }
        const eos = getStringEnd(str, ptr);
        if (eos < 0) {
          throw new TomlError('unterminated string encountered', { toml: str, ptr });
        }
        dot = str.indexOf('.', eos);
        const strEnd = str.slice(eos, dot < 0 || dot > endPtr ? endPtr : dot);
        const newLine = indexOfNewLine(strEnd);
        if (newLine > -1) {
          throw new TomlError('newlines are not allowed in keys', { toml: str, ptr: ptr + dot + newLine });
        }
        if (strEnd.trimStart()) {
          throw new TomlError('found extra tokens after the string part', { toml: str, ptr: eos });
        }
        if (endPtr < eos) {
          endPtr = str.indexOf(end, eos);
          if (endPtr < 0) {
            throw new TomlError('incomplete key-value: cannot find end of key', { toml: str, ptr });
          }
        }
        parsed.push(parseString(str, ptr, eos));
      } else {
        dot = str.indexOf('.', ptr);
        const part = str.slice(ptr, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError('only letters, numbers, dashes, and underscores are allowed in keys', { toml: str, ptr });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  return [ parsed, skipVoid(str, endPtr + 1, true, true) ];
}

export function parseInlineTable(str: string, ptr: number): [ Record<string, Primitive>, number ] {
  const res: Record<string, Primitive> = {};
  const seen = new Set();
  let c: string;
  let comma = 0;
  ptr++;
  while ((c = str[ptr++]!) !== '}' && c) {
    if (c === '\n') {
      throw new TomlError('newlines are not allowed in inline tables', { toml: str, ptr: ptr - 1 });
    } else if (c === '#') {
      throw new TomlError('inline tables cannot contain comments', { toml: str, ptr: ptr - 1 });
    } else if (c === ',') {
      throw new TomlError('expected key-value, found comma', { toml: str, ptr: ptr - 1});
    } else if (c !== ' ' && c !== '\t') {
      let k: string;
      let t: any = res;
      let hasOwn = false;
      const [ key, keyEndPtr ] = parseKey(str, ptr - 1);
      for (let i = 0; i < key.length; i++) {
        if (i) t = hasOwn! ? t[k!] : (t[k!] = {});
        k = key[i]!;
        if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k]! !== 'object' || seen.has(t[k]))) {
          throw new TomlError('trying to redefine an already defined value', { toml: str, ptr });
        }
        if (!hasOwn && k === '__proto__') {
          Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        }
      }
      if (hasOwn) {
        throw new TomlError('trying to redefine an already defined value', { toml: str, ptr });
      }
      const [ value, valueEndPtr ] = extractValue(str, keyEndPtr, '}');
      seen.add(value);
      t[k!] = value;
      ptr = valueEndPtr;
      comma = str[ptr - 1] === ',' ? ptr - 1 : 0;
    }
  }
  if (comma) {
    throw new TomlError('trailing commas are not allowed in inline tables', { toml: str, ptr: comma });
  }
  if (!c) {
    throw new TomlError('unterminated table declaration', { toml: str, ptr });
  }
  return [ res, ptr ];
}

export function parseArray(str: string, ptr: number): [ Primitive[], number ] {
  const res: Primitive[] = [];
  let c;
  ptr++;
  while ((c = str[ptr++]) !== ']' && c) {
    if (c === ',') {
      throw new TomlError('expected value, found comma', { toml: str, ptr: ptr - 1 });
    } else if (c === '#') ptr = skipComment(str, ptr);
    else if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
      const e = extractValue(str, ptr - 1, ']');
      res.push(e[0]);
      ptr = e[1];
    }
  }
  if (!c) {
    throw new TomlError('unterminated array declaration', { toml: str, ptr });
  }
  return [ res, ptr ];
}

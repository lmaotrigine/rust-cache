import TomlDate from './date';
import TomlError from './error';
import { skipVoid } from './util';

const INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
const FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
const LEADING_ZERO = /^[+-]?0[0-9_]/;
const ESCAPE_REGEX = /^[0-9a-fA-F]{4,8}$/i;

const ESC_MAP = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  '"': '"',
  '\\': '\\',
}

export function parseString(str: string, ptr = 0, endPtr = str.length): string {
  const isLiteral = str[ptr] === "'";
  const isMultiline = str[ptr++] === str[ptr] && str[ptr] === str[ptr + 1];
  if (isMultiline) {
    endPtr -= 2;
    if (str[ptr += 2] === '\r') ptr++;
    if (str[ptr] === '\n') ptr++;
  }
  let tmp = 0;
  let isEscape;
  let parsed = '';
  let sliceStart = ptr;
  while (ptr < endPtr - 1) {
    const c = str[ptr++]!;
    if (c === '\n' || (c === '\r' && str[ptr] === '\n')) {
      if (!isMultiline) {
        throw new TomlError('newlines are not allowed in strings', { toml: str, ptr: ptr - 1 });
      }
    } else if (( c < '\x20' && c !== '\t') || c === '\x7f') {
      throw new TomlError('control characters are not allowed in strings', { toml: str, ptr: ptr - 1 });
    }
    if (isEscape) {
      isEscape = false;
      if (c === 'u' || c === 'U') {
        const code = str.slice(ptr, (ptr += (c === 'u' ? 4 : 8)));
        if (!ESCAPE_REGEX.test(code)) {
          throw new TomlError('invalid escape sequence', { toml: str, ptr: tmp });
        }
        try {
          parsed += String.fromCodePoint(parseInt(code, 16));
        } catch {
          throw new TomlError('invalid unicode escape', { toml: str, ptr: tmp });
        }
      } else if (isMultiline && (c === '\n' || c === ' ' || c === '\t' || c === '\r')) {
        ptr = skipVoid(str, ptr - 1, true);
        if (str[ptr] !== '\n' && str[ptr] !== '\r') {
          throw new TomlError('invalid escape: only line-ending whitespace may be escaped', { toml: str, ptr: tmp });
        }
        ptr = skipVoid(str, ptr);
      } else if (c in ESC_MAP) {
        parsed += ESC_MAP[c as keyof typeof ESC_MAP];
      } else {
        throw new TomlError('unrecognised escape sequence', { toml: str, ptr: tmp });
      }
      sliceStart = ptr;
    } else if (!isLiteral && c === '\\') {
      tmp = ptr - 1;
      isEscape = true;
      parsed += str.slice(sliceStart, tmp);
    }
  }
  return parsed + str.slice(sliceStart, endPtr - 1);
}

export function parseValue(value: string, toml: string, ptr: number): boolean | number | TomlDate {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === '-inf') return -Infinity;
  if (value === 'inf' || value === '+inf') return Infinity;
  if (value === 'nan' || value === '+nan' || value === '-nan') return NaN;
  if (value === '-0') return 0;
  let isInt;
  if ((isInt = INT_REGEX.test(value)) || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError('leading zeroes are not allowed', { toml, ptr });
    }
    const numeric = +(value.replace(/_/g, ''));
    if (isNaN(numeric)) {
      throw new TomlError('invalid number', { toml, ptr });
    }
    if (isInt && !Number.isSafeInteger(numeric)) {
      throw new TomlError('integer value cannot be represented losslessly', { toml, ptr });
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid()) {
    throw new TomlError('invalid value', { toml, ptr });
  }
  return date;
}

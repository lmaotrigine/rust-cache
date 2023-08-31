import TomlDate from './date';
import TomlError from './error';

export type Primitive = string | number | boolean | TomlDate | { [key: string]: Primitive } | Primitive[]

export function indexOfNewLine(str: string, start = 0, end = str.length): number {
  let idx = str.indexOf('\n', start);
  if (str[idx - 1] === '\r') idx--;
  return idx <= end ? idx : -1;
}

export function skipComment(str: string, ptr: number): number {
  for (let i = ptr; i < str.length; i++) {
    const c = str[i]!;
    if (c === '\n') return i;
    if (c === '\r' && str[i + 1] === '\n') return i + 1;
    if ((c < '\x20' && c !== '\t') || c === '\x7f') {
      throw new TomlError('control characters are not allowed in comments.', {toml: str, ptr});
    }
  }
  return str.length;
}

export function skipVoid(str: string, ptr: number, banNewLines?: boolean, banComments?: boolean): number {
  let c;
  while ((c = str[ptr]) === ' ' || c === '\t' || (!banNewLines && (c === '\n' || c === '\r' && str[ptr + 1] === '\n'))) ptr++;
  return banComments || c !== '#' ? ptr : skipVoid(str, skipComment(str, ptr), banNewLines);
}

export function skipUntil(str: string, ptr: number, sep: string, end?: string): number {
  if (!end) {
    ptr = indexOfNewLine(str, ptr);
    return ptr < 0 ? str.length : ptr;
  }
  for (let i = ptr; i < str.length; i++) {
    const c = str[i];
    if (c === '#') {
      i = indexOfNewLine(str, i);
    } else if (c === sep) {
      return i + 1;
    } else if (c === end) {
      return i;
    }
  }
  throw new TomlError('cannot find end of structure', { toml: str, ptr });
}

export function getStringEnd(str: string, seek: number): number {
  const first = str[seek]!;
  const target = first === str[seek + 1] && str[seek + 1] === str[seek + 2] ? str.slice(seek, seek + 3) : first;
  seek += target.length - 1;
  do seek = str.indexOf(target, ++seek);
  while (seek > -1 && first !== "'" && str[seek - 1] === '\\' && str[seek - 2] !== '\\');
  if (seek > -1) {
    seek += target.length;
    if (target.length > 1) {
      if (str[seek] === first) seek++;
      if (str[seek] === first) seek++;
    }
  }
  return seek;
}

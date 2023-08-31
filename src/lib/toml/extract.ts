import TomlError from './error';
import { parseString, parseValue } from './primitive';
import { parseArray, parseInlineTable } from './struct';
import { Primitive, getStringEnd, indexOfNewLine, skipComment, skipUntil, skipVoid } from './util';

function sliceAndTrimEndOf(str: string, startPtr: number, endPtr: number, allowNewLines?: boolean): [string, number] {
  let value = str.slice(startPtr, endPtr);
  const commentIdx = value.indexOf('#');
  if (commentIdx > -1) {
    skipComment(str, commentIdx);
    value = value.slice(0, commentIdx);
  }
  const trimmed = value.trimEnd();
  if (!allowNewLines) {
    const newlineIdx = value.indexOf('\n', trimmed.length);
    if (newlineIdx > -1) {
      throw new TomlError('newlines are not allowed in inline tables', { toml: str, ptr: startPtr + newlineIdx });
    }
  }
  return [trimmed, commentIdx];
}

export function extractValue(str: string, ptr: number, end?: string): [Primitive, number] {
  const c = str[ptr];
  if (c === '[' || c === '{') {
    const [ value, endPtr ] = c === '[' ? parseArray(str, ptr) : parseInlineTable(str, ptr);
    const newPtr = skipUntil(str, endPtr, ',', end);
    if (end === '}') {
      const nextNewLine = indexOfNewLine(str, endPtr, newPtr);
      if (nextNewLine > -1) {
        throw new TomlError('newlines are not allowed in inline tables', {toml: str, ptr: nextNewLine});
      }
    }
    return [value, newPtr];
  }
  let endPtr;
  if (c === '"' || c === "'") {
    endPtr = getStringEnd(str, ptr);
    return [parseString(str, ptr, endPtr), endPtr + +(!!end && str[endPtr] === ',')];
  }
  endPtr = skipUntil(str, ptr, ',', end);
  const slice = sliceAndTrimEndOf(str, ptr, endPtr - (+(str[endPtr - 1] === ',')), end === ']');
  if (!slice[0]) {
    throw new TomlError('incomplete key-value declaration: no value specified', { toml: str, ptr });
  }
  if (end && slice[1] > -1) {
    endPtr = skipVoid(str, ptr + slice[1]);
    endPtr += +(str[endPtr] === ',');
  }
  return [parseValue(slice[0], str, ptr), endPtr];
}

type TomlErrorOptions = ErrorOptions & {
  toml: string;
  ptr: number;
}

function getLineColFromPtr(string: string, ptr: number): [number, number] {
  const lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop()!.length + 1];
}

function makeCodeBlock(string: string, line: number, column: number): string {
  const lines = string.split(/\r\n|\n|\r/g);
  let codeblock = '';
  const numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    const l = lines[i - 1];
    if (!l) continue;
    codeblock += i.toString().padEnd(numberLen, ' ');
    codeblock += ':  ';
    codeblock += l;
    codeblock += '\n';
    if (i === line) {
      codeblock += ' '.repeat(numberLen + column + 2);
      codeblock += '^\n';
    }
  }
  return codeblock;
}

export default class TomlError extends Error {
  line: number;
  column: number;
  codeblock: string;
  constructor(message: string, options: TomlErrorOptions) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}\n\n${codeblock}`, options);
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
}

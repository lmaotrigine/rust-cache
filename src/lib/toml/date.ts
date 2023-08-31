type Offset = string | null;

const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/i;

export default class TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset: Offset = null;

  constructor(date: string | Date) {
    let hasDate = true;
    let hasTime = true;
    let offset: Offset = 'Z';
    if (typeof date === 'string') {
      const match = date.match(DATE_TIME_RE);
      if (match) {
        if (!match[1]) {
          hasDate = false;
          date = `0000-01-01T${date}`;
        }
        hasTime = !!match[2];
        if (match[2] && +match[2] > 23) {
          date = ''
        } else {
          offset = match[3] || null;
          date = date.toUpperCase();
          if (!offset) date += 'Z';
        }
      } else {
        date = '';
      }
    }
    super(date);
    if (!isNaN(this.getTime())) {
      this.#hasDate = hasDate;
      this.#hasTime = hasTime;
      this.#offset = offset;
    }
  }

  isDateTime(): boolean {
    return this.#hasDate && this.#hasTime;
  }

  isLocal(): boolean {
    return !this.#hasDate || !this.#hasTime || !this.#offset;
  }

  isDate(): boolean {
    return this.#hasDate && !this.#hasTime;
  }

  isTime(): boolean {
    return this.#hasTime && !this.#hasDate;
  }

  isValid(): boolean {
    return this.#hasDate || this.#hasTime;
  }

  override toISOString(): string {
    const iso = super.toISOString();
    if (this.isDate()) return iso.slice(0, 10);
    if (this.isTime()) return iso.slice(11, 23);
    if (this.#offset === null) return iso.slice(0, -1);
    if (this.#offset === 'Z') return iso;
    let offset = (+(this.#offset.slice(1, 3)) * 60) + +(this.#offset.slice(4, 6));
    offset = this.#offset[0] === '-' ? offset : -offset;
    const offsetDate = new Date(this.getTime() - (offset * 60e3));
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }

  static wrapAsOffsetDateTime(jsDate: Date, offset = 'Z'): TomlDate {
    const date = new TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }

  static wrapAsLocalDateTime(jsDate: Date): TomlDate {
    const date = new TomlDate(jsDate);
    date.#offset = null;
    return date;
  }

  static wrapAsLocalDate(jsDate: Date): TomlDate {
    const date = new TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }

  static wrapAsLocalTime(jsDate: Date): TomlDate {
    const date = new TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
}

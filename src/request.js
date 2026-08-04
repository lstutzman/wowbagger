import { TextDecoder } from 'node:util';

const UTF8 = new TextDecoder('utf-8', { fatal: true });

export function parseJsonRequest(bytes) {
  let source;
  try {
    source = UTF8.decode(bytes);
  } catch {
    return invalidJson('invalid-utf8');
  }

  try {
    const parser = new JsonParser(source);
    const value = parser.parse();
    return { value, issues: parser.issues };
  } catch {
    return invalidJson();
  }
}

export function pointer(parts) {
  return parts.length === 0 ? '' : `/${parts.map(escapePointerPart).join('/')}`;
}

export function sortIssues(issues) {
  return [...issues].sort((left, right) => compareText(left.path, right.path)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message));
}

export class JsonNumber {
  constructor(source) {
    this.source = source;
  }
}

function invalidJson(inputDiagnostic = null) {
  return {
    value: null,
    inputDiagnostic,
    issues: [{
      path: '',
      code: 'invalid-json',
      message: 'Request input must be valid JSON.',
    }],
  };
}

class JsonParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
    this.issues = [];
  }

  parse() {
    this.skipWhitespace();
    const value = this.value([]);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new Error('trailing JSON input');
    }
    return value;
  }

  value(location) {
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === '{') {
      return this.object(location);
    }
    if (character === '[') {
      return this.array(location);
    }
    if (character === '"') {
      return this.string();
    }
    if (this.source.startsWith('true', this.index)) {
      this.index += 4;
      return true;
    }
    if (this.source.startsWith('false', this.index)) {
      this.index += 5;
      return false;
    }
    if (this.source.startsWith('null', this.index)) {
      this.index += 4;
      return null;
    }
    return this.number();
  }

  object(location) {
    this.expect('{');
    this.skipWhitespace();
    const object = Object.create(null);
    const seen = new Set();
    if (this.consume('}')) {
      return object;
    }

    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') {
        throw new Error('object key is not a string');
      }
      const key = this.string();
      this.skipWhitespace();
      this.expect(':');
      const childLocation = [...location, key];
      const value = this.value(childLocation);
      if (seen.has(key)) {
        this.issues.push({
          path: pointer(childLocation),
          code: 'duplicate-key',
          message: `JSON member ${key} must not be repeated.`,
        });
      } else {
        seen.add(key);
        object[key] = value;
      }
      this.skipWhitespace();
      if (this.consume('}')) {
        return object;
      }
      this.expect(',');
    }
  }

  array(location) {
    this.expect('[');
    this.skipWhitespace();
    const values = [];
    if (this.consume(']')) {
      return values;
    }
    while (true) {
      values.push(this.value([...location, String(values.length)]));
      this.skipWhitespace();
      if (this.consume(']')) {
        return values;
      }
      this.expect(',');
    }
  }

  string() {
    const start = this.index;
    this.expect('"');
    let escaped = false;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      this.index += 1;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') {
        return JSON.parse(this.source.slice(start, this.index));
      }
      if (character.charCodeAt(0) < 0x20) {
        throw new Error('unescaped control character');
      }
    }
    throw new Error('unterminated JSON string');
  }

  number() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.index));
    if (!match) {
      throw new Error('invalid JSON value');
    }
    this.index += match[0].length;
    return new JsonNumber(match[0]);
  }

  skipWhitespace() {
    while (this.index < this.source.length && /[\u0009\u000a\u000d\u0020]/.test(this.source[this.index])) {
      this.index += 1;
    }
  }

  consume(character) {
    if (this.source[this.index] !== character) {
      return false;
    }
    this.index += 1;
    return true;
  }

  expect(character) {
    if (!this.consume(character)) {
      throw new Error(`expected ${character}`);
    }
  }
}

function escapePointerPart(part) {
  return part.replaceAll('~', '~0').replaceAll('/', '~1');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

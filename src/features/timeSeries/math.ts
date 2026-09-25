/** Variables an expression may read. x is the signal's own raw field; the others name other
 * configured signals' raw fields through the ids below. */
export const INPUT_VARIABLES = ['y', 'z', 'w'] as const;
export type InputVariable = (typeof INPUT_VARIABLES)[number];
export const INPUT_ID_KEYS = { y: 'secondaryId', z: 'tertiaryId', w: 'quaternaryId' } as const satisfies Record<InputVariable, keyof MathConfig>;

export interface MathConfig {
  expression: string;
  /** Signal read as y. */
  secondaryId: string;
  /** Signal read as z. */
  tertiaryId: string;
  /** Signal read as w. */
  quaternaryId: string;
  scale: number;
  offset: number;
  operation: 'identity' | 'normalize' | 'derivative' | 'integral';
  normalizeMin: number;
  normalizeMax: number;
}

export const sanitizeMath = (value: unknown): MathConfig => {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<MathConfig>;
  const finite = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);
  return {
    expression: typeof v.expression === 'string' ? v.expression.slice(0, 256) : 'x',
    secondaryId: typeof v.secondaryId === 'string' ? v.secondaryId : '',
    tertiaryId: typeof v.tertiaryId === 'string' ? v.tertiaryId : '',
    quaternaryId: typeof v.quaternaryId === 'string' ? v.quaternaryId : '',
    scale: finite(v.scale, 1),
    offset: finite(v.offset, 0),
    operation: ['normalize', 'derivative', 'integral'].includes(v.operation ?? '') ? v.operation! : 'identity',
    normalizeMin: finite(v.normalizeMin, 0),
    normalizeMax: finite(v.normalizeMax, 1),
  };
};

type Expression = (x: number, y: number, z: number, w: number) => number;
const functions: Record<string, { arity: [number, number]; run: (...values: number[]) => number }> = {
  abs: { arity: [1, 1], run: Math.abs },
  sqrt: { arity: [1, 1], run: Math.sqrt },
  sin: { arity: [1, 1], run: Math.sin },
  cos: { arity: [1, 1], run: Math.cos },
  tan: { arity: [1, 1], run: Math.tan },
  asin: { arity: [1, 1], run: Math.asin },
  acos: { arity: [1, 1], run: Math.acos },
  atan: { arity: [1, 1], run: Math.atan },
  atan2: { arity: [2, 2], run: Math.atan2 },
  exp: { arity: [1, 1], run: Math.exp },
  log: { arity: [1, 1], run: Math.log },
  log10: { arity: [1, 1], run: Math.log10 },
  sign: { arity: [1, 1], run: Math.sign },
  floor: { arity: [1, 1], run: Math.floor },
  ceil: { arity: [1, 1], run: Math.ceil },
  round: { arity: [1, 1], run: Math.round },
  pow: { arity: [2, 2], run: Math.pow },
  hypot: { arity: [2, 4], run: Math.hypot },
  min: { arity: [2, 4], run: Math.min },
  max: { arity: [2, 4], run: Math.max },
  clamp: { arity: [3, 3], run: (value, low, high) => Math.min(high, Math.max(low, value)) },
  deg: { arity: [1, 1], run: radians => (radians * 180) / Math.PI },
  rad: { arity: [1, 1], run: degrees => (degrees * Math.PI) / 180 },
};
const constants: Record<string, number> = { pi: Math.PI, e: Math.E };
const variables: Record<string, Expression> = { x: x => x, y: (_x, y) => y, z: (_x, _y, z) => z, w: (_x, _y, _z, w) => w };

export const EXPRESSION_HELP =
  'Use numbers, x, y, z, w, pi, e, + - * / ^, parentheses and ' + Object.keys(functions).join(', ') + '.';

/** Bounded arithmetic parser. Never evaluates JavaScript or accesses objects. */
export function compileExpression(source: string): {
  evaluate: (x: number, y?: number, z?: number, w?: number) => number;
  /** The input variables (y, z, w) the expression reads, each needing a configured signal. */
  inputs: InputVariable[];
  usesY: boolean;
} {
  if (!source.trim() || source.length > 256) throw new Error('Enter an expression of 1–256 characters.');
  const tokens = source.match(/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[a-zA-Z_][a-zA-Z_0-9]*|[^\s]/g) ?? [];
  let pos = 0;
  const used = new Set<InputVariable>();
  const take = () => tokens[pos++];
  const expect = (token: string) => {
    if (take() !== token) throw new Error(`Expected ${token}.`);
  };
  const own = (table: object, key: string | undefined) => key !== undefined && Object.prototype.hasOwnProperty.call(table, key);
  const atom = (): Expression => {
    const token = take();
    if (token === '(') {
      const inner = expression();
      expect(')');
      return inner;
    }
    if (own(variables, token)) {
      if (token !== 'x') used.add(token as InputVariable);
      return variables[token];
    }
    if (own(constants, token)) {
      const value = constants[token];
      return () => value;
    }
    if (token && /^(?:\d|\.)/.test(token) && Number.isFinite(Number(token))) return () => Number(token);
    if (own(functions, token)) {
      const fn = functions[token];
      expect('(');
      const args = [expression()];
      while (tokens[pos] === ',') {
        take();
        args.push(expression());
      }
      expect(')');
      const [least, most] = fn.arity;
      if (args.length < least || args.length > most) {
        throw new Error(`${token} needs ${least === most ? least : `${least}–${most}`} argument(s).`);
      }
      return (x, y, z, w) => fn.run(...args.map(arg => arg(x, y, z, w)));
    }
    throw new Error(token === undefined ? `The expression ends too early. ${EXPRESSION_HELP}` : `Unexpected "${token}". ${EXPRESSION_HELP}`);
  };
  const power = (): Expression => {
    const left = atom();
    if (tokens[pos] !== '^') return left;
    take();
    const right = unary();
    return (x, y, z, w) => left(x, y, z, w) ** right(x, y, z, w);
  };
  const unary = (): Expression => {
    if (tokens[pos] === '+' || tokens[pos] === '-') {
      const token = take(),
        inner = unary();
      return (x, y, z, w) => (token === '-' ? -1 : 1) * inner(x, y, z, w);
    }
    return power();
  };
  const product = (): Expression => {
    let left = unary();
    while (tokens[pos] === '*' || tokens[pos] === '/') {
      const op = take(),
        a = left,
        b = unary();
      left = (x, y, z, w) => (op === '*' ? a(x, y, z, w) * b(x, y, z, w) : a(x, y, z, w) / b(x, y, z, w));
    }
    return left;
  };
  const expression = (): Expression => {
    let left = product();
    while (tokens[pos] === '+' || tokens[pos] === '-') {
      const op = take(),
        a = left,
        b = product();
      left = (x, y, z, w) => (op === '+' ? a(x, y, z, w) + b(x, y, z, w) : a(x, y, z, w) - b(x, y, z, w));
    }
    return left;
  };
  const compiled = expression();
  if (pos !== tokens.length) throw new Error('Unexpected expression token.');
  const inputs = INPUT_VARIABLES.filter(name => used.has(name));
  return { evaluate: (x, y = 0, z = 0, w = 0) => compiled(x, y, z, w), inputs, usesY: used.has('y') };
}

export class SignalMath {
  readonly expression;
  private previous: { time: number; value: number } | null = null;
  private integral = 0;
  constructor(readonly config: MathConfig) {
    this.expression = compileExpression(config.expression);
    if (config.operation === 'normalize' && config.normalizeMax <= config.normalizeMin) {
      throw new Error('Normalization maximum must exceed minimum.');
    }
  }
  next(x: number, y: number, time: number, z = 0, w = 0): number | null {
    const value = this.expression.evaluate(x, y, z, w) * this.config.scale + this.config.offset;
    if (!Number.isFinite(value)) {
      this.previous = null;
      return null;
    }
    const previous = this.previous;
    const dt = previous ? (time - previous.time) / 1000 : 0;
    if (previous && dt <= 0 && (this.config.operation === 'derivative' || this.config.operation === 'integral'))
      return null;
    this.previous = { time, value };
    let result = value;
    switch (this.config.operation) {
      case 'normalize':
        result = (value - this.config.normalizeMin) / (this.config.normalizeMax - this.config.normalizeMin);
        break;
      case 'derivative':
        if (!previous) return null;
        result = (value - previous.value) / dt;
        break;
      case 'integral':
        if (previous) this.integral += (previous.value + value) * 0.5 * dt;
        result = this.integral;
        break;
    }
    return Number.isFinite(result) ? result : null;
  }
}

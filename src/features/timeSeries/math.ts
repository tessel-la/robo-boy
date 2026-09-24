export interface MathConfig {
  expression: string;
  secondaryId: string;
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
    scale: finite(v.scale, 1),
    offset: finite(v.offset, 0),
    operation: ['normalize', 'derivative', 'integral'].includes(v.operation ?? '') ? v.operation! : 'identity',
    normalizeMin: finite(v.normalizeMin, 0),
    normalizeMax: finite(v.normalizeMax, 1),
  };
};

type Expression = (x: number, y: number) => number;
const functions: Record<string, { arity: number; run: (...values: number[]) => number }> = {
  abs: { arity: 1, run: Math.abs },
  sqrt: { arity: 1, run: Math.sqrt },
  sin: { arity: 1, run: Math.sin },
  cos: { arity: 1, run: Math.cos },
  min: { arity: 2, run: Math.min },
  max: { arity: 2, run: Math.max },
};

/** Bounded arithmetic parser. Never evaluates JavaScript or accesses objects. */
export function compileExpression(source: string): { evaluate: Expression; usesY: boolean } {
  if (!source.trim() || source.length > 256) throw new Error('Enter an expression of 1–256 characters.');
  const tokens = source.match(/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[a-zA-Z_]+|[^\s]/g) ?? [];
  let pos = 0;
  let usesY = false;
  const take = () => tokens[pos++];
  const expect = (token: string) => {
    if (take() !== token) throw new Error(`Expected ${token}.`);
  };
  const atom = (): Expression => {
    const token = take();
    if (token === '(') {
      const inner = expression();
      expect(')');
      return inner;
    }
    if (token === 'x') return x => x;
    if (token === 'y') {
      usesY = true;
      return (_x, y) => y;
    }
    if (token && /^(?:\d|\.)/.test(token) && Number.isFinite(Number(token))) return () => Number(token);
    const fn = Object.prototype.hasOwnProperty.call(functions, token) ? functions[token] : undefined;
    if (fn) {
      expect('(');
      const args = [expression()];
      while (tokens[pos] === ',') {
        take();
        args.push(expression());
      }
      expect(')');
      if (args.length !== fn.arity) throw new Error(`${token} needs ${fn.arity} argument(s).`);
      return (x, y) => fn.run(...args.map(arg => arg(x, y)));
    }
    throw new Error('Use numbers, x, y, + − * / ^, parentheses, abs, sqrt, sin, cos, min or max.');
  };
  const power = (): Expression => {
    const left = atom();
    if (tokens[pos] !== '^') return left;
    take();
    const right = unary();
    return (x, y) => left(x, y) ** right(x, y);
  };
  const unary = (): Expression => {
    if (tokens[pos] === '+' || tokens[pos] === '-') {
      const token = take(),
        inner = unary();
      return (x, y) => (token === '-' ? -1 : 1) * inner(x, y);
    }
    return power();
  };
  const product = (): Expression => {
    let left = unary();
    while (tokens[pos] === '*' || tokens[pos] === '/') {
      const op = take(),
        a = left,
        b = unary();
      left = (x, y) => (op === '*' ? a(x, y) * b(x, y) : a(x, y) / b(x, y));
    }
    return left;
  };
  const expression = (): Expression => {
    let left = product();
    while (tokens[pos] === '+' || tokens[pos] === '-') {
      const op = take(),
        a = left,
        b = product();
      left = (x, y) => (op === '+' ? a(x, y) + b(x, y) : a(x, y) - b(x, y));
    }
    return left;
  };
  const evaluate = expression();
  if (pos !== tokens.length) throw new Error('Unexpected expression token.');
  return { evaluate, usesY };
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
  next(x: number, y: number, time: number): number | null {
    const value = this.expression.evaluate(x, y) * this.config.scale + this.config.offset;
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

const TARGET_RANGE_INTERVALS = 1000;
const MAX_DECIMAL_PLACES = 12;

export function getDynamicRangeStep(min: number, max: number, integerValues = false): number {
  if (integerValues) return 1;

  const span = Math.abs(max - min);
  if (!Number.isFinite(span) || span === 0) return 0.001;

  const rawStep = span / TARGET_RANGE_INTERVALS;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const factor = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;

  return Number((factor * magnitude).toPrecision(12));
}

export function getStepPrecision(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;

  const [coefficient, exponentText] = step.toString().toLowerCase().split('e');
  const coefficientDecimals = coefficient.includes('.')
    ? coefficient.split('.')[1].length
    : 0;
  const exponent = exponentText ? Number.parseInt(exponentText, 10) : 0;

  return Math.min(MAX_DECIMAL_PLACES, Math.max(0, coefficientDecimals - exponent));
}

export function roundToStepPrecision(value: number, step: number): number {
  return Number(value.toFixed(getStepPrecision(step)));
}

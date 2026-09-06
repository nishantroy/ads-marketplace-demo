/**
 * All monetary amounts are integer microdollars: 1 USD = 1_000_000 micros.
 * Targets and probabilities may be fractional; actual charges and budgets are integers.
 */
export type Micros = number;

export const MICROS_PER_DOLLAR = 1_000_000;

/** Upper bound on any single amount or total so that sums stay well inside Number.MAX_SAFE_INTEGER. */
export const MAX_MONEY_MICROS = 1_000_000_000_000_000; // $1e9

export function isValidMicros(value: unknown): value is Micros {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_MONEY_MICROS
  );
}

export function assertMicros(value: unknown, label: string): Micros {
  if (!isValidMicros(value)) {
    throw new RangeError(`${label} must be an integer in [0, ${MAX_MONEY_MICROS}] micros; got ${String(value)}`);
  }
  return value;
}

export function dollars(amount: number): Micros {
  return Math.round(amount * MICROS_PER_DOLLAR);
}

export function formatMicros(value: Micros, fractionDigits = 2): string {
  return `$${(value / MICROS_PER_DOLLAR).toFixed(fractionDigits)}`;
}

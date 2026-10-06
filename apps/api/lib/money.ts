/**
 * Money & Currency Utilities (Fees System v4)
 *
 * Ground rules:
 * - Integer minor units only (no floats for money amounts).
 * - BigInt arithmetic inside conversions.
 * - Strict half-up rounding.
 * - Dual-currency formatting everywhere.
 */

export interface CurrencyConfig {
  code: string;
  minor_unit_exponent: number;
  fx_rounding_increment_minor: number;
  instalment_rounding_minor: number;
}

export class CurrencyMismatchError extends Error {
  constructor(c1: string, c2: string) {
    super(`Cannot perform arithmetic on mixed currencies: ${c1} and ${c2}`);
    this.name = 'CurrencyMismatchError';
  }
}

/**
 * Convert base currency minor units (e.g. USD cents) to quote currency minor units (e.g. KES cents).
 * rateMicros: exchange rate scaled by 1,000,000 (e.g., 130.00 = 130000000).
 * roundingIncrement: minor units rounding step (e.g. 1000 = round to nearest 10 shillings).
 */
export function convertMinor(
  baseMinor: number | bigint,
  rateMicros: number | bigint,
  roundingIncrement = 1
): number {
  const b = BigInt(baseMinor);
  const r = BigInt(rateMicros);
  const inc = BigInt(Math.max(1, roundingIncrement));

  // rawQuote = b * r / 1_000_000n
  // For round half-up: (2 * b * r + 1_000_000n) / (2 * 1_000_000n)
  const product = b * r;
  const rawQuote = (product * 2n + 1000000n) / 2000000n;

  if (inc === 1n) {
    return Number(rawQuote);
  }

  // Round half-up to nearest increment: (2 * rawQuote + inc) / (2 * inc) * inc
  const rounded = ((rawQuote * 2n + inc) / (2n * inc)) * inc;
  return Number(rounded);
}

/**
 * Split a total into `count` instalments.
 * Each instalment except the last is rounded to `roundingIncrement`.
 * The remainder is placed on the last instalment so the sum is exact.
 */
export function splitInstalments(
  totalMinor: number,
  count: number,
  roundingIncrement = 1
): number[] {
  if (count <= 1) return [totalMinor];
  const total = BigInt(totalMinor);
  const cnt = BigInt(count);
  const inc = BigInt(Math.max(1, roundingIncrement));

  // Raw base instalment before rounding
  const rawPer = total / cnt;
  // Round to nearest increment
  const perRounded = inc > 1n
    ? ((rawPer * 2n + inc) / (2n * inc)) * inc
    : rawPer;

  const result: number[] = [];
  let allocated = 0n;

  for (let i = 0; i < count - 1; i++) {
    result.push(Number(perRounded));
    allocated += perRounded;
  }

  // Remainder on the final instalment
  const last = total - allocated;
  result.push(Number(last));
  return result;
}

/**
 * Format minor units into human-readable currency string.
 * Example: formatMajor(25000, 'USD', 2) => "USD 250.00"
 */
export function formatMajor(amountMinor: number, currency: string, exponent = 2): string {
  const isNegative = amountMinor < 0;
  const absMinor = Math.abs(amountMinor);
  const divisor = Math.pow(10, exponent);
  const major = absMinor / divisor;

  const formatted = major.toLocaleString('en-US', {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });

  return `${isNegative ? '-' : ''}${currency} ${formatted}`;
}

/**
 * Format dual currency representation: USD base alongside quote currency.
 * Example: formatDual(25000, 3250000) => "USD 250.00 | KES 32,500.00"
 */
export function formatDual(
  baseMinor: number,
  quoteMinor?: number,
  quoteCurrency = 'KES',
  rateMicros?: number,
  quoteRoundingIncrement = 1000
): string {
  const usdText = formatMajor(baseMinor, 'USD', 2);
  let resolvedQuote = quoteMinor;

  if (resolvedQuote === undefined && rateMicros !== undefined) {
    resolvedQuote = convertMinor(baseMinor, rateMicros, quoteRoundingIncrement);
  }

  if (resolvedQuote !== undefined) {
    const quoteText = formatMajor(resolvedQuote, quoteCurrency, 2);
    return `${usdText} | ${quoteText}`;
  }

  return usdText;
}

/**
 * Gateway subunit conversions (e.g. for Paystack).
 * For 2-decimal currencies (KES, USD), 1 minor unit = 1 subunit (1 cent).
 */
export function toGatewaySubunit(amountMinor: number, _currency?: string, _exponent = 2): number {
  return Math.round(amountMinor);
}

export function fromGatewaySubunit(gatewaySubunits: number, _currency?: string, _exponent = 2): number {
  return Math.round(gatewaySubunits);
}

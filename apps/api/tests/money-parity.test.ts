import { describe, it, expect } from 'vitest';
import { convertMinor, splitInstalments, formatDual, toGatewaySubunit, fromGatewaySubunit } from '../lib/money';

describe('Fees System v4: Money, Conversion & Sheet Parity', () => {
  const RATE_130_MICROS = 130000000; // 130.00 KES per USD
  const KES_ROUNDING_10_SHILLINGS = 1000; // 1000 minor units = KES 10.00

  it('Sheet Parity: derived KES prices equal the fee sheet exactly @ rate 130', () => {
    // 1. Certificate: USD 150.00 (15000 minor) -> KES 19,500.00 (1950000 minor)
    const certKes = convertMinor(15000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS);
    expect(certKes).toBe(1950000); // KES 19,500.00

    // 2. Diploma: USD 250.00 (25000 minor) -> KES 32,500.00 (3250000 minor)
    const dipKes = convertMinor(25000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS);
    expect(dipKes).toBe(3250000); // KES 32,500.00

    // 3. Undergraduate: USD 1,000.00 (100000 minor) -> KES 130,000.00 (13000000 minor)
    const ugKes = convertMinor(100000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS);
    expect(ugKes).toBe(13000000); // KES 130,000.00

    // 4. Masters / Graduate: USD 1,500.00 (150000 minor) -> KES 195,000.00 (19500000 minor)
    const gradKes = convertMinor(150000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS);
    expect(gradKes).toBe(19500000); // KES 195,000.00

    // 5. Doctorate / PhD: USD 2,000.00 (200000 minor) -> KES 260,000.00 (26000000 minor)
    const docKes = convertMinor(200000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS);
    expect(docKes).toBe(26000000); // KES 260,000.00

    // 6. Application fee cap: USD 3.85 (385 minor) -> KES 500.00 (50000 minor)
    const appKes = convertMinor(385, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS);
    expect(appKes).toBe(50000); // KES 500.00

    // 7. Registration fee cap (including student ID): USD 19.23 (1923 minor) -> KES 2,500.00 (250000 minor)
    const regKes = convertMinor(1923, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS);
    expect(regKes).toBe(250000); // KES 2,500.00 (Registration 2000 + ID 500)

    // 8. Graduation fee cap: USD 38.46 (3846 minor) -> KES 5,000.00 (500000 minor)
    const gradFeeKes = convertMinor(3846, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS);
    expect(gradFeeKes).toBe(500000); // KES 5,000.00
  });

  it('Standard Prices: converted KES amounts @ rate 130 match expected standard list', () => {
    // Application: USD 50.00 (5000 minor) -> KES 6,500.00
    expect(convertMinor(5000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS)).toBe(650000);

    // Registration (including ID): USD 50.00 (5000 minor) -> KES 6,500.00
    expect(convertMinor(5000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS)).toBe(650000);

    // Graduation: USD 150.00 (15000 minor) -> KES 19,500.00
    expect(convertMinor(15000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS)).toBe(1950000);

    // Thesis: USD 300.00 (30000 minor) -> KES 39,000.00
    expect(convertMinor(30000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS)).toBe(3900000);

    // Dissertation: USD 400.00 (40000 minor) -> KES 52,000.00
    expect(convertMinor(40000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS)).toBe(5200000);

    // Undergraduate Tuition: USD 250 / credit hour -> KES 32,500 / credit hour
    expect(convertMinor(25000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS)).toBe(3250000);

    // Graduate Tuition: USD 350 / credit hour -> KES 45,500 / credit hour
    expect(convertMinor(35000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS)).toBe(4550000);

    // Doctorate Tuition: USD 450 / credit hour -> KES 58,500 / credit hour
    expect(convertMinor(45000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS)).toBe(5850000);

    // Diploma Flat Total: USD 10,000.00 -> KES 1,300,000.00
    expect(convertMinor(1000000, RATE_130_MICROS, KES_ROUNDING_10_SHILLINGS)).toBe(130000000);
  });

  it('Instalment splitting: sums match total exactly across both USD and KES independent splits', () => {
    // Undergraduate USD 1,000 over 12 instalments: 11 x 83.33 + 83.37 = 1,000.00
    const usdParts = splitInstalments(100000, 12, 1);
    expect(usdParts.length).toBe(12);
    expect(usdParts.slice(0, 11).every(p => p === 8333)).toBe(true);
    expect(usdParts[11]).toBe(8337);
    const usdSum = usdParts.reduce((a, b) => a + b, 0);
    expect(usdSum).toBe(100000); // Exact USD 1,000.00

    // Undergraduate KES 130,000 over 12 instalments (rounded to nearest KES 1.00 = 100 minor):
    // 11 x 10,833 + 10,837 = 130,000
    const kesParts = splitInstalments(13000000, 12, 100);
    expect(kesParts.length).toBe(12);
    expect(kesParts.slice(0, 11).every(p => p === 1083300)).toBe(true);
    expect(kesParts[11]).toBe(1083700);
    const kesSum = kesParts.reduce((a, b) => a + b, 0);
    expect(kesSum).toBe(13000000); // Exact KES 130,000.00

    // Diploma USD 10,000 flat over 4 terms: 4 x 2,500.00
    const dipParts = splitInstalments(1000000, 4, 1);
    expect(dipParts).toEqual([250000, 250000, 250000, 250000]);
    expect(dipParts.reduce((a, b) => a + b, 0)).toBe(1000000);
  });

  it('formatDual produces clean side-by-side strings', () => {
    const formatted = formatDual(25000, 3250000, 'KES');
    expect(formatted).toBe('USD 250.00 | KES 32,500.00');

    // Deriving KES automatically from rate
    const autoFormatted = formatDual(25000, undefined, 'KES', RATE_130_MICROS);
    expect(autoFormatted).toBe('USD 250.00 | KES 32,500.00');
  });

  it('Gateway subunit conversions are deterministic', () => {
    expect(toGatewaySubunit(25000, 'KES')).toBe(25000);
    expect(fromGatewaySubunit(25000, 'KES')).toBe(25000);
  });
});

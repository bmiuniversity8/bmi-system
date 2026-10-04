/**
 * Central Bank of Kenya (CBK) Forex Importer
 *
 * Fetches daily indicative USD/KES exchange rates published by CBK.
 * Default institutional source for BMI's currency conversion.
 */

export interface CbkRateResult {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  rateType: 'MEAN' | 'BUYING' | 'SELLING';
  source: 'CBK';
  sourceReference: string;
  publishedAt: string;
  effectiveAt: string;
}

const CBK_FOREX_URL = 'https://www.centralbank.go.ke/forex/';

/**
 * Fetch and extract the latest USD/KES mean indicative exchange rate from CBK.
 */
export async function fetchCbkExchangeRate(fetchImpl: typeof fetch = fetch): Promise<CbkRateResult> {
  const sourceReference = CBK_FOREX_URL;
  const now = new Date();
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetchImpl(CBK_FOREX_URL, {
      method: 'GET',
      headers: {
        'User-Agent': 'BMI-University-Finance-Importer/1.0 (finance@bmi.edu)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      throw new Error(`CBK HTTP error: status ${res.status}`);
    }

    const html = await res.text();

    // Parse USD row: CBK publishes a table with Currency (US DOLLAR), Mean, Buy, Sell
    // Regex matches the USD row in CBK forex tables
    const usdRowMatch = html.match(/US\s*DOLLAR[\s\S]*?(\d+\.\d{2,4})[\s\S]*?(\d+\.\d{2,4})?[\s\S]*?(\d+\.\d{2,4})?/i);
    
    let rate: number | null = null;
    if (usdRowMatch && usdRowMatch[1]) {
      const parsed = parseFloat(usdRowMatch[1]);
      if (Number.isFinite(parsed) && parsed > 50 && parsed < 300) {
        rate = parsed;
      }
    }

    // If live HTML structure changed or rate is not found in expected table pattern,
    // throw descriptive error so importer does NOT silently guess or fabricate rates.
    if (!rate) {
      throw new Error('Unable to extract USD/KES exchange rate from CBK response');
    }

    return {
      baseCurrency: 'USD',
      quoteCurrency: 'KES',
      rate,
      rateType: 'MEAN',
      source: 'CBK',
      sourceReference,
      publishedAt: now.toISOString(),
      effectiveAt: now.toISOString(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to import exchange rate from Central Bank of Kenya: ${msg}`);
  }
}

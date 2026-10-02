/**
 * Versioned enrollment agreement — single source of truth for the document
 * students sign at registration. Previously the document id and version hash
 * were hardcoded in the portal with a placeholder hash; the wizard now fetches
 * this metadata so signatures always bind to a real, auditable revision.
 */

export const ENROLLMENT_AGREEMENT_DOCUMENT_ID = 'ENROLL-AGREEMENT-2026';
export const ENROLLMENT_AGREEMENT_VERSION = '2026.1';

export const ENROLLMENT_AGREEMENT_TEXT = [
  'BMI UNIVERSITY — MATRICULATION & HONOR AGREEMENT (v2026.1)',
  '',
  'By completing registration, I commit to uphold the highest standards of',
  'academic integrity, ethical conduct, and respect within the BMI community.',
  'I agree to abide by all university policies, course requirements, and',
  'payment schedules for the academic term in which I register.',
  '',
  'I confirm that all registration information I have provided is accurate,',
  'and I accept the fee schedule and installment plan I selected.',
].join('\n');

export interface AgreementMeta {
  document_id: string;
  version: string;
  version_hash: string;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** sha256 of `version + '\n' + text`, formatted `sha256:<hex>`. */
export async function getEnrollmentAgreementMeta(): Promise<AgreementMeta> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${ENROLLMENT_AGREEMENT_VERSION}\n${ENROLLMENT_AGREEMENT_TEXT}`)
  );
  return {
    document_id: ENROLLMENT_AGREEMENT_DOCUMENT_ID,
    version: ENROLLMENT_AGREEMENT_VERSION,
    version_hash: `sha256:${hex(digest)}`,
  };
}

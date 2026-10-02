import { describe, it, expect } from 'vitest';
import { encryptMfaSecret, decryptMfaSecret, isEncryptedMfaSecret } from './mfa-crypto';

const ENV = { MFA_ENCRYPTION_KEY: 'test-key-123', PASSWORD_PEPPER: 'pepper' };

describe('mfa-crypto', () => {
  it('encrypts to v1 wire format and round-trips', async () => {
    const enc = await encryptMfaSecret('JBSWY3DPEHPK3PXP', ENV);
    expect(isEncryptedMfaSecret(enc)).toBe(true);
    expect(enc).toMatch(/^v1\./);
    expect(await decryptMfaSecret(enc, ENV)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces unique ciphertexts (random IV)', async () => {
    const a = await encryptMfaSecret('JBSWY3DPEHPK3PXP', ENV);
    const b = await encryptMfaSecret('JBSWY3DPEHPK3PXP', ENV);
    expect(a).not.toBe(b);
  });

  it('passes legacy plaintext through (zero-downtime migration)', async () => {
    expect(await decryptMfaSecret('JBSWY3DPEHPK3PXP', ENV)).toBe('JBSWY3DPEHPK3PXP');
    expect(isEncryptedMfaSecret('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(isEncryptedMfaSecret(null)).toBe(false);
  });

  it('wrong key fails closed', async () => {
    const enc = await encryptMfaSecret('JBSWY3DPEHPK3PXP', ENV);
    await expect(decryptMfaSecret(enc, { MFA_ENCRYPTION_KEY: 'wrong', PASSWORD_PEPPER: 'nope' })).rejects.toThrow();
  });
});

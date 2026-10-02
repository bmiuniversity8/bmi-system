/**
 * Application-layer encryption for TOTP MFA secrets (AES-GCM 256).
 *
 * Platform at-rest encryption (D1/R2) protects disks, not the application
 * layer: anyone with DB read access sees plaintext TOTP secrets. This module
 * encrypts secrets before they reach the `users.mfa_secret` column.
 *
 * Key derivation: SHA-256(MFA_ENCRYPTION_KEY || PASSWORD_PEPPER).
 * Set MFA_ENCRYPTION_KEY via `wrangler secret put`. If unset, PASSWORD_PEPPER
 * is used alone (still a major improvement over plaintext; ops should set a
 * dedicated key).
 *
 * Wire format: `v1.<base64url-iv>.<base64url-ciphertext>`
 * Decryption transparently passes through legacy plaintext secrets so the
 * migration is zero-downtime: old rows verify, new rows are encrypted.
 */

async function deriveKey(env: { MFA_ENCRYPTION_KEY?: string; PASSWORD_PEPPER?: string }): Promise<CryptoKey> {
  const raw = `${env.MFA_ENCRYPTION_KEY || ''}::${env.PASSWORD_PEPPER || ''}`;
  if (!env.MFA_ENCRYPTION_KEY && !env.PASSWORD_PEPPER) {
    throw new Error('No MFA encryption key material configured (MFA_ENCRYPTION_KEY or PASSWORD_PEPPER required)');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isEncryptedMfaSecret(value: string | null | undefined): boolean {
  return !!value && value.startsWith('v1.');
}

export async function encryptMfaSecret(
  secret: string,
  env: { MFA_ENCRYPTION_KEY?: string; PASSWORD_PEPPER?: string }
): Promise<string> {
  const key = await deriveKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret))
  );
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

/** Decrypts `v1.*` values; passes legacy plaintext through unchanged. */
export async function decryptMfaSecret(
  stored: string,
  env: { MFA_ENCRYPTION_KEY?: string; PASSWORD_PEPPER?: string }
): Promise<string> {
  if (!isEncryptedMfaSecret(stored)) return stored;
  const parts = stored.split('.');
  if (parts.length !== 3) throw new Error('Malformed encrypted MFA secret');
  const key = await deriveKey(env);
  const iv = b64urlDecode(parts[1]);
  const ct = b64urlDecode(parts[2]);
  // Uint8Array<ArrayBuffer> vs ArrayBufferLike: copy into a fresh ArrayBuffer
  // so TS 5.8 + Workers types accept the decrypt input.
  const ctBuf = new Uint8Array(ct).buffer as ArrayBuffer;
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ctBuf);
  return new TextDecoder().decode(pt);
}

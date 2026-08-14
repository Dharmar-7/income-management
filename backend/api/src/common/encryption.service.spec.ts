import * as crypto from 'crypto';
import { EncryptionService } from './encryption.service';

// A fixed 32-byte test key (64 hex chars).
const KEY_HEX = '0'.repeat(64);

describe('EncryptionService', () => {
  let svc: EncryptionService;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = KEY_HEX;
    svc = new EncryptionService();
  });

  it('round-trips a value through GCM', () => {
    const secret = 'ya29.super-secret-refresh-token';
    const enc = svc.encrypt(secret);
    expect(enc.split(':')).toHaveLength(3); // iv:tag:data
    expect(enc).not.toContain(secret);
    expect(svc.decrypt(enc)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('rejects a tampered ciphertext (authentication)', () => {
    const enc = svc.encrypt('important');
    const [iv, tag, data] = enc.split(':');
    // Flip the last byte of the data.
    const flipped = data.slice(0, -2) + (data.slice(-2) === 'ff' ? '00' : 'ff');
    expect(() => svc.decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it('still decrypts a legacy AES-256-CBC value (backward compatible)', () => {
    // Recreate the exact old format: "iv:data" (2 parts), AES-256-CBC.
    const key = Buffer.from(KEY_HEX, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const data = Buffer.concat([cipher.update('legacy-token', 'utf8'), cipher.final()]);
    const legacy = `${iv.toString('hex')}:${data.toString('hex')}`;

    expect(legacy.split(':')).toHaveLength(2);
    expect(svc.decrypt(legacy)).toBe('legacy-token');
  });

  it('throws on a malformed value', () => {
    expect(() => svc.decrypt('not-encrypted')).toThrow();
  });
});

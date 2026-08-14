import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

// AES-256-GCM is authenticated (tamper-evident) — preferred over CBC, which is
// malleable. New values are written as GCM ("iv:tag:data", 3 parts). Values
// written by the old CBC scheme ("iv:data", 2 parts) still decrypt, so existing
// stored tokens keep working and roll over to GCM the next time they're saved.
const GCM = 'aes-256-gcm';
const CBC = 'aes-256-cbc';
const GCM_IV_LENGTH = 12; // standard nonce size for GCM

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const hexKey = process.env.ENCRYPTION_KEY;
    if (!hexKey) throw new Error('ENCRYPTION_KEY is not set in environment');

    // Convert the hex string from .env into a 32-byte buffer
    this.key = Buffer.from(hexKey, 'hex');

    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
    }
  }

  // Encrypt a plain-text string → "iv:tag:encryptedData" (all hex, AES-256-GCM).
  encrypt(text: string): string {
    const iv = crypto.randomBytes(GCM_IV_LENGTH); // fresh nonce per encryption
    const cipher = crypto.createCipheriv(GCM, this.key, iv);

    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  // Decrypt either the new GCM format (3 parts) or the legacy CBC format (2 parts).
  decrypt(encryptedText: string): string {
    const parts = (encryptedText ?? '').split(':');

    if (parts.length === 3) {
      const [ivHex, tagHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv(GCM, this.key, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex')); // throws on tamper/wrong key
      return Buffer.concat([
        decipher.update(Buffer.from(dataHex, 'hex')),
        decipher.final(),
      ]).toString('utf8');
    }

    if (parts.length === 2) {
      // Legacy AES-256-CBC value written before the GCM migration.
      const [ivHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv(CBC, this.key, Buffer.from(ivHex, 'hex'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataHex, 'hex')),
        decipher.final(),
      ]).toString('utf8');
    }

    throw new Error('Invalid encrypted text format');
  }
}

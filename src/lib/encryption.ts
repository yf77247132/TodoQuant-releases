import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_HEX_LENGTH = 32;
const MAX_CIPHERTEXT_HEX_LEN = 2 * 1024 * 1024;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_SALT = 'REPLACE_WITH_YOUR_SALT';
const V2_PREFIX = 'v2:';

function deriveKeyLegacy(masterKey: string): Buffer {
  return crypto.createHash('sha256').update(masterKey).digest();
}

const pbkdf2KeyCache = new Map<string, Buffer>();
const MAX_CACHE_SIZE = 10;

export function clearPbKdf2Cache(): void {
  pbkdf2KeyCache.clear();
}

function deriveKeyV2(masterKey: string): Buffer {
  const cached = pbkdf2KeyCache.get(masterKey);
  if (cached) return cached;
  const key = crypto.pbkdf2Sync(masterKey, PBKDF2_SALT, PBKDF2_ITERATIONS, 32, 'sha256');
  if (pbkdf2KeyCache.size >= MAX_CACHE_SIZE) {
    const firstKey = pbkdf2KeyCache.keys().next().value;
    pbkdf2KeyCache.delete(firstKey);
  }
  pbkdf2KeyCache.set(masterKey, key);
  return key;
}

export function encrypt(text: string, masterKey: string): string {
  if (!text) {
    throw new Error('Text to encrypt cannot be empty.');
  }
  if (!masterKey || masterKey.length < 6) {
    throw new Error('Master encryption key must be at least 6 characters long.');
  }

  const key = deriveKeyV2(masterKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${V2_PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedData: string, masterKey: string): string {
  if (!encryptedData) {
    throw new Error('Data to decrypt cannot be empty.');
  }
  if (!masterKey || masterKey.length < 6) {
    throw new Error('Master encryption key must be at least 6 characters long.');
  }

  if (encryptedData.length > MAX_CIPHERTEXT_HEX_LEN) {
    throw new Error(`Encrypted data exceeds maximum allowed length (${MAX_CIPHERTEXT_HEX_LEN} chars).`);
  }

  let cipherPart: string;
  let isV2 = false;

  if (encryptedData.startsWith(V2_PREFIX)) {
    cipherPart = encryptedData.slice(V2_PREFIX.length);
    isV2 = true;
  } else {
    cipherPart = encryptedData;
  }

  const parts = cipherPart.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format.');
  }

  const [ivHex, authTagHex, encryptedText] = parts;

  const isHex = (s: string) => /^[0-9a-f]+$/i.test(s);
  if (!isHex(ivHex) || ivHex.length !== IV_LENGTH * 2) {
    throw new Error('Invalid encrypted data format: IV.');
  }
  if (!isHex(authTagHex) || authTagHex.length !== AUTH_TAG_HEX_LENGTH) {
    throw new Error('Invalid encrypted data format: auth tag.');
  }
  if (!isHex(encryptedText)) {
    throw new Error('Invalid encrypted data format: cipher text.');
  }

  const key = isV2 ? deriveKeyV2(masterKey) : deriveKeyLegacy(masterKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

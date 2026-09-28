/**
 * RFC 4122 version 4 identifier generation, with no weak fallback.
 *
 * Entity ids are the join key for every relationship in the store and the
 * merge key for cross-window replication, so a predictable id is a
 * cross-tenant data-exposure primitive, not merely a bad identifier. Every byte
 * here therefore comes from the platform CSPRNG.
 *
 * `crypto.randomUUID` needs a secure context, so an intranet served over plain
 * HTTP falls through to `getRandomValues`, which is available in insecure
 * contexts and is equally cryptographic. Only the explicit rejection of
 * `typeof crypto === 'undefined'` yields an error: silently degrading to
 * `Math.random` would produce guessable ids and hand them to the user as
 * though they were sound.
 */
export function generateId(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  if (typeof webCrypto?.getRandomValues === 'function') {
    return uuidV4FromBytes(webCrypto.getRandomValues(new Uint8Array(16)));
  }

  throw new Error('Cryptographically secure Web Crypto API is required.');
}

/**
 * Formats 16 random bytes as an RFC 4122 version 4 UUID.
 *
 * The version nibble is forced to `4` and the variant nibble to `10xx`; those
 * bits are metadata, not entropy, so overwriting them costs no randomness.
 */
function uuidV4FromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

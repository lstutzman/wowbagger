import { randomBytes } from 'node:crypto';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Mints a canonical Wowbagger item ID: a 48-bit millisecond timestamp and 80
// bits of collision-resistant entropy, Crockford base32, `wb_` prefix. The
// encoded instant becomes the item's created date, so a caller supplying a
// calendar date gets that day's first UTC instant.
export function mintId(date = null) {
  const instant = date === null ? Date.now() : Date.parse(`${date}T00:00:00.000Z`);
  return `wb_${encodeTimestamp(instant)}${encodeEntropy()}`;
}

function encodeTimestamp(milliseconds) {
  let remaining = milliseconds;
  let encoded = '';
  for (let index = 0; index < 10; index += 1) {
    encoded = ULID_ALPHABET[remaining % 32] + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function encodeEntropy() {
  let value = BigInt(`0x${randomBytes(10).toString('hex')}`);
  let encoded = '';
  for (let index = 0; index < 16; index += 1) {
    encoded = ULID_ALPHABET[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

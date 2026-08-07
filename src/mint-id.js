import { randomBytes } from 'node:crypto';

import { ULID_ALPHABET, isCalendarDate } from './validate.js';

// The timestamp encodes the intended creation instant: the current time, or
// the start of the requested UTC calendar date so the ID agrees with the
// item's created field. The random portion is exactly the 80 bits of
// collision-resistant entropy the mutation contract requires.
export function mintId(date) {
  const milliseconds = date === undefined ? Date.now() : startOfDay(date);
  const timestamp = encodeValue(BigInt(milliseconds), 10);
  const entropy = encodeValue(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
  return `wb_${timestamp}${entropy}`;
}

function startOfDay(date) {
  if (!isCalendarDate(date)) {
    throw new Error(`mintId date must be an ISO calendar date, got ${JSON.stringify(date)}.`);
  }
  return Date.parse(`${date}T00:00:00.000Z`);
}

function encodeValue(value, length) {
  let remaining = value;
  let encoded = '';
  for (let index = 0; index < length; index += 1) {
    encoded = ULID_ALPHABET[Number(remaining % 32n)] + encoded;
    remaining /= 32n;
  }
  return encoded;
}

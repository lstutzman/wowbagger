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

// The first ID character is constrained to [0-7], so the ten-character
// timestamp encodes an unsigned 48-bit millisecond count: nothing before the
// Unix epoch, and 2^48 - 1 milliseconds (year 10889) at the top. The calendar
// check already caps input at the four-digit year 9999, inside that ceiling,
// so the accepted dates run from 1970-01-01 through 9999-12-31.
const MAX_TIMESTAMP_MILLISECONDS = 2 ** 48 - 1;

function startOfDay(date) {
  if (!isCalendarDate(date)) {
    throw new Error(`mintId date must be an ISO calendar date, got ${JSON.stringify(date)}.`);
  }
  const milliseconds = Date.parse(`${date}T00:00:00.000Z`);
  if (milliseconds < 0 || milliseconds > MAX_TIMESTAMP_MILLISECONDS) {
    throw new Error(
      `mintId date must be in the range 1970-01-01 through 9999-12-31, got ${JSON.stringify(date)}.`,
    );
  }
  return milliseconds;
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

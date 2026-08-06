// Small schema-checking primitives shared by describe.js and core-probe.js.
// Both files validate several exact-shape JSON objects (the describe
// request, the static manifest, the dynamic describe result, and the core
// capabilities probe) and need identical notions of "safe integer",
// "exact member set", and "deep JSON equality" so the checks agree with
// each other.

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// `value` has exactly the `required` members, plus zero or more of the
// `optional` members, and nothing else.
export function hasExactMembers(value, required, optional = []) {
  if (!isPlainObject(value)) {
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  const present = Object.keys(value);
  return present.every((key) => allowed.has(key)) && required.every((key) => present.includes(key));
}

export function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function isAllBoolean(value) {
  return Object.values(value).every((member) => typeof member === 'boolean');
}

export function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

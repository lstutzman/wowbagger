const ROOT_MEMBERS = Object.freeze([
  'adapter_manifest_version', 'adapter_id', 'adapter_version',
  'adapter_contract_versions', 'bootstrap_wire_version',
  'required_core_contract_version', 'entrypoints', 'platforms',
]);

function refuse(detail) {
  return { ok: false, error_code: 'invalid-adapter-manifest', detail };
}

// C0 controls (below U+0020) and DEL (U+007F). U+0020 and U+007E are the
// inclusive edges of the accepted printable range; the boundary is exact.
export function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

export function isSafeRelativeExecutable(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  if (hasControlCharacter(value)) {
    return false;
  }
  if (value.includes('\\') || value.startsWith('/')) {
    return false;
  }
  if (/^[A-Za-z]:/.test(value)) {
    return false;
  }
  if (/^volume\{[^/]*\}(\/|$)/i.test(value)) {
    return false;
  }
  const segments = value.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function validateAdapterManifest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return refuse('manifest is not an object');
  }
  const present = Object.keys(value);
  for (const member of present) {
    if (!ROOT_MEMBERS.includes(member)) {
      return refuse(`unknown root member ${member}`);
    }
  }
  for (const member of ROOT_MEMBERS) {
    if (!present.includes(member)) {
      return refuse(`missing root member ${member}`);
    }
  }
  if (value.entrypoints === null || typeof value.entrypoints !== 'object' || Array.isArray(value.entrypoints)) {
    return refuse('entrypoints is not an object');
  }
  const entrypointMembers = Object.keys(value.entrypoints);
  if (entrypointMembers.length !== 2 || !entrypointMembers.includes('describe') || !entrypointMembers.includes('invoke')) {
    return refuse('entrypoints does not have exactly describe and invoke');
  }
  for (const key of ['describe', 'invoke']) {
    const entrypoint = value.entrypoints?.[key];
    if (entrypoint === null || typeof entrypoint !== 'object' || Array.isArray(entrypoint)) {
      return refuse(`entrypoint ${key} is not an object`);
    }
    if (entrypoint.kind === 'host-tool') {
      const members = Object.keys(entrypoint).sort();
      if (members.join(',') !== 'kind,name' || typeof entrypoint.name !== 'string' || entrypoint.name === '') {
        return refuse(`entrypoint ${key} host-tool schema is not exact`);
      }
      continue;
    }
    if (entrypoint.kind !== 'command') {
      return refuse(`entrypoint ${key} kind is unknown`);
    }
    const members = Object.keys(entrypoint).sort();
    if (members.join(',') !== 'executable,fixed_args,kind') {
      return refuse(`entrypoint ${key} command schema is not exact`);
    }
    if (!isSafeRelativeExecutable(entrypoint.executable)) {
      return refuse(`entrypoint ${key} executable is unsafe`);
    }
    if (!Array.isArray(entrypoint.fixed_args)
      || entrypoint.fixed_args.some((arg) => typeof arg !== 'string' || hasControlCharacter(arg))) {
      return refuse(`entrypoint ${key} fixed_args are invalid`);
    }
  }
  return { ok: true, manifest: value };
}

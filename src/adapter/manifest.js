const ROOT_MEMBERS = Object.freeze([
  'adapter_manifest_version', 'adapter_id', 'adapter_version',
  'adapter_contract_versions', 'bootstrap_wire_version',
  'required_core_contract_version', 'entrypoints', 'platforms',
]);

function refuse(detail) {
  return { ok: false, error_code: 'invalid-adapter-manifest', detail };
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
  return { ok: true, manifest: value };
}

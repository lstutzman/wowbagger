const productionEntrypoint = new URL('../src/adapter/entrypoint-main.js', import.meta.url).href;
const conformanceEntrypoint = new URL('./adapter-conformance-entrypoint-main.js', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url === productionEntrypoint) {
    return { url: conformanceEntrypoint, shortCircuit: true };
  }
  return resolved;
}

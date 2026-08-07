const mutationModule = new URL('../src/mutation.js', import.meta.url).href;

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (url !== mutationModule || loaded.format !== 'module') {
    return loaded;
  }
  return {
    ...loaded,
    source: `${loaded.source.toString()}\nexport { controlledInsertionOffset as testControlledInsertionOffset };\n`,
  };
}

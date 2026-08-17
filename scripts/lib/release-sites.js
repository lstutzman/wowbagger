// Release version-site coverage.
//
// A cut may not rely on "grep finds no old version anywhere": the changelog and
// every dated design record must keep the versions they name. The proof is
// exact-set equality instead. Every literal occurrence of the outgoing version
// in a tracked text file must match exactly one manifest locator, each locator
// must match exactly the number of occurrences it declares, and after planning
// the surviving old-version occurrences must equal the declared retained set
// while the new-version occurrences equal the declared mutable set.
//
// Anything the manifest does not describe fails the cut. That is the whole
// point: a release site added next month is unmanifested, not silently stale.

export const VERSION_PLACEHOLDER = '{version}';

export const SITE_KINDS = new Set(['json-pointer', 'anchored-text']);
export const SITE_CLASSIFICATIONS = new Set(['mutable', 'retained']);

/**
 * Validate the manifest's shape. Returns a list of problems; empty means valid.
 */
export function validateManifest(manifest) {
  const problems = [];
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return [{ code: 'manifest-invalid', detail: 'manifest must be a JSON object' }];
  }
  if (manifest.manifest_version !== 1) {
    problems.push({ code: 'manifest-invalid', detail: 'manifest_version must be 1' });
  }
  if (!Array.isArray(manifest.sites) || manifest.sites.length === 0) {
    problems.push({ code: 'manifest-invalid', detail: 'sites must be a non-empty array' });
    return problems;
  }

  manifest.sites.forEach((site, index) => {
    const at = `sites[${index}]`;
    if (site === null || typeof site !== 'object' || Array.isArray(site)) {
      problems.push({ code: 'manifest-invalid', detail: `${at} must be an object` });
      return;
    }
    if (typeof site.file !== 'string' || site.file === '') {
      problems.push({ code: 'manifest-invalid', detail: `${at}.file must be a path` });
    }
    if (!SITE_KINDS.has(site.kind)) {
      problems.push({ code: 'manifest-invalid', detail: `${at}.kind must be a known locator kind` });
    }
    if (!SITE_CLASSIFICATIONS.has(site.classification)) {
      problems.push({
        code: 'manifest-invalid',
        detail: `${at}.classification must be mutable or retained`,
      });
    }
    if (!Number.isInteger(site.occurrences) || site.occurrences < 1) {
      problems.push({ code: 'manifest-invalid', detail: `${at}.occurrences must be a positive integer` });
    }
    if (site.kind === 'json-pointer' && (typeof site.pointer !== 'string' || !site.pointer.startsWith('/'))) {
      problems.push({ code: 'manifest-invalid', detail: `${at}.pointer must be a JSON Pointer` });
    }
    if (site.kind === 'anchored-text') {
      if (typeof site.anchor !== 'string') {
        problems.push({ code: 'manifest-invalid', detail: `${at}.anchor must be a string` });
      } else if (site.anchor.split(VERSION_PLACEHOLDER).length !== 2) {
        problems.push({
          code: 'manifest-invalid',
          detail: `${at}.anchor must contain exactly one ${VERSION_PLACEHOLDER}`,
        });
      }
    }
    if (site.applies_to_version !== undefined && typeof site.applies_to_version !== 'string') {
      problems.push({ code: 'manifest-invalid', detail: `${at}.applies_to_version must be a string` });
    }
  });

  return problems;
}

/**
 * Sites the manifest declares for this outgoing version. A site pinned to some
 * other version is dormant: it describes a historical record that no longer
 * names the version being replaced, so it can neither cover nor miss anything.
 */
export function activeSites(manifest, oldVersion) {
  return manifest.sites.filter(
    (site) => site.applies_to_version === undefined || site.applies_to_version === oldVersion,
  );
}

export function occurrenceOffsets(text, needle) {
  const offsets = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return offsets;
    offsets.push(at);
    from = at + needle.length;
  }
}

export function countOccurrences(text, needle) {
  return occurrenceOffsets(text, needle).length;
}

function resolvePointer(root, pointer) {
  let node = root;
  for (const rawToken of pointer.split('/').slice(1)) {
    const token = rawToken.replaceAll('~1', '/').replaceAll('~0', '~');
    if (node === null || typeof node !== 'object') return undefined;
    node = Array.isArray(node) ? node[Number(token)] : node[token];
  }
  return node;
}

function setPointer(root, pointer, value) {
  const tokens = pointer.split('/').slice(1)
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
  const last = tokens.pop();
  let node = root;
  for (const token of tokens) node = Array.isArray(node) ? node[Number(token)] : node[token];
  if (Array.isArray(node)) node[Number(last)] = value;
  else node[last] = value;
}

function walkStrings(node, pointer, visit) {
  if (typeof node === 'string') {
    visit(pointer, node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, index) => walkStrings(child, `${pointer}/${index}`, visit));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      const token = key.replaceAll('~', '~0').replaceAll('/', '~1');
      walkStrings(child, `${pointer}/${token}`, visit);
    }
  }
}

/**
 * Prove coverage of `oldVersion` across `files` and produce the mutable edits
 * that move those sites to `newVersion`.
 *
 * @param {object} input
 * @param {object} input.manifest parsed release-version-sites manifest
 * @param {Map<string,string>} input.files tracked text files, path -> content
 * @param {string} input.oldVersion
 * @param {string} input.newVersion
 * @returns {{ok: boolean, problems: Array, updates: Map<string,string>,
 *            retainedOccurrences: number, mutableOccurrences: number}}
 */
export function planVersionSites({ manifest, files, oldVersion, newVersion }) {
  const problems = validateManifest(manifest);
  if (problems.length > 0) return { ok: false, problems, updates: new Map() };

  const sites = activeSites(manifest, oldVersion);
  const byFile = new Map();
  for (const site of sites) {
    if (!byFile.has(site.file)) byFile.set(site.file, []);
    byFile.get(site.file).push(site);
  }

  const updates = new Map();
  let retainedOccurrences = 0;
  let mutableOccurrences = 0;

  for (const [file, fileSites] of byFile) {
    if (!files.has(file)) {
      problems.push({ code: 'missing-site-file', file, detail: 'manifest names a file the tree does not track' });
      continue;
    }
    const kinds = new Set(fileSites.map(({ kind }) => kind));
    if (kinds.size > 1) {
      problems.push({ code: 'mixed-locator-kinds', file, detail: 'one file uses one locator kind' });
      continue;
    }
    const text = files.get(file);
    const total = countOccurrences(text, oldVersion);
    const result = kinds.has('json-pointer')
      ? planJsonFile({ file, fileSites, text, total, oldVersion, newVersion })
      : planTextFile({ file, fileSites, text, total, oldVersion, newVersion });

    problems.push(...result.problems);
    retainedOccurrences += result.retained;
    mutableOccurrences += result.mutable;
    if (result.updated !== undefined) updates.set(file, result.updated);
  }

  for (const [file, text] of files) {
    if (byFile.has(file)) continue;
    if (countOccurrences(text, oldVersion) > 0) {
      problems.push({
        code: 'unmanifested-occurrence',
        file,
        detail: 'tracked file names the outgoing version and no manifest locator claims it',
      });
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    updates,
    retainedOccurrences,
    mutableOccurrences,
  };
}

function planTextFile({ file, fileSites, text, total, oldVersion, newVersion }) {
  const problems = [];
  const claimed = new Map(); // offset -> [site]
  let retained = 0;
  let mutable = 0;

  for (const site of fileSites) {
    const [prefix, suffix] = site.anchor.split(VERSION_PLACEHOLDER);
    const literal = `${prefix}${oldVersion}${suffix}`;
    const found = occurrenceOffsets(text, literal);
    if (found.length !== site.occurrences) {
      problems.push({
        code: 'locator-count-mismatch',
        file,
        locator: site.anchor,
        detail: `locator declares ${site.occurrences} occurrence(s) and matches ${found.length}`,
      });
      continue;
    }
    if (site.classification === 'mutable') mutable += found.length;
    else retained += found.length;
    for (const at of found) {
      const versionAt = at + prefix.length;
      if (!claimed.has(versionAt)) claimed.set(versionAt, []);
      claimed.get(versionAt).push(site);
    }
  }

  for (const [offset, owners] of claimed) {
    if (owners.length > 1) {
      problems.push({
        code: 'overlapping-locators',
        file,
        detail: `${owners.length} locators claim the same occurrence at offset ${offset}`,
      });
    }
  }

  if (problems.length === 0 && claimed.size !== total) {
    problems.push({
      code: 'unmanifested-occurrence',
      file,
      detail: `file carries ${total} occurrence(s) and the manifest covers ${claimed.size}`,
    });
  }

  if (problems.length > 0) return { problems, retained, mutable };

  const mutableOffsets = [...claimed.entries()]
    .filter(([, owners]) => owners[0].classification === 'mutable')
    .map(([offset]) => offset)
    .sort((left, right) => right - left);
  let updated = text;
  for (const offset of mutableOffsets) {
    updated = updated.slice(0, offset) + newVersion + updated.slice(offset + oldVersion.length);
  }

  return { problems, retained, mutable, updated: updated === text ? undefined : updated };
}

function planJsonFile({ file, fileSites, text, total, oldVersion, newVersion }) {
  const problems = [];
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    return {
      problems: [{ code: 'json-unparsable', file, detail: error.message }],
      retained: 0,
      mutable: 0,
    };
  }
  if (`${JSON.stringify(document, null, 2)}\n` !== text) {
    return {
      problems: [{
        code: 'json-not-canonical',
        file,
        detail: 'a JSON release site must be two-space canonical JSON so a planned edit rewrites only its version',
      }],
      retained: 0,
      mutable: 0,
    };
  }

  const carried = new Map(); // pointer -> occurrence count
  walkStrings(document, '', (pointer, value) => {
    const count = countOccurrences(value, oldVersion);
    if (count > 0) carried.set(pointer, count);
  });
  const covered = new Set();
  const mutations = [];
  let retained = 0;
  let mutable = 0;

  for (const site of fileSites) {
    const value = resolvePointer(document, site.pointer);
    const count = typeof value === 'string' ? countOccurrences(value, oldVersion) : 0;
    if (count !== site.occurrences) {
      problems.push({
        code: 'locator-count-mismatch',
        file,
        locator: site.pointer,
        detail: `pointer declares ${site.occurrences} occurrence(s) and resolves to ${count}`,
      });
      continue;
    }
    if (covered.has(site.pointer)) {
      problems.push({
        code: 'overlapping-locators',
        file,
        detail: `two locators claim ${site.pointer}`,
      });
      continue;
    }
    covered.add(site.pointer);
    if (site.classification === 'mutable') {
      mutable += count;
      mutations.push([site.pointer, value.replaceAll(oldVersion, newVersion)]);
    } else {
      retained += count;
    }
  }

  const carriedTotal = [...carried.values()].reduce((sum, count) => sum + count, 0);
  if (problems.length === 0) {
    for (const pointer of carried.keys()) {
      if (!covered.has(pointer)) {
        problems.push({
          code: 'unmanifested-occurrence',
          file,
          detail: `${pointer} names the outgoing version and no manifest locator claims it`,
        });
      }
    }
    if (carriedTotal !== total) {
      problems.push({
        code: 'unmanifested-occurrence',
        file,
        detail: `file carries ${total} literal occurrence(s) outside string values it can account for`,
      });
    }
  }

  if (problems.length > 0) return { problems, retained, mutable };

  for (const [pointer, value] of mutations) setPointer(document, pointer, value);

  return {
    problems,
    retained,
    mutable,
    updated: mutations.length === 0 ? undefined : `${JSON.stringify(document, null, 2)}\n`,
  };
}

/**
 * The proof that runs after every planned byte exists: old-version occurrences
 * across the whole tree must equal the retained set exactly, and new-version
 * occurrences must equal the mutable set plus whatever the caller declares it
 * added (the new changelog header).
 */
export function verifyExactSets({ files, oldVersion, newVersion, expectedOld, expectedNew }) {
  const problems = [];
  let oldTotal = 0;
  let newTotal = 0;
  for (const text of files.values()) {
    oldTotal += countOccurrences(text, oldVersion);
    newTotal += countOccurrences(text, newVersion);
  }
  if (oldTotal !== expectedOld) {
    problems.push({
      code: 'retained-set-mismatch',
      detail: `expected ${expectedOld} retained occurrence(s) of ${oldVersion} and found ${oldTotal}`,
    });
  }
  if (newTotal !== expectedNew) {
    problems.push({
      code: 'mutable-set-mismatch',
      detail: `expected ${expectedNew} occurrence(s) of ${newVersion} and found ${newTotal}`,
    });
  }
  return { ok: problems.length === 0, problems };
}

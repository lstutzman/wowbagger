const mutationModule = new URL('../src/mutation.js', import.meta.url).href;

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  const fault = process.env.WOWBAGGER_CANDIDATE_FAULT;
  if (url !== mutationModule || loaded.format !== 'module' || !fault) {
    return loaded;
  }

  const source = loaded.source.toString();

  // The marker must identify exactly one site. lastIndexOf silently retargets
  // the injection if the call sites are ever reordered, which would leave every
  // fault test green while exercising a different code path.
  // Anchored on the replacement call's own argument list: create passes null as
  // the second argument, replaceItem passes id. Matching the bare call name hits
  // both sites, so a reorder would silently retarget every fault test.
  const marker = [
    '      const candidateValidation = validateSerializedCandidate(',
    '        current.ledger,',
    '        id,',
    '',
  ].join('\n');
  const occurrences = source.split(marker).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Candidate-validation injection point matched ${occurrences} sites; it must match exactly one.`,
    );
  }
  const injectionOffset = source.indexOf(marker);
  const injections = {
    'missing-edit-list': '      serializedEdits = undefined;\n',
    'identity-parse-failures': [
      '      parseFrontmatterDocument = () => ({',
      '        document: { errors: [{}] },',
      '        frontmatter: \'\',',
      '      });',
      '',
    ].join('\n'),
    'identity-two-parse-budget': [
      '      const uncountedParseFrontmatterDocument = parseFrontmatterDocument;',
      '      let identityParseCount = 0;',
      '      parseFrontmatterDocument = (...argumentsList) => {',
      '        identityParseCount += 1;',
      '        return identityParseCount <= 2',
      '          ? uncountedParseFrontmatterDocument(...argumentsList)',
      '          : { document: { errors: [{}] }, frontmatter: \'\' };',
      '      };',
      '',
    ].join('\n'),
    'candidate-rewrites-extension': [
      '      bytes = Buffer.from(',
      '        bytes.toString(\'utf8\').replace(\'operator_note: "stable"\', \'operator_note: stable\'),',
      '        \'utf8\',',
      '      );',
      '',
    ].join('\n'),
    'candidate-wrong-successor-data': [
      '      bytes = Buffer.from(bytes.toString(\'utf8\').replace(',
      '        /^title: "([^"]*)"$/m,',
      '        (_line, value) => `title: "${\'x\'.repeat(value.length)}"`,',
      '      ), \'utf8\');',
      '',
    ].join('\n'),
    // Rewrites the patched field in the bytes AND in the edit record that
    // claims them, so the two agree with each other and disagree with the
    // request. Every byte-level guard passes; only the successor-data
    // comparison can catch a serializer that wrote a value nobody asked for.
    'candidate-consistent-wrong-successor-data': [
      '      {',
      '        const wrote = bytes.toString(\'utf8\');',
      '        const line = /^title: "([^"]*)"$/m.exec(wrote);',
      '        if (line) {',
      '          const forged = `title: "${\'x\'.repeat(line[1].length)}"`;',
      '          bytes = Buffer.from(wrote.replace(line[0], forged), \'utf8\');',
      '          serializedEdits = serializedEdits.map((edit) => (',
      '            edit.replacement === line[0]',
      '              ? { ...edit, replacement: forged }',
      '              : edit',
      '          ));',
      '        }',
      '      }',
      '',
    ].join('\n'),
    'candidate-rewrites-unchanged-root': [
      '      {',
      '        const originalRelated = \'related: [ ]\';',
      '        const replacementRelated = \'related: [] \';',
      '        const sourceOffset = lockedTarget.source.indexOf(originalRelated);',
      '        const sourceBounds = frontmatterBounds(lockedTarget.source);',
      '        serializedEdits = [...serializedEdits, {',
      '          start: sourceOffset - sourceBounds.start,',
      '          end: sourceOffset - sourceBounds.start + originalRelated.length,',
      '          replacement: replacementRelated,',
      '        }].sort((left, right) => left.start - right.start);',
      '        bytes = Buffer.from(',
      '          bytes.toString(\'utf8\').replace(originalRelated, replacementRelated),',
      '          \'utf8\',',
      '        );',
      '      }',
      '',
    ].join('\n'),
    'candidate-edit-replacement-mismatch': [
      '      {',
      '        const originalRelated = \'related: [ ]\';',
      '        const replacementRelated = \'related: [] \';',
      '        const claimedReplacement = \'related: xx \';',
      '        const sourceOffset = lockedTarget.source.indexOf(originalRelated);',
      '        const sourceBounds = frontmatterBounds(lockedTarget.source);',
      '        serializedFields = [...serializedFields, \'related\'];',
      '        serializedEdits = [...serializedEdits, {',
      '          start: sourceOffset - sourceBounds.start,',
      '          end: sourceOffset - sourceBounds.start + originalRelated.length,',
      '          replacement: claimedReplacement,',
      '        }].sort((left, right) => left.start - right.start);',
      '        bytes = Buffer.from(',
      '          bytes.toString(\'utf8\').replace(originalRelated, replacementRelated),',
      '          \'utf8\',',
      '        );',
      '      }',
      '',
    ].join('\n'),
    'candidate-rewrites-provenance-extension': [
      '      bytes = Buffer.from(',
      '        bytes.toString(\'utf8\').replace(',
      '          \'  operator_detail: "stable"\',',
      '          \'  operator_detail: stable  \',',
      '        ),',
      '        \'utf8\',',
      '      );',
      '',
    ].join('\n'),
    'candidate-rewrites-provenance-leading-comment': [
      '      {',
      '        const originalComment = \'  # operator comment: stable\';',
      '        const replacementComment = \'  # operator comment: altered\';',
      '        const sourceOffset = lockedTarget.source.indexOf(originalComment);',
      '        const sourceBounds = frontmatterBounds(lockedTarget.source);',
      '        serializedFields = [...serializedFields, \'provenance\'];',
      '        serializedEdits = [...serializedEdits, {',
      '          start: sourceOffset - sourceBounds.start,',
      '          end: sourceOffset - sourceBounds.start + originalComment.length,',
      '          replacement: replacementComment,',
      '        }].sort((left, right) => left.start - right.start);',
      '        bytes = Buffer.from(',
      '          bytes.toString(\'utf8\').replace(originalComment, replacementComment),',
      '          \'utf8\',',
      '        );',
      '      }',
      '',
    ].join('\n'),
    'candidate-rewrites-unclaimed-bytes': [
      '      bytes = Buffer.from(',
      '        bytes.toString(\'utf8\').replace(\'\\n\\n---\\n\', \'\\n---\\n\'),',
      '        \'utf8\',',
      '      );',
      '',
    ].join('\n'),
  };
  const injection = injections[fault];
  if (!injection) {
    throw new Error(`Unknown candidate fault: ${fault}`);
  }
  return {
    ...loaded,
    source: `${source.slice(0, injectionOffset)}${injection}${source.slice(injectionOffset)}`,
  };
}

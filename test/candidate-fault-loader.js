const mutationModule = new URL('../src/mutation.js', import.meta.url).href;

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  const fault = process.env.WOWBAGGER_CANDIDATE_FAULT;
  if (url !== mutationModule || loaded.format !== 'module' || !fault) {
    return loaded;
  }

  const source = loaded.source.toString();
  if (fault === 'transition-second-field-list-drift') {
    const functionStart = 'function transitionMutationFields(edge) {\n';
    const returnStatement = '  return fields;\n}';
    if (!source.includes(functionStart) || !source.includes(returnStatement)) {
      throw new Error('Transition field-set injection point was not found.');
    }
    return {
      ...loaded,
      source: source
        .replace(functionStart, `${functionStart}  transitionMutationFieldCalls += 1;\n`)
        .replace(
          returnStatement,
          "  return transitionMutationFieldCalls === 2\n    ? fields.filter((field) => field !== 'decisions')\n    : fields;\n}",
        )
        .replace(functionStart, `let transitionMutationFieldCalls = 0;\n${functionStart}`),
    };
  }

  const marker = '      const candidateValidation = validateSerializedCandidate(\n';
  const injectionOffset = source.lastIndexOf(marker);
  if (injectionOffset < 0) {
    throw new Error('Candidate-validation injection point was not found.');
  }
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

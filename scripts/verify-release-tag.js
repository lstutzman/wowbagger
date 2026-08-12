#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = readJson('package.json');
const pluginManifest = readJson('.claude-plugin/plugin.json');
const marketplaceManifest = readJson('.claude-plugin/marketplace.json');
const marketplacePlugin = marketplaceManifest.plugins?.find(({ name }) => name === manifest.name);
const tag = `v${manifest.version}`;

if (
  pluginManifest.version !== manifest.version
    || marketplaceManifest.metadata?.version !== manifest.version
    || marketplacePlugin?.version !== manifest.version
    || marketplacePlugin?.source?.ref !== tag
) {
  fail(`Release metadata does not consistently name ${tag}.`);
}

let taggedCommit;
let headCommit;
try {
  taggedCommit = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  headCommit = git(['rev-parse', '--verify', 'HEAD']);
} catch {
  fail(`Release tag ${tag} does not exist in this checkout.`);
}

if (taggedCommit !== headCommit || git(['status', '--porcelain']) !== '') {
  fail(`Release checkout differs from ${tag}.`);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function git(argumentsList) {
  return execFileSync('git', argumentsList, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

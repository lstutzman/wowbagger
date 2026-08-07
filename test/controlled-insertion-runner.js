#!/usr/bin/env node
import { Scalar } from 'yaml';
import { testControlledInsertionOffset } from '../src/mutation.js';

class CountingItems extends Array {
  static get [Symbol.species]() {
    return Array;
  }

  slicedItems = 0;

  slice(...argumentsList) {
    const result = super.slice(...argumentsList);
    this.slicedItems += result.length;
    return result;
  }
}

const items = new CountingItems();
for (let index = 0; index < 4_000; index += 1) {
  items.push(pair(`extension_${index}`, index * 2));
}
items.push(pair('title', items.length * 2));

const offset = testControlledInsertionOffset({ contents: { flow: false, items } }, 'number');
process.stdout.write(`${JSON.stringify({ offset, sliced_items: items.slicedItems })}\n`);

function pair(keyValue, offset) {
  const key = new Scalar(keyValue);
  key.range = [offset, offset + 1, offset + 1];
  const value = new Scalar('stable');
  value.range = [offset + 1, offset + 2, offset + 2];
  return { key, value };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { domProfile, weightedJaccard } from './parity-metrics.mjs';

test('domProfile counts each element by normalized tag name', () => {
  assert.deepEqual(domProfile('<DIV><span></span><SPAN></SPAN></DIV>'), { div: 1, span: 2 });
});

test('weightedJaccard preserves element multiplicity', () => {
  assert.equal(weightedJaccard({ div: 100, span: 1 }, { div: 1, span: 100 }), 2 / 200);
  assert.equal(weightedJaccard({ div: 2, span: 1 }, { div: 2, span: 1 }), 1);
  assert.equal(weightedJaccard({}, {}), 1);
});

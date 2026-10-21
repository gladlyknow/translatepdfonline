import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeInlineJson } from './third-party-scripts';

test('inline JSON cannot terminate its script element', () => {
  const serialized = serializeInlineJson({
    plausible_domain: '</script><script>alert(1)</script>',
  });

  assert.doesNotMatch(serialized, /<\/script>/i);
  assert.deepEqual(JSON.parse(serialized), {
    plausible_domain: '</script><script>alert(1)</script>',
  });
});

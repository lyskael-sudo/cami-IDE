'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebKitPage } = require('../src/browsers/webkit');

test('WebKit page.evaluate passes its argument as the first function argument', async () => {
  const page = new WebKitPage({
    request: async (method, { script }) => {
      assert.equal(method, 'evaluate');
      return Function(`return ${script}`)();
    },
  }, 0);

  const result = await page.evaluate(
    value => ({ value, length: value.length }),
    'Cami',
  );

  assert.deepEqual(result, { value: 'Cami', length: 4 });
});

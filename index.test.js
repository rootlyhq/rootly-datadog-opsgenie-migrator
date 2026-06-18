const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizedServiceName, resultsCSV } = require('./index');

describe('normalizedServiceName', () => {
  it('lowercases and replaces special chars with underscores', () => {
    assert.equal(normalizedServiceName('Production on-call'), 'production_on-call');
  });

  it('handles brackets and special characters', () => {
    assert.equal(normalizedServiceName('[Production] On-Call'), 'production_on-call');
  });

  it('strips leading underscores and dashes', () => {
    assert.equal(normalizedServiceName('_leading'), 'leading');
    assert.equal(normalizedServiceName('-leading'), 'leading');
  });

  it('preserves already normalized names', () => {
    assert.equal(normalizedServiceName('production_on-call'), 'production_on-call');
  });

  it('handles empty string', () => {
    assert.equal(normalizedServiceName(''), '');
  });

  it('collapses consecutive special chars into one underscore', () => {
    assert.equal(normalizedServiceName('a!!b'), 'a_b');
  });
});

describe('resultsCSV', () => {
  it('produces header row when results are empty', () => {
    const csv = resultsCSV([]);
    const lines = csv.split('\n');
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes('Monitor'));
  });

  it('escapes double quotes in cell values', () => {
    const csv = resultsCSV([{
      monitor: { id: 1, name: 'test "monitor"' },
      old: '@opsgenie-svc',
      new: '@webhook-rootly-svc',
      oldMessage: 'msg',
      newMessage: 'msg @webhook-rootly-svc',
      error: '',
    }]);
    assert.ok(csv.includes('test ""monitor""'));
  });

  it('handles missing optional fields gracefully', () => {
    const csv = resultsCSV([{
      monitor: { id: 42 },
    }]);
    const lines = csv.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes('"42"'));
  });
});

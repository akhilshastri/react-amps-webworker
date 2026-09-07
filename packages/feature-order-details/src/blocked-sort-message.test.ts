import { describe, expect, test } from 'bun:test';
import { blockedFieldsMessage } from './blocked-sort-message';

describe('blockedFieldsMessage', () => {
  test('names the blocked field and explains why (plan §4/C5)', () => {
    const message = blockedFieldsMessage(['lastUpdated']);
    expect(message).toContain('lastUpdated');
    expect(message).toContain('stream the entire topic');
  });

  test('lists multiple blocked fields', () => {
    const message = blockedFieldsMessage(['lastUpdated', 'tickSeq']);
    expect(message).toContain('lastUpdated, tickSeq');
  });
});

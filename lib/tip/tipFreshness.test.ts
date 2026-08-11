import { classifyTipFreshness } from './tipFreshness';

describe('classifyTipFreshness', () => {
  const now = Date.parse('2026-08-11T12:00:00.000Z');

  it('returns absent when refreshedAt is null', () => {
    expect(classifyTipFreshness(null, now)).toBe('absent');
  });

  it('returns fresh when refreshed within the last 90 minutes', () => {
    expect(classifyTipFreshness('2026-08-11T11:00:00.000Z', now)).toBe('fresh');
    expect(classifyTipFreshness('2026-08-11T10:30:00.000Z', now)).toBe('fresh');
  });

  it('returns stale when older than 90 minutes', () => {
    expect(classifyTipFreshness('2026-08-11T10:29:59.000Z', now)).toBe('stale');
    expect(classifyTipFreshness('2026-08-11T08:00:00.000Z', now)).toBe('stale');
  });

  it('treats exactly 90 minutes as still fresh', () => {
    expect(classifyTipFreshness('2026-08-11T10:30:00.000Z', now)).toBe('fresh');
  });
});

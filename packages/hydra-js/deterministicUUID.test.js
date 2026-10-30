import { deterministicUUID } from '@volto-hydra/helpers';

describe('deterministicUUID', () => {
  test('the same seed gives the same UUID', () => {
    expect(deterministicUUID('instance-1::header')).toBe(deterministicUUID('instance-1::header'));
  });

  test('is a UUID', () => {
    expect(deterministicUUID('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('different seeds never share one: a uid must be unique (200,000 seeds)', () => {
    const seen = new Set();
    for (let i = 0; i < 200000; i++) seen.add(deterministicUUID(`instance-${i % 1000}::block-${i}`));
    expect(seen.size).toBe(200000);
  });
});

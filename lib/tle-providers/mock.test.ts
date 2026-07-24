import { mockProvider } from './mock';
import { parseTleText } from '@/lib/tle';

test('mock fixture always includes a decodable Alpha-5 object', async () => {
  const result = await mockProvider.fetch();
  expect(result.provider).toBe('mock');
  expect(result.objectCount).toBe(2);

  const entries = parseTleText(result.raw);
  expect(entries).toHaveLength(2);
  expect(entries.find((e) => e.name === 'SARAMAGO')?.id).toBe(100000);
});

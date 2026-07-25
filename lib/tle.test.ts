import { parseTleText, serializeTleEntries } from './tle';

const alpha5Sample = `OBJECT A5\n1 A0000U 26001A   26199.50000000  .00000000  00000-0  00000-0 0  9990\n2 A0000  53.0000 100.0000 0001000  90.0000 270.0000 15.50000000    10\n`;

test('parses Alpha-5 catalog numbers instead of dropping them', () => {
  const [entry] = parseTleText(alpha5Sample);
  expect(entry.id).toBe(100000);
});

test('serializeTleEntries round-trips through parseTleText', () => {
  const entries = parseTleText(alpha5Sample);
  const roundTripped = parseTleText(serializeTleEntries(entries));

  expect(roundTripped).toHaveLength(1);
  expect(roundTripped[0].id).toBe(entries[0].id);
  expect(roundTripped[0].name).toBe(entries[0].name);
  expect(roundTripped[0].l1).toBe(entries[0].l1);
  expect(roundTripped[0].l2).toBe(entries[0].l2);
});

const spacetrackStyleSample = `0 CALSPHERE 1\n1 00900U 64063C   26205.59316715  .00000514  00000-0  51298-3 0  9998\n2 00900  90.2203  72.6457 0025114 174.3525 217.9963 13.76659087 76572\n`;

test('strips the "0 " line-type marker Space-Track includes on the name line', () => {
  const [entry] = parseTleText(spacetrackStyleSample);
  expect(entry.name).toBe('CALSPHERE 1');
  expect(entry.name.startsWith('0')).toBe(false);
  expect(entry.operator).toBe('CALSPHERE 1');
});

test('leaves a CelesTrak-style name line (no "0 " marker) unchanged', () => {
  const [entry] = parseTleText(alpha5Sample);
  expect(entry.name).toBe('OBJECT A5');
});

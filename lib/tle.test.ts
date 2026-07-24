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

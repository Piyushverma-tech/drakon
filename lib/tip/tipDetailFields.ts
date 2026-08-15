import type { ReentryRisk } from '@/lib/types';

export type TipDetailField = { label: string; value: string; accent: boolean };

export function getTipDetailFields(risk: ReentryRisk): TipDetailField[] {
  if (!risk.tip) return [];

  const fields: TipDetailField[] = [
    {
      label: 'TIP est. re-entry',
      value: `${new Date(risk.tip.decayEpoch).toUTCString()} ± ${risk.tip.windowMinutes}min`,
      accent: false,
    },
    {
      label: 'TIP vs DRAKON',
      value:
        risk.tipDeltaDays == null
          ? 'No comparable estimate'
          : `${Math.abs(risk.tipDeltaDays)}d ${risk.tipDeltaDays > 0 ? 'later' : 'earlier'} than TIP`,
      accent: risk.tipAgreement === 'diverges',
    },
  ];

  if (risk.tip.lat !== null && risk.tip.lon !== null) {
    fields.push({
      label: 'TIP decay location',
      value: `${risk.tip.lat.toFixed(1)}°, ${risk.tip.lon.toFixed(1)}°${
        risk.tip.direction ? ` · ${risk.tip.direction}` : ''
      }`,
      accent: false,
    });
  }

  if (risk.tip.highInterest) {
    fields.push({ label: 'TIP flag', value: 'High interest', accent: true });
  }

  return fields;
}

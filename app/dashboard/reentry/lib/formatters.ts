export function formatEstimatedDays(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return '<1d';
  return `~${days}d`;
}

export function formatConfidence(
  confidence: 'high' | 'medium' | 'low'
): string {
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}

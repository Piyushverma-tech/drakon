function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="relative bg-black/60 backdrop-blur-md px-2  min-w-[100px] flex items-center justify-center gap-2">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-1 font-medium">
        {label}:
      </div>
      <div
        className={`text-[12px] font-mono font-medium tabular-nums ${accent ?? 'text-gray-100'}`}
      >
        {value}
      </div>
    </div>
  );
}

type Props = {
  counts: { critical: number; warning: number; nominal: number };
  total: number;
  f107: number | null;
};

export function ReentryStatsBar({ counts, total, f107 }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap justify-between w-full">
        <StatCard
          label="Critical"
          value={counts.critical}
          accent="text-red-400"
        />
        <StatCard
          label="Warning"
          value={counts.warning}
          accent="text-amber-400"
        />
        <StatCard
          label="Nominal"
          value={counts.nominal}
          accent="text-yellow-300"
        />
        <StatCard label="Flagged" value={total} accent="text-cyan-300" />
        {f107 != null && (
          <StatCard label="F10.7 sfu" value={f107} accent="text-gray-200" />
        )}
      </div>
    </div>
  );
}

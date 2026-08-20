export function ReentryAnalysisLoading({
  noradId,
}: {
  noradId?: number | string;
}) {
  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span className="h-5 w-20 border border-gray-500/40 bg-gray-500/10" />
          <span className="text-[13px] font-semibold text-gray-400">
            {noradId ? `Norad ${noradId}` : 'Loading object'}
          </span>
        </div>
        <span className="h-6 w-24 border border-cyan-400/20 bg-cyan-400/5" />
      </div>

      <div className="mt-3 h-6 w-full max-w-md bg-white/10" />
      <div className="mt-3 flex flex-wrap gap-3">
        <div className="h-4 w-48 bg-white/5" />
        <div className="h-4 w-36 bg-white/5" />
        <div className="h-4 w-44 bg-white/5" />
      </div>

      <div className="mt-6 border-t border-white/15 py-4">
        <div className="flex flex-wrap gap-6">
          {['Type', 'Operator', 'Perigee', 'Epoch'].map((label) => (
            <span key={label} className="space-y-2">
              <span className="block text-[10px] uppercase tracking-wider text-gray-500">
                {label}
              </span>
              <span className="block h-3 w-24 bg-white/5" />
            </span>
          ))}
        </div>
      </div>

      <h4 className="mt-2 text-[13px] text-cyan-300">Summary</h4>
      <div className="mt-2 mb-4 space-y-2 bg-white/5 px-4 py-3">
        <div className="h-3 w-full bg-white/10" />
        <div className="h-3 w-2/3 bg-white/10" />
      </div>

      <div className="mb-4 h-5 w-36 bg-cyan-400/10" />

      <div className="border-t border-white/10 mt-4 pt-4">
        <div className="flex flex-wrap my-6 gap-6">
          <div className="flex-1 min-w-[280px]">
            <div className="mb-2 h-3 w-24 bg-white/5" />
            <div className="h-[240px] border border-white/10 bg-white/[0.03]" />
          </div>
          <div className="flex-1 min-w-[280px]">
            <div className="mb-2 h-3 w-20 bg-white/5" />
            <div className="h-[240px] border border-white/10 bg-white/[0.03]" />
          </div>
        </div>
        <div className="flex flex-wrap mt-6 gap-6">
          <div className="flex-1 min-w-[280px]">
            <div className="mb-2 h-3 w-20 bg-white/5" />
            <div className="h-[240px] border border-white/10 bg-white/[0.03]" />
          </div>
          <div className="flex-1 min-w-[280px]">
            <div className="mb-2 h-3 w-28 bg-white/5" />
            <div className="h-[240px] border border-white/10 bg-white/[0.03]" />
          </div>
        </div>
      </div>
    </div>
  );
}

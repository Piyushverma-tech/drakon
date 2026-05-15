'use client';

type SatelliteDataErrorProps = {
  message: string;
  onRetry: () => void;
};

export function SatelliteDataError({
  message,
  onRetry,
}: SatelliteDataErrorProps) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-black">
      <div className="max-w-md mx-4 text-center">
        <div className="text-red-400 text-sm font-medium">
          Failed to load satellite data
        </div>
        <div className="mt-2 text-gray-400 text-sm">{message}</div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded border border-cyan-500/50 px-4 py-2 text-sm text-cyan-300 transition-colors hover:bg-cyan-500/10 hover:text-cyan-200"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

import { Earth } from 'lucide-react';

export default function MobileViewNotice() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-cyan-400/30 bg-black/60 backdrop-blur-sm p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10">
          <Earth className="h-6 w-6 text-cyan-300" />
        </div>
        <h1 className="text-lg font-semibold mb-2">Mobile View in Progress</h1>
        <p className="text-sm text-gray-300 leading-relaxed">
          We are working on the mobile view. Please use a PC or laptop for the
          best experience.
        </p>
        {/* <Link
          href="/dashboard"
          className="mt-5 inline-flex rounded-md border border-cyan-400/30 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-400/10 transition-colors"
        >
          Back to Dashboard
        </Link> */}
      </div>
    </div>
  );
}

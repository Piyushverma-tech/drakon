'use client';
import Link from 'next/link';
import { Satellite } from 'lucide-react';

export default function UnderDevelopment() {
  return (
    <div className="relative min-h-screen bg-black overflow-hidden flex items-center justify-center">
      {/* Subtle space gradient */}
      <div className="absolute inset-0 bg-gradient-radial from-transparent via-transparent to-blue-950/20" />

      {/* Content */}
      <div className="relative z-10 text-center px-4">
        <div className="inline-block mb-6">
          <div className="relative">
            <Satellite className="w-16 h-16 text-cyan-400 animate-pulse" />
            <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
            <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />
          </div>
        </div>

        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
          Under Development
        </h1>

        <p className="text-gray-300 text-lg mb-8 max-w-md mx-auto">
          This page is currently under development. We&apos;re working hard to
          bring you an amazing experience!
        </p>
        <div className="flex flex-col gap-4">
          <Link
            href="https://www.piyushverma.dev/drakon"
            target="_blank"
            className="text-cyan-400 hover:text-cyan-300"
          >
            Learn more about DRAKON
          </Link>

          <Link href="/globe" className="text-cyan-400 hover:text-cyan-300">
            Back to Globe
          </Link>
        </div>
      </div>
    </div>
  );
}

import { SignInButton, Show } from '@clerk/nextjs';
import Link from 'next/link';
import VeloraLogo from '@/components/VeloraLogo';

const FEATURES = [
  {
    icon: '📊',
    title: 'Visual Spending Breakdown',
    desc: 'See exactly where your money goes each month with colourful category charts.',
  },
  {
    icon: '🎯',
    title: 'Budget Tracking',
    desc: 'Set monthly limits per category and get warned before you overspend.',
  },
  {
    icon: '💎',
    title: 'Net Worth Tracking',
    desc: 'Watch your cash and investments grow, month over month.',
  },
  {
    icon: '📈',
    title: 'Monthly & Annual Reports',
    desc: 'Understand trends over time with clean, exportable reports.',
  },
];

const SPECTRUM = ['#8b5cf6', '#6366f1', '#06b6d4', '#22c55e', '#f97316', '#f43f5e'];

export default function Home() {
  return (
    <main className="min-h-screen bg-violet-50 flex flex-col items-center justify-between px-6 py-16 gap-16">

      {/* ── Hero ── */}
      <div className="flex flex-col items-center gap-4 text-center">
        <VeloraLogo size={40} wordmarkSize="lg" />
        <p className="text-gray-500 text-base max-w-xs leading-relaxed">
          Your spending, broken into clarity.
        </p>
      </div>

      {/* ── Feature cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        {FEATURES.map((f, i) => (
          <div
            key={i}
            className="bg-white rounded-2xl border border-violet-100 p-5 flex items-start gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-xl flex-shrink-0">
              {f.icon}
            </div>
            <div>
              <p className="font-700 text-sm font-bold text-gray-900">{f.title}</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── CTA ── */}
      <div className="flex flex-col items-center gap-4 w-full max-w-sm">
        {/* Spectrum bar */}
        <div className="flex w-full h-1 rounded-full overflow-hidden">
          {SPECTRUM.map((c, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: c }} />
          ))}
        </div>

        <Show when="signed-out">
          <SignInButton mode="redirect">
            <button className="w-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 text-white font-bold text-base hover:opacity-90 transition-opacity shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 cursor-pointer">
              <span className="font-bold">G</span>
              Continue with Google
            </button>
          </SignInButton>
        </Show>

        <Show when="signed-in">
          <Link
            href="/dashboard"
            className="w-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 text-white font-bold text-base hover:opacity-90 transition-opacity shadow-lg shadow-indigo-200 text-center"
          >
            Go to Dashboard →
          </Link>
        </Show>

        <p className="text-xs text-gray-400 text-center leading-relaxed">
          Already have an account? You&apos;ll be signed straight in.
          <br />
          New to Velora? Your account is created automatically.
        </p>
      </div>

    </main>
  );
}

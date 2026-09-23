"use client";

/** One tip per first-run step, shown beside it. */
const TIPS: string[] = [
  "Infinity Studio connects to Postgres, MySQL, Supabase, SQLite and more — all from one unified workspace.",
  "Turn on Schema Explorer in Settings to browse tables, functions, triggers and indexes without leaving the sidebar.",
  "You can pin favorite tables and queries for quick access from the sidebar.",
  "Export query results as CSV or JSON with a single click from the results grid.",
];

// Left-hand image panel with the tip that rotates per step.
export function TipPanel({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="relative m-3 hidden w-[42%] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-sidebar via-studio-bg to-muted md:flex">
      {/* eslint-disable-next-line @next/next/no-img-element -- static onboarding art from /public */}
      <img
        src="/onboarding.png"
        alt="Infinity Studio onboarding"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute top-14 left-0 right-0 z-10 max-w-xs mx-auto px-8 text-center">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-white/70">
          Tip
        </p>
        <p className="text-lg leading-relaxed text-white/90">
          {TIPS[stepIndex % TIPS.length]}
        </p>
      </div>
    </div>
  );
}

/** Small inline icons, the logo mark and the illustrations (plan 023). Inline SVG: nothing is fetched. */

export type IconName = 'home' | 'folder' | 'list' | 'gear' | 'back' | 'forward';

const PATHS: Record<IconName, string[]> = {
  home: ['M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3.5 6h.01', 'M3.5 12h.01', 'M3.5 18h.01'],
  gear: [
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    'M12 2v3',
    'M12 19v3',
    'M4.2 4.2l2.1 2.1',
    'M17.7 17.7l2.1 2.1',
    'M2 12h3',
    'M19 12h3',
    'M4.2 19.8l2.1-2.1',
    'M17.7 6.3l2.1-2.1',
  ],
  back: ['M15 18l-6-6 6-6'],
  forward: ['M9 18l6-6-6-6'],
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={name}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The Incubator mark: an indigo egg with a smile and a spark. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="inc-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <path
        d="M16 3c-5.5 0-10 8.2-10 14.5C6 23.3 10.5 29 16 29s10-5.7 10-11.5C26 11.2 21.5 3 16 3z"
        fill="url(#inc-logo)"
      />
      <path
        d="M11 18.5c1.6 1.6 3.2 2.4 5 2.4s3.4-.8 5-2.4"
        stroke="#fff"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="21.5" cy="10.5" r="1.6" fill="#fff" opacity="0.85" />
    </svg>
  );
}

/** The Home illustration: an egg under a glass dome on a console, with circuit traces. */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 220" aria-hidden="true" data-testid="hero-art">
      <defs>
        <linearGradient id="hero-egg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id="hero-dome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#eef2ff" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect x="40" y="168" width="240" height="24" rx="12" fill="#1e293b" />
      <rect x="64" y="176" width="40" height="8" rx="4" fill="#818cf8" />
      <circle cx="252" cy="180" r="5" fill="#22c55e" />
      <path
        d="M70 168c0-62 40-112 90-112s90 50 90 112z"
        fill="url(#hero-dome)"
        stroke="#c7d2fe"
        strokeWidth="2"
      />
      <path
        d="M160 70c-22 0-40 34-40 60 0 24 18 38 40 38s40-14 40-38c0-26-18-60-40-60z"
        fill="url(#hero-egg)"
      />
      <path
        d="M145 118l10 10 20-22"
        stroke="#fff"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g stroke="#818cf8" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7">
        <path d="M20 60h30l10 10" />
        <circle cx="16" cy="60" r="4" />
        <path d="M300 96h-28l-10 10" />
        <circle cx="304" cy="96" r="4" />
        <path d="M24 130h22" />
        <circle cx="20" cy="130" r="3" />
      </g>
      <g fill="#fbbf24">
        <circle cx="230" cy="40" r="4" />
        <circle cx="96" cy="34" r="3" />
        <circle cx="270" cy="140" r="3" />
      </g>
    </svg>
  );
}

/** An empty list: a small illustration and a sentence. */
export function Empty({ text }: { text: string }) {
  return (
    <div className="empty" data-testid="empty">
      <svg viewBox="0 0 120 90" aria-hidden="true">
        <rect
          x="14"
          y="18"
          width="92"
          height="58"
          rx="10"
          fill="none"
          stroke="#c7d2fe"
          strokeWidth="2"
          strokeDasharray="6 5"
        />
        <path
          d="M60 28c-8 0-14 12-14 21 0 8 6 13 14 13s14-5 14-13c0-9-6-21-14-21z"
          fill="#eef2ff"
          stroke="#818cf8"
          strokeWidth="2"
        />
        <circle cx="96" cy="16" r="4" fill="#fbbf24" />
      </svg>
      <p>{text}</p>
    </div>
  );
}

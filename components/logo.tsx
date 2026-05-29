import { cn } from '@/lib/utils';

export function Logo({
  className,
  withBackground = true,
}: {
  className?: string;
  withBackground?: boolean;
}) {
  const mutedStroke = withBackground ? '#FFFFFF' : 'currentColor';
  const activeStroke = withBackground ? '#FFFFFF' : 'currentColor';
  const needleStroke = withBackground ? '#FFFFFF' : 'currentColor';

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      className={cn('block', !withBackground && 'text-brand', className)}
    >
      {withBackground && (
        <>
          <rect x="3" y="3" width="58" height="58" rx="16" fill="rgb(var(--brand-strong))" />
          <rect
            x="3.75"
            y="3.75"
            width="56.5"
            height="56.5"
            rx="15.25"
            stroke="#FFFFFF"
            strokeOpacity="0.18"
            strokeWidth="1.5"
          />
        </>
      )}

      <path
        d="M15 39.5 A17 17 0 0 1 49 39.5"
        stroke={mutedStroke}
        strokeOpacity={withBackground ? 0.24 : 0.22}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M20.8 39.5 A11.2 11.2 0 0 1 43.2 39.5"
        stroke={mutedStroke}
        strokeOpacity={withBackground ? 0.2 : 0.18}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M15 39.5 A17 17 0 0 1 42.8 26"
        stroke={activeStroke}
        strokeWidth="5"
        strokeLinecap="round"
      />

      <g stroke={mutedStroke} strokeLinecap="round" strokeWidth="2" strokeOpacity={withBackground ? 0.54 : 0.34}>
        <path d="M18.1 34.2 L15 32.4" />
        <path d="M24 28.5 L22.3 25.5" />
        <path d="M32 26.2 L32 22.8" />
        <path d="M40 28.5 L41.7 25.5" />
        <path d="M45.9 34.2 L49 32.4" />
      </g>

      <path
        d="M32 39.5 L42.8 26"
        stroke={needleStroke}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <circle cx="32" cy="39.5" r="4.8" fill={withBackground ? '#FFFFFF' : 'currentColor'} />
      {withBackground && <circle cx="32" cy="39.5" r="2" fill="#4F46E5" />}

      <g opacity={withBackground ? 1 : 0.68}>
        <rect x="17" y="46" width="7" height="5" rx="2" fill={withBackground ? '#34D399' : 'currentColor'} />
        <rect x="28.5" y="43" width="7" height="8" rx="2" fill={withBackground ? '#FBBF24' : 'currentColor'} />
        <rect x="40" y="45" width="7" height="6" rx="2" fill={withBackground ? '#93C5FD' : 'currentColor'} />
      </g>
    </svg>
  );
}

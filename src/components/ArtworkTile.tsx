import React, { useEffect, useMemo, useState } from 'react';

interface ArtworkTileProps {
  artworkDataUrl: string | null | undefined;
  title: string;
  dominantColor?: string | null;
  sizeClass?: string;
  roundedClass?: string;
  iconSize?: number;
  isPlaying?: boolean;
}

const APPLE_MUSIC_PALETTES: [string, string, string][] = [
  ['#4E65FF', '#6B8CFF', '#92EFFD'], // Ocean Indigo -> Sky
  ['#FF5858', '#FF876C', '#FFC894'], // Apple Music Coral -> Warm Peach
  ['#667EEA', '#764BA2', '#B888F8'], // Royal Violet -> Soft Lavender
  ['#11998E', '#26C6DA', '#80E8B6'], // Deep Teal -> Mint Glass
  ['#3A4750', '#52616B', '#8FA3B0'], // macOS Space Slate -> Silver
  ['#F857A6', '#FF5858', '#FFA07A'], // Rose Berry -> Sunset
  ['#2B5876', '#4E4376', '#7F7FD5'], // Midnight Dusk -> Twilight
];

function pickPalette(title: string): [string, string, string] {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % APPLE_MUSIC_PALETTES.length;
  return APPLE_MUSIC_PALETTES[idx];
}

export const ArtworkTile: React.FC<ArtworkTileProps> = ({
  artworkDataUrl,
  title,
  dominantColor,
  sizeClass = 'w-12 h-12',
  roundedClass = 'rounded-[12px]',
  iconSize = 18,
}) => {
  const [c1, c2, c3] = useMemo(() => pickPalette(title || 'Isla'), [title]);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [artworkDataUrl]);
  const accent = dominantColor && /^#[0-9a-f]{6}$/i.test(dominantColor) ? dominantColor : null;

  if (artworkDataUrl && !failed) {
    return (
      <div
        className={`relative shrink-0 overflow-hidden ${sizeClass} ${roundedClass} shadow-[0_4px_12px_rgba(15,23,42,0.14)] ring-1 ring-black/[0.08] dark:ring-white/[0.12]`}
      >
        <img
          src={artworkDataUrl}
          alt={title}
          className="w-full h-full object-cover"
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setFailed(true)}
        />
        <div
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.28)',
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative shrink-0 flex items-center justify-center overflow-hidden ${sizeClass} ${roundedClass} shadow-[0_4px_12px_rgba(15,23,42,0.12)] ring-1 ring-black/[0.08] dark:ring-white/[0.14]`}
      style={{
        background: accent
          ? `linear-gradient(140deg, color-mix(in srgb, ${accent}, #191B38 12%), ${accent} 55%, color-mix(in srgb, ${accent}, white 35%))`
          : `linear-gradient(140deg, ${c1} 0%, ${c2} 52%, ${c3} 100%)`,
      }}
      aria-label={title}
    >
      {/* Subtle Apple Music top-left specular lighting & vinyl depth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 26% 22%, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0) 62%)',
          boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.45)',
        }}
      />
      {/* Apple Music style filled double-beamed note glyph */}
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
      >
        <path
          d="M9 17.5C9 19.1569 7.54493 20.5 5.75 20.5C3.95507 20.5 2.5 19.1569 2.5 17.5C2.5 15.8431 3.95507 14.5 5.75 14.5C6.4987 14.5 7.18836 14.7341 7.73779 15.1277V5.8804C7.73779 5.03978 8.33219 4.31645 9.15666 4.15156L19.4189 2.09911C20.4981 1.88327 21.5 2.70894 21.5 3.80951V15.25C21.5 16.9069 20.0449 18.25 18.25 18.25C16.4551 18.25 15 16.9069 15 15.25C15 13.5931 16.4551 12.25 18.25 12.25C18.9987 12.25 19.6884 12.4841 20.2378 12.8777V6.65L9 8.9V17.5Z"
          fill="rgba(255, 255, 255, 0.94)"
        />
      </svg>
    </div>
  );
};

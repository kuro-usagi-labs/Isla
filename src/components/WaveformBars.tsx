import React from 'react';
import { motion } from 'motion/react';

interface WaveformBarsProps {
  isPlaying: boolean;
  reducedMotion?: boolean;
  color?: string;
  size?: 'sm' | 'md';
}

export const WaveformBars: React.FC<WaveformBarsProps> = ({
  isPlaying,
  reducedMotion = false,
  color = 'var(--isla-accent)',
  size = 'sm',
}) => {
  const heights = size === 'sm' ? [6, 13, 9, 11] : [8, 16, 11, 14];
  const barWidth = size === 'sm' ? 'w-[2.5px]' : 'w-[3px]';
  const containerHeight = size === 'sm' ? 'h-3.5' : 'h-4';

  return (
    <div
      className={`inline-flex items-center gap-[2px] ${containerHeight}`}
      aria-hidden="true"
    >
      {heights.map((maxH, idx) => {
        const active = isPlaying && !reducedMotion;
        return (
          <motion.span
            key={idx}
            className={`${barWidth} rounded-full`}
            style={{ backgroundColor: color, height: maxH, transformOrigin: 'center' }}
            animate={
              active
                ? {
                    scaleY: [0.35, 1, 0.55, 0.85, 0.35],
                  }
                : {
                    scaleY: isPlaying ? 0.7 : 3 / maxH,
                  }
            }
            transition={
              active
                ? {
                    duration: 0.95 + idx * 0.14,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }
                : { duration: 0.2 }
            }
          />
        );
      })}
    </div>
  );
};

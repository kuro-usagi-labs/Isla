import type { Transition } from 'motion/react';

// Geometry pairs share physics so the anchored edge stays still throughout a morph.
// Small overshoot on activities, almost-critical damping on the large player.
export const splitSpring = { type: 'spring' as const, stiffness: 240, damping: 26, mass: 0.85, restDelta:0.002,restSpeed:0.02 };
const shellSprings = {
  expanded: { type: 'spring', stiffness: 245, damping: 30, mass: 0.9 },
  notice: { type: 'spring', stiffness: 280, damping: 27, mass: 0.84 },
  volume: { type: 'spring', stiffness: 340, damping: 28, mass: 0.8 },
  compact: splitSpring,
} satisfies Record<string, Transition>;

export const contentSpring: Transition = {
  type: 'spring', stiffness: 330, damping: 27, mass: 0.72,
  opacity: { duration: 0.17, ease: 'easeOut' },
  filter: { duration: 0.2, ease: 'easeOut' },
};

export const transportSpring: Transition = {
  type: 'spring', stiffness: 340, damping: 29, mass: 0.75,
};

// Contents follow the shell by a few frames, then gather toward its anchor on exit.
export function islandContents(open: boolean, reduced: boolean, order=0, upward=false) {
  return {
    initial: false as const,
    animate: {
      opacity: open ? 1 : 0,
      y: reduced || open ? 0 : (upward ? 10 : -10),
      scale: reduced || open ? 1 : 0.96,
      filter: reduced || open ? 'blur(0px)' : 'blur(2px)',
    },
    transition: reduced ? {duration:0.1} : {
      type:'spring' as const, stiffness:360, damping:29, mass:0.75,
      delay:open?0.045+order*0.025:0,
      opacity:{duration:open?0.18:0.09,delay:open?0.045+order*0.025:0},
      filter:{duration:0.18},
    },
  };
}

export function islandTransition(mode: keyof typeof shellSprings, reduced: boolean, dragging: boolean): Transition {
  if (dragging) return { duration: 0 };
  if (reduced) return { duration: 0.1, ease: 'easeOut' };
  const spring = { ...shellSprings[mode], restDelta: 0.2, restSpeed: 3 };
  return {
    ...spring,
    x: spring, y: spring, width: spring, height: spring,
    borderRadius: { type: 'spring', stiffness: 260, damping: 28, mass: 0.8 },
    scaleX: { type: 'spring', stiffness: 450, damping: 30, mass: 0.6 },
    scaleY: { type: 'spring', stiffness: 450, damping: 30, mass: 0.6 },
  };
}

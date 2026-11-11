import { useEffect } from 'react';
import { useMotionValue, useSpring, useTransform } from 'motion/react';
import { islaBridge } from '../services/bridge';
import { beatPulseScale, readBeatStrength } from '../utils/beat';

/** Audio onsets excite a short envelope; the spring smooths its attack and release. */
export function useBeatPulse(enabled: boolean, trackId: number | null, immediateReset = false) {
  const target = useMotionValue(0);
  const pulse = useSpring(target,{ stiffness: 850, damping: 39, mass: 0.45 });
  const scaleX = useTransform(pulse,(value) => beatPulseScale(value).x);
  const scaleY = useTransform(pulse,(value) => beatPulseScale(value).y);
  useEffect(() => {
    let disposed = false;
    let frame: number | null = null;
    let unlisten: (() => void) | undefined;
    let peak = 0;
    let lastAt = 0;
    // Retire a beat through the same spring as the following shell morph.
    target.set(0);
    if (immediateReset) { target.jump(0); pulse.jump(0); }
    if (!enabled || trackId === null) return;
    const decay = (now: number) => {
      // Let the spring reach the hit before releasing, instead of fading underneath its attack.
      const value = peak*Math.exp(-Math.max(0,now-lastAt-40)/170);
      target.set(value > 0.002 ? value : 0);
      frame = value > 0.002 ? requestAnimationFrame(decay) : null;
    };
    void islaBridge.onAudioBeat((beat) => {
      if (disposed) return;
      const strength = readBeatStrength(beat,trackId);
      if (strength <= 0) return;
      peak = Math.max(target.get(),strength);
      lastAt = performance.now();
      target.set(peak);
      if (frame === null) frame = requestAnimationFrame(decay);
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
      if (frame !== null) cancelAnimationFrame(frame);
      target.set(0);
    };
  },[enabled,trackId,target,pulse,immediateReset]);
  useEffect(() => () => { target.jump(0); pulse.jump(0); },[target,pulse]);
  return { scaleX,scaleY };
}

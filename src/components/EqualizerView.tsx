import { useId, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, RotateCcw, ShieldCheck } from 'lucide-react';
import type { EqualizerSettings } from '../types/isla';
import { EQ_FREQUENCIES, EQ_LABELS, EQ_PRESETS, applyEqPreset, eqCurvePath, normalizeEqualizer, setEqBand, setEqPreamp, isEqBandAvailable } from '../utils/equalizer';
import { useEqualizer } from '../hooks/useEqualizer';
import { contentSpring } from '../utils/motion';

interface EqualizerViewProps { settings: EqualizerSettings; accentColor: string; reducedMotion: boolean; sampleRateHz?: number }
const db = (value: number) => (value > 0 ? '+' : '') + value.toFixed(value % 1 ? 1 : 0);

export function EqualizerView({ settings, accentColor, reducedMotion, sampleRateHz = 48000 }: EqualizerViewProps) {
  const { value, change, error, saving, pending, retry } = useEqualizer(settings);
  const [activeBand, setActiveBand] = useState<number | null>(null);
  const [draggingBand, setDraggingBand] = useState<number | null>(null);
  const id = useId().replace(/:/g, '');
  const preset = EQ_PRESETS.find((preset) => preset.id === value.preset);
  const path = eqCurvePath(value.bandsDb);
  const transition = reducedMotion ? { duration: 0.1 } : contentSpring;
  const bandSpring = reducedMotion ? { duration: 0.1 } : { type: 'spring' as const, stiffness: 380, damping: 29, mass: 0.7 };
  const unavailable = EQ_FREQUENCIES.some((hz) => !isEqBandAvailable(hz,sampleRateHz));
  return (
    <div className={'eq-view eq-refined ' + (!value.enabled ? 'is-bypassed' : '')} style={{ '--eq-accent': accentColor } as CSSProperties}>
      <div className="eq-topline">
        <div className="eq-preset-wrap">
          <div className="eq-select"><select aria-label="Equalizer preset" value={value.preset} onChange={(e) => change(e.target.value === 'custom' ? { ...value, preset: 'custom' } : applyEqPreset(value,e.target.value))}>
            {EQ_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}<option value="custom">Custom</option>
          </select><ChevronDown size={11} aria-hidden="true" /></div>
          <p role={error ? 'alert' : undefined}>{error ? 'Changes pending · retry below' : value.enabled ? preset?.description ?? 'Your own signature sound' : 'Bypassed · your curve is kept'}</p>
        </div>
        <div className="eq-toggle"><span>{value.enabled ? 'On' : 'Off'}</span><button type="button" role="switch" aria-label="Enable equalizer" aria-checked={value.enabled} className="eq-power" onClick={() => change({ ...value, enabled: !value.enabled })}><motion.span initial={false} animate={{ x: value.enabled ? 16 : 0 }} transition={transition} /></button></div>
      </div>
      <div className="eq-tone-canvas">
        <div className="eq-curve" aria-hidden="true">
          <div className="eq-curve-labels"><span>TONE SHAPE</span><AnimatePresence initial={false} mode="popLayout"><motion.span key={activeBand ?? 'idle'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.12 }} className="eq-inspector isla-tabular">{activeBand === null ? '±12 dB' : EQ_LABELS[activeBand]+' Hz · '+db(value.bandsDb[activeBand])+' dB'}</motion.span></AnimatePresence></div>
          <svg viewBox="0 0 340 46" preserveAspectRatio="none">
            <defs><linearGradient id={'eq-fill-'+id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={accentColor} stopOpacity="0.17" /><stop offset="100%" stopColor={accentColor} stopOpacity="0" /></linearGradient></defs>
            <path d="M8,23 H332" stroke="var(--isla-divider)" strokeDasharray="2 4" fill="none" />
            <motion.path initial={false} animate={{ d: path+' L332,46 L8,46 Z', opacity: value.enabled ? 1 : 0.4 }} fill={'url(#eq-fill-'+id+')'} transition={transition} />
            <motion.path initial={false} animate={{ d: path, opacity: value.enabled ? 0.9 : 0.4 }} fill="none" stroke={accentColor} strokeWidth="1.8" strokeLinecap="round" transition={transition} />
            {EQ_FREQUENCIES.map((_,i) => <motion.circle key={i} initial={false} animate={{ cx: 8+i*36, cy: 23-value.bandsDb[i]*1.35, r: activeBand === i ? 2.5 : 0 }} fill={accentColor} transition={transition} />)}
          </svg>
        </div>
        <div className="eq-bands" role="group" aria-label="Equalizer frequency bands">
          {EQ_FREQUENCIES.map((frequency,index) => {
            const available = isEqBandAvailable(frequency,sampleRateHz);
            const center = 4+(12-value.bandsDb[index])/24*70;
            const direct = draggingBand === index;
            const thumbTransition = direct ? { duration: 0 } : bandSpring;
            return <label key={frequency} className={'eq-band '+(activeBand === index ? 'is-active ' : '')+(!available ? 'is-unavailable' : '')} title={available ? 'Double-click to reset this band' : 'Above this track’s usable frequency range'}
              onMouseEnter={() => setActiveBand(index)} onMouseLeave={(e) => { if (draggingBand === null && !e.currentTarget.contains(document.activeElement)) setActiveBand(null); }}>
              <span className={'eq-gain isla-tabular ' + (value.bandsDb[index] !== 0 ? 'is-adjusted' : '')}>{db(value.bandsDb[index])}</span>
              <span className="eq-rail"><span className="eq-track" /><span className="eq-zero" />
                <motion.span aria-hidden="true" className="eq-track-fill" initial={false} animate={{ y: Math.min(center,39), height: Math.abs(center-39), opacity: value.enabled ? 0.65 : 0.2 }} transition={thumbTransition} />
                <motion.span aria-hidden="true" className="eq-visual-thumb" initial={false} animate={{ y: center-4, scaleX: activeBand === index ? 1.12 : 1 }} transition={thumbTransition} />
                <input type="range" min={-12} max={12} step={0.5} value={value.bandsDb[index]} disabled={!available} aria-label={'EQ '+frequency+' Hz'} aria-orientation="vertical" aria-valuetext={db(value.bandsDb[index])+' decibels'}
                  onFocus={() => setActiveBand(index)} onBlur={() => { setActiveBand(null); setDraggingBand(null); }}
                  onPointerDown={() => { setActiveBand(index); setDraggingBand(index); }} onPointerUp={() => setDraggingBand(null)} onPointerCancel={() => setDraggingBand(null)} onLostPointerCapture={() => setDraggingBand(null)}
                  onChange={(e) => change(setEqBand(value,index,Number(e.target.value)))} onDoubleClick={() => change(setEqBand(value,index,0))}
                  onKeyDown={(e) => { const next = e.key === 'ArrowUp' ? value.bandsDb[index]+0.5 : e.key === 'ArrowDown' ? value.bandsDb[index]-0.5 : e.key === 'Home' ? -12 : e.key === 'End' ? 12 : null; if (next !== null) { e.preventDefault(); change(setEqBand(value,index,next)); } }} />
              </span><span className="eq-frequency isla-tabular">{EQ_LABELS[index]}</span>
            </label>;
          })}
        </div>
        <div className="eq-groups" aria-hidden="true"><span>BASS</span><span>MIDS</span><span>AIR</span></div>
      </div>
      <div className="eq-preamp"><label htmlFor={'preamp-'+id}>Preamp</label><input id={'preamp-'+id} type="range" min={-12} max={6} step={0.5} value={value.preampDb} aria-label="Equalizer preamp" aria-valuetext={db(value.preampDb)+' decibels'} onChange={(e) => change(setEqPreamp(value,Number(e.target.value)))} /><span className="isla-tabular">{db(value.preampDb)} dB</span></div>
      <div className="eq-bottom"><span title="Band boosts are compensated; Preamp then adjusts output level"><ShieldCheck size={11} />{unavailable ? 'Source-limited bands' : 'Auto headroom'}</span><span className="eq-save-status" role="status">{error ? <button type="button" onClick={retry} aria-label="Retry equalizer">Retry</button> : pending || saving ? 'Saving…' : <><Check size={9} />Saved</>}</span><button type="button" onClick={() => change({ ...normalizeEqualizer(), enabled: value.enabled })} aria-label="Reset equalizer"><RotateCcw size={11} />Reset</button></div>
    </div>
  );
}

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { EqualizerView } from '../components/EqualizerView';
import { applyEqPreset, normalizeEqualizer } from './equalizer';

it('exposes ten named frequency sliders, preset selection, bypass and preamp', () => {
  const html = renderToStaticMarkup(<EqualizerView settings={applyEqPreset(normalizeEqualizer(), 'rock')} accentColor="#5B7CFA" reducedMotion />);
  expect(html.match(/aria-orientation="vertical"/g)).toHaveLength(10);
  expect(html).toContain('aria-label="EQ 31 Hz"');
  expect(html).toContain('aria-label="EQ 16000 Hz"');
  expect(html).toContain('aria-label="Equalizer preset"');
  expect(html).toContain('aria-label="Equalizer preamp"');
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain('aria-label="Reset equalizer"');
});

it('does not offer ineffective high-frequency controls for an 8kHz source', () => {
  const html = renderToStaticMarkup(<EqualizerView settings={normalizeEqualizer()} accentColor="#5B7CFA" reducedMotion sampleRateHz={8000} />);
  expect(html.match(/<input[^>]*aria-label="EQ 4000 Hz"[^>]*>/)?.[0]).toContain('disabled=""');
  expect(html.match(/<input[^>]*aria-label="EQ 2000 Hz"[^>]*>/)?.[0]).not.toContain('disabled=""');
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompactPill } from '../components/CompactPill';
import { CompactOrb } from '../components/CompactOrb';
import { islaBridge } from '../services/bridge';
import type { Track } from '../types/isla';

const init = await islaBridge.getInitialAppState();
const track: Track = {
  id: 1, title: 'Midnight City', artist: 'M83', album: 'Hurry Up',
  albumArtist: 'M83', genre: '', filePath: 'test.mp3', normalizedPath: 'test.mp3',
  trackNumber: null, year: null, durationSecs: 240, format: 'MP3',
  bitrateKbps: null, sampleRateHz: null, fileSizeBytes: 100, artworkDataUrl: null,
  dominantColor: '#5367D6', isFavorite: false, dateAdded: 0, fileMissing: false,
};
const noop = () => {};
const base = {
  player: { ...init.player, currentTrack: track, isPlaying: true, queue: [track] },
  previousTrack: null, settings: init.settings, accentColor: '#5367D6',
  isExpanded: false, pillHeight: 58, expandUpward: false, maxPlayCount: 0,
  transitionDirection: 'next' as const, onExpand: noop, onOpenPlayer:noop, onTogglePlayPause: noop,
  onNextTrack: noop, onPreviousTrack: noop, onToggleFavorite: noop,
  onWheelVolume: noop, onDismissTransition: noop,
};

describe('island activities', () => {
  it('rests with circular progress and no transport, then reveals a separate transport surface', () => {
    const props={...base,settings:{...base.settings,pillSize:'compact' as const},orbX:0,controlsX:70,side:'right'};
    const orb=renderToStaticMarkup(<CompactOrb {...props} controls={false}/>);
    expect(orb).toContain('aria-label="Show playback controls"');
    expect(orb).toContain('aria-label="Playback progress"');
    expect(orb).toContain('inert=""');
    const controls=renderToStaticMarkup(<CompactOrb {...props} controls/>);
    expect(controls).toContain('aria-label="Hide playback controls"');
    expect(controls).toContain('aria-label="Expand music player"');
    expect(controls).not.toContain('data-compact-track-info');
    expect(controls).not.toContain('Expand now playing');
    expect(controls).toContain('data-liquid-surface');
    for(const name of ['Previous track','Pause','Next track']) expect(controls).toContain(`aria-label="${name}"`);
    expect(controls.match(/data-island-hit-region/g)?.length).toBe(2);
  });
  it('makes the orb and satellite inert when expanded',()=>{
    const html=renderToStaticMarkup(<CompactOrb {...base} controls isExpanded orbX={0} controlsX={70} side="right"/>);
    expect(html).toContain('inert=""');
    expect(html).toContain('aria-hidden="true"');
  });
  it('disables empty transport so it cannot advance the presentation stage',()=>{
    const html=renderToStaticMarkup(<CompactOrb {...base} player={{...base.player,currentTrack:null,queue:[],isPlaying:false}} controls orbX={0} controlsX={70} side="right"/>);
    expect(html).toMatch(/data-pill-play="true"[^>]*disabled=""/);
  });
  it.each(['standard', 'loved', 'mostPlayed', 'crownLoved'] as const)(
    'keeps Pause and Next accessible during a %s song notice', (transitionKind) => {
      const html = renderToStaticMarkup(<CompactPill {...base} transitionKind={transitionKind} isVolumeMorph={false} />);
      expect(html).toContain('aria-label="Pause"');
      expect(html).toContain('aria-label="Next track"');
    },
  );
  it('shows volume immediately even while a track notice is active', () => {
    const html = renderToStaticMarkup(<CompactPill {...base} transitionKind="standard" isVolumeMorph />);
    expect(html).toContain('Output Volume');
    expect(html).toContain('aria-label="Pause"');
    expect(html).toContain('aria-label="Next track"');
  });
  it('makes the hidden compact layer inert when expanded', () => {
    const html = renderToStaticMarkup(<CompactPill {...base} transitionKind="none" isVolumeMorph={false} isExpanded />);
    expect(html).toContain('inert=""');
    expect(html).toContain('aria-hidden="true"');
  });
  it('presents a distinct handoff with separate outgoing and incoming song regions', () => {
    const oldTrack = { ...track, id: 2, title: 'The previous song' };
    const html = renderToStaticMarkup(<CompactPill {...base} previousTrack={oldTrack} transitionKind="standard" isVolumeMorph={false} />);
    expect(html).toContain('aria-label="Incoming song"');
    expect(html).toContain('The previous song');
    expect(html).toContain('Midnight City');
  });
  it('omits filler copy from next-song notifications during crossfade', () => {
    const html = renderToStaticMarkup(<CompactPill {...base} player={{ ...base.player, isCrossfading: true }} transitionKind="standard" isVolumeMorph={false} />);
    expect(html).not.toContain('Blending seamlessly');
    expect(html).not.toContain('Your next moment');
    expect(html).toContain('aria-label="Pause"');
    expect(html).toContain('aria-label="Next track"');
  });
  it('keeps the configured accent in the notification when album tint is disabled', () => {
    const html = renderToStaticMarkup(<CompactPill {...base} settings={{ ...base.settings, dynamicArtworkAccent: false }} accentColor="#AAFFCC" transitionKind="standard" isVolumeMorph={false} />);
    expect(html).toContain('style="color:#AAFFCC"');
  });
  it('preserves the effective light-theme accent instead of lifting it for a black background', () => {
    const html = renderToStaticMarkup(<CompactPill {...base} accentColor="#3B5660" transitionKind="standard" isVolumeMorph={false} />);
    expect(html).toContain('style="color:#3B5660"');
  });
});

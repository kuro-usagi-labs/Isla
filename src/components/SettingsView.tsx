import React, { useEffect } from 'react';
import { version as appVersion } from '../../package.json';
import {
  FolderPlus,
  HardDrive,
  Keyboard,
  Layers,
  Power,
  RefreshCw,
  Sliders,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import type {
  AppSettings,
  AudioDeviceInfo,
  LibraryFolder,
  LibraryStats,
  RepeatMode,
} from '../types/isla';
import {
  formatFileSize,
  formatTotalHoursMinutes,
  hexToRgba,
} from '../utils/format';

interface SettingsViewProps {
  settings: AppSettings;
  folders: LibraryFolder[];
  stats: LibraryStats;
  outputDevices: AudioDeviceInfo[];
  onRefreshOutputDevices?: () => void;
  refreshingOutputDevices?: boolean;
  outputDeviceError?: string|null;
  accentColor: string;
  isScanning: boolean;
  onUpdateSettings: (next: AppSettings) => Promise<void>;
  onAddMusicFolder: () => void;
  onImportAudioFiles: () => void;
  onRescanLibrary: () => void;
  onRemoveFolder: (folderId: number, removeTracks: boolean) => void;
  onCleanMissingTracks: () => void;
  onMinimizeToTray: () => void;
  onQuitApplication: () => void;
}

const ACCENT_PRESETS = [
  { label: 'Isla Blue', hex: '#5B7CFA' },
  { label: 'Sapphire', hex: '#3B82F6' },
  { label: 'Lavender', hex: '#7C5DFA' },
  { label: 'Seafoam', hex: '#14B8A6' },
  { label: 'Rose', hex: '#EC4899' },
  { label: 'Coral', hex: '#F43F5E' },
  { label: 'Amber', hex: '#D97706' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  folders,
  stats,
  outputDevices,
  onRefreshOutputDevices,
  refreshingOutputDevices = false,
  outputDeviceError,
  accentColor,
  isScanning,
  onUpdateSettings,
  onAddMusicFolder,
  onImportAudioFiles,
  onRescanLibrary,
  onRemoveFolder,
  onCleanMissingTracks,
  onMinimizeToTray,
  onQuitApplication,
}) => {
  useEffect(() => { onRefreshOutputDevices?.(); },[onRefreshOutputDevices]);
  const missingOutput = Boolean(settings.outputDevice) && !outputDevices.some((device) => device.name === settings.outputDevice);
  const patch = (partial: Partial<AppSettings>) => {
    void onUpdateSettings({ ...settings, ...partial });
  };

  const renderToggle = (
    checked: boolean,
    onChange: (val: boolean) => void,
    label: string
  ) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer"
      style={{
        backgroundColor: checked ? accentColor : 'rgba(136, 136, 136, 0.28)',
      }}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );

  return (
    <div className="p-4 space-y-4 text-[12.5px]">
      {/* 1. APPEARANCE */}
      <section
        className="rounded-2xl p-3.5 space-y-3 border"
        style={{
          backgroundColor: 'var(--isla-bg-subtle)',
          borderColor: 'var(--isla-divider)',
        }}
      >
        <div className="flex items-center gap-2 font-semibold text-[13px]">
          <Sparkles size={14} style={{ color: accentColor }} />
          <span>Appearance</span>
        </div>

        {/* Theme */}
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--isla-text-secondary)' }}>Theme</span>
          <div className="inline-flex rounded-full p-0.5 bg-black/[0.06] dark:bg-white/[0.08]">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => patch({ theme: t })}
                className="px-2.5 py-1 rounded-full text-[11.5px] font-medium capitalize transition-colors cursor-pointer"
                style={{
                  backgroundColor:
                    settings.theme === t ? accentColor : 'transparent',
                  color:
                    settings.theme === t
                      ? 'var(--isla-accent-ink)'
                      : 'var(--isla-text-primary)',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Glass Intensity */}
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--isla-text-secondary)' }}>
            Glass Intensity
          </span>
          <div className="inline-flex rounded-full p-0.5 bg-black/[0.06] dark:bg-white/[0.08]">
            {(['subtle', 'balanced', 'luminous'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => patch({ glassIntensity: g })}
                className="px-2.5 py-1 rounded-full text-[11.5px] font-medium capitalize transition-colors cursor-pointer"
                style={{
                  backgroundColor:
                    settings.glassIntensity === g ? accentColor : 'transparent',
                  color:
                    settings.glassIntensity === g
                      ? 'var(--isla-accent-ink)'
                      : 'var(--isla-text-primary)',
                }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Accent Color */}
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--isla-text-secondary)' }}>
            Accent Color
          </span>
          <div className="flex items-center gap-1.5">
            {ACCENT_PRESETS.map((preset) => {
              const selected =
                settings.accentColor.toLowerCase() === preset.hex.toLowerCase();
              return (
                <button
                  key={preset.hex}
                  type="button"
                  onClick={() => patch({ accentColor: preset.hex })}
                  title={preset.label}
                  aria-label={`Select accent color ${preset.label}`}
                  className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                    selected ? 'scale-115 ring-2 ring-offset-1' : ' opacity-80 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: preset.hex,
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Artwork Tint */}
        <div className="flex items-center justify-between">
          <div>
            <div style={{ color: 'var(--isla-text-primary)' }}>
              Album Artwork Influence
            </div>
            <div
              className="text-[11px]"
              style={{ color: 'var(--isla-text-secondary)' }}
            >
              Allow active song artwork to subtly tint accents
            </div>
          </div>
          {renderToggle(
            settings.dynamicArtworkAccent,
            (val) => patch({ dynamicArtworkAccent: val }),
            'Album Artwork Influence'
          )}
        </div>

        {/* Reduced Motion */}
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--isla-text-primary)' }}>
            Reduced Motion
          </span>
          {renderToggle(
            settings.reducedMotion,
            (val) => patch({ reducedMotion: val }),
            'Reduced Motion'
          )}
        </div>
      </section>

      {/* 2. FLOATING PLAYER */}
      <section
        className="rounded-2xl p-3.5 space-y-3 border"
        style={{
          backgroundColor: 'var(--isla-bg-subtle)',
          borderColor: 'var(--isla-divider)',
        }}
      >
        <div className="flex items-center gap-2 font-semibold text-[13px]">
          <Layers size={14} style={{ color: accentColor }} />
          <span>Floating Player</span>
        </div>

        <div className="flex items-center justify-between">
          <span>Always on Top</span>
          {renderToggle(
            settings.alwaysOnTop,
            (val) => patch({ alwaysOnTop: val }),
            'Always on Top'
          )}
        </div>

        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--isla-text-secondary)' }}>
            Compact Pill Size
          </span>
          <div className="inline-flex rounded-full p-0.5 bg-black/[0.06] dark:bg-white/[0.08]">
            {(['compact', 'default', 'large'] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => patch({ pillSize: sz })}
                className="px-2.5 py-1 rounded-full text-[11.5px] font-medium capitalize cursor-pointer"
                style={{
                  backgroundColor:
                    settings.pillSize === sz ? accentColor : 'transparent',
                  color:
                    settings.pillSize === sz
                      ? 'var(--isla-accent-ink)'
                      : 'var(--isla-text-primary)',
                }}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span>Open Expanded on Launch</span>
          {renderToggle(
            settings.startExpanded,
            (val) => patch({ startExpanded: val }),
            'Open Expanded on Launch'
          )}
        </div>

        <div className="flex items-center justify-between">
          <span>Remember Desktop Position</span>
          {renderToggle(
            settings.rememberPosition,
            (val) => patch({ rememberPosition: val }),
            'Remember Desktop Position'
          )}
        </div>

        <div className="flex items-center justify-between">
          <span>Auto-Collapse When Unfocused</span>
          {renderToggle(
            settings.collapseOnBlur,
            (val) => patch({ collapseOnBlur: val }),
            'Auto-Collapse When Unfocused'
          )}
        </div>

        <div className="flex items-center justify-between">
          <span>Compact Pill Waveform</span>
          {renderToggle(
            settings.showPillWaveform,
            (val) => patch({ showPillWaveform: val }),
            'Compact Pill Waveform'
          )}
        </div>
        <div className="flex items-center justify-between gap-4">
          <div><div>Beat Pulse</div><div className="text-[11px]" style={{ color: 'var(--isla-text-secondary)' }}>Let the pill move with the music</div></div>
          {renderToggle(settings.beatPulse, (val) => patch({ beatPulse: val }), 'Beat Pulse')}
        </div>
      </section>

      {/* 3. PLAYBACK */}
      <section
        className="rounded-2xl p-3.5 space-y-3 border"
        style={{
          backgroundColor: 'var(--isla-bg-subtle)',
          borderColor: 'var(--isla-divider)',
        }}
      >
        <div className="flex items-center gap-2 font-semibold text-[13px]">
          <Volume2 size={14} style={{ color: accentColor }} />
          <span>Playback</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span
            className="shrink-0"
            style={{ color: 'var(--isla-text-secondary)' }}
          >
            Output Device
          </span>
          <div className="flex min-w-0 items-center gap-1.5"><select
            value={settings.outputDevice}
            onFocus={() => onRefreshOutputDevices?.()}
            onChange={(e) => patch({ outputDevice: e.target.value })}
            aria-label="Audio Output Device"
            className="max-w-[210px] truncate px-2.5 py-1.5 rounded-xl text-[11.5px] font-medium bg-black/[0.06] dark:bg-white/[0.08] border-0 cursor-pointer"
            style={{ color: 'var(--isla-text-primary)' }}
          >
            <option value="">System Default Audio</option>
            {missingOutput && <option value={settings.outputDevice} disabled>{settings.outputDevice} ({refreshingOutputDevices ? 'Checking…' : 'Disconnected'})</option>}
            {outputDevices.map((dev) => (
              <option key={dev.name} value={dev.name}>
                {dev.name} {dev.isDefault ? '(Windows default)' : ''}
              </option>
            ))}
          </select><button type="button" onClick={onRefreshOutputDevices} disabled={refreshingOutputDevices} aria-label="Refresh audio outputs" title="Refresh audio outputs" className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer disabled:opacity-40 shrink-0"><RefreshCw size={13} className={refreshingOutputDevices ? 'animate-spin' : undefined} /></button></div>
        </div>
        <p className="text-[10.5px] leading-relaxed -mt-1" role={outputDeviceError || missingOutput ? 'status' : undefined} style={{ color: 'var(--isla-text-secondary)' }}>
          {outputDeviceError || (missingOutput ? 'Selected output is disconnected. Choose an available device.' : settings.outputDevice ? 'Only Isla uses this output. Other apps keep their own audio device.' : 'Automatically follows your Windows default output.')}
        </p>

        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--isla-text-secondary)' }}>
            Default Repeat
          </span>
          <div className="inline-flex rounded-full p-0.5 bg-black/[0.06] dark:bg-white/[0.08]">
            {(['off', 'all', 'one'] as RepeatMode[]).map((rm) => (
              <button
                key={rm}
                type="button"
                onClick={() => patch({ defaultRepeat: rm })}
                className="px-2.5 py-1 rounded-full text-[11.5px] font-medium uppercase cursor-pointer"
                style={{
                  backgroundColor:
                    settings.defaultRepeat === rm ? accentColor : 'transparent',
                  color:
                    settings.defaultRepeat === rm
                      ? 'var(--isla-accent-ink)'
                      : 'var(--isla-text-primary)',
                }}
              >
                {rm}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span>Shuffle by Default</span>
          {renderToggle(
            settings.defaultShuffle,
            (val) => patch({ defaultShuffle: val }),
            'Shuffle by Default'
          )}
        </div>

        {/* Automix Crossfade */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <div style={{ color: 'var(--isla-text-primary)' }}>
              Automix Crossfade
            </div>
            <div
              className="text-[11px]"
              style={{ color: 'var(--isla-text-secondary)' }}
            >
              Smoothly blend songs together during transitions
            </div>
          </div>
          <div className="inline-flex rounded-full p-0.5 bg-black/[0.06] dark:bg-white/[0.08]">
            {[
              { label: 'Off', enabled: false, secs: 6 },
              { label: '3s', enabled: true, secs: 3 },
              { label: '6s', enabled: true, secs: 6 },
              { label: '9s', enabled: true, secs: 9 },
              { label: '12s', enabled: true, secs: 12 },
            ].map((opt) => {
              const isSelected = !opt.enabled
                ? settings.crossfadeEnabled === false
                : settings.crossfadeEnabled !== false &&
                  Math.round(settings.crossfadeSecs ?? 6) === opt.secs;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() =>
                    patch({
                      crossfadeEnabled: opt.enabled,
                      crossfadeSecs: opt.secs,
                    })
                  }
                  className="px-2 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer"
                  style={{
                    backgroundColor: isSelected ? accentColor : 'transparent',
                    color: isSelected ? 'var(--isla-accent-ink)' : 'var(--isla-text-primary)',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 4. LIBRARY */}
      <section
        className="rounded-2xl p-3.5 space-y-3 border"
        style={{
          backgroundColor: 'var(--isla-bg-subtle)',
          borderColor: 'var(--isla-divider)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-[13px]">
            <HardDrive size={14} style={{ color: accentColor }} />
            <span>Local Music Library</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isScanning}
              onClick={onAddMusicFolder}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: accentColor, color: 'var(--isla-accent-ink)' }}
            >
              <FolderPlus size={12} />
              <span>Add Folder</span>
            </button>
            <button
              type="button"
              disabled={isScanning}
              onClick={onRescanLibrary}
              title="Rescan all library folders"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium bg-black/[0.06] dark:bg-white/[0.08] cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                size={12}
                className={isScanning ? 'animate-spin' : ''}
              />
              <span>Rescan</span>
            </button>
          </div>
        </div>

        {/* Configured Folders */}
        {folders.length === 0 ? (
          <div
            className="text-[11.5px] py-2 px-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]"
            style={{ color: 'var(--isla-text-secondary)' }}
          >
            No music folders linked yet. Click <strong>Add Folder</strong> or{' '}
            <button
              type="button"
              onClick={onImportAudioFiles}
              className="underline font-medium cursor-pointer"
              style={{ color: accentColor }}
            >
              import individual audio files
            </button>
            .
          </div>
        ) : (
          <div className="space-y-1.5">
            {folders.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-black/[0.035] dark:bg-white/[0.04]"
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-medium truncate">
                    {f.path}
                  </div>
                  <div
                    className="text-[11px]"
                    style={{ color: 'var(--isla-text-secondary)' }}
                  >
                    {f.trackCount} {f.trackCount === 1 ? 'track' : 'tracks'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveFolder(f.id, true)}
                  title="Remove folder from library"
                  aria-label={`Remove folder ${f.path}`}
                  className="p-1.5 rounded-lg hover:bg-rose-500/10 text-rose-500 cursor-pointer shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Library Statistics Grid */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] text-center">
            <div className="text-[14px] font-bold isla-tabular">
              {stats.totalTracks}
            </div>
            <div
              className="text-[10.5px]"
              style={{ color: 'var(--isla-text-secondary)' }}
            >
              Songs
            </div>
          </div>
          <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] text-center">
            <div className="text-[14px] font-bold isla-tabular">
              {stats.totalAlbums}
            </div>
            <div
              className="text-[10.5px]"
              style={{ color: 'var(--isla-text-secondary)' }}
            >
              Albums
            </div>
          </div>
          <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] text-center">
            <div className="text-[14px] font-bold isla-tabular">
              {formatFileSize(stats.totalSizeBytes)}
            </div>
            <div
              className="text-[10.5px]"
              style={{ color: 'var(--isla-text-secondary)' }}
            >
              {formatTotalHoursMinutes(stats.totalDurationSecs)}
            </div>
          </div>
        </div>

        {stats.missingTracks > 0 && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-amber-500/10 text-amber-600 text-[11.5px]">
            <span>{stats.missingTracks} missing file(s) detected</span>
            <button
              type="button"
              onClick={onCleanMissingTracks}
              className="font-semibold underline cursor-pointer"
            >
              Clean Up
            </button>
          </div>
        )}
      </section>

      {/* 5. APPLICATION */}
      <section
        className="rounded-2xl p-3.5 space-y-3 border"
        style={{
          backgroundColor: 'var(--isla-bg-subtle)',
          borderColor: 'var(--isla-divider)',
        }}
      >
        <div className="flex items-center gap-2 font-semibold text-[13px]">
          <Sliders size={14} style={{ color: accentColor }} />
          <span>Application & System</span>
        </div>

        <div className="flex items-center justify-between">
          <span>Launch at Windows Startup</span>
          {renderToggle(
            settings.launchAtStartup,
            (val) => patch({ launchAtStartup: val }),
            'Launch at Windows Startup'
          )}
        </div>

        <div className="flex items-center justify-between">
          <span>Minimize to System Tray on Close</span>
          {renderToggle(
            settings.minimizeToTray,
            (val) => patch({ minimizeToTray: val }),
            'Minimize to System Tray on Close'
          )}
        </div>

        <div className="flex items-center justify-between">
          <span>Global Playback Shortcuts</span>
          {renderToggle(
            settings.globalShortcutsEnabled,
            (val) => patch({ globalShortcutsEnabled: val }),
            'Global Playback Shortcuts'
          )}
        </div>

        <div
          className="rounded-xl p-2.5 space-y-1 text-[11px]"
          style={{
            backgroundColor: hexToRgba(accentColor, 0.06),
            color: 'var(--isla-text-secondary)',
          }}
        >
          <div
            className="flex items-center gap-1.5 font-semibold"
            style={{ color: 'var(--isla-text-primary)' }}
          >
            <Keyboard size={12} />
            <span>Shortcuts Reference</span>
          </div>
          <div className="flex justify-between">
            <span>Play / Pause</span>
            <span className="font-mono">Space · MediaPlayPause · Alt+Shift+P</span>
          </div>
          <div className="flex justify-between">
            <span>Previous / Next Track</span>
            <span className="font-mono">Media Prev/Next · Alt+Shift+, / .</span>
          </div>
          <div className="flex justify-between">
            <span>Expand / Collapse Pill</span>
            <span className="font-mono">Esc · Alt+Shift+I</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={onMinimizeToTray}
            className="px-3 py-1.5 rounded-full text-[11.5px] font-medium bg-black/[0.06] dark:bg-white/[0.08] cursor-pointer"
          >
            Hide to System Tray
          </button>
          <button
            type="button"
            onClick={onQuitApplication}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold bg-rose-500/12 text-rose-500 hover:bg-rose-500/20 cursor-pointer"
          >
            <Power size={12} />
            <span>Quit Isla</span>
          </button>
        </div>

        <div
          className="pt-2 border-t text-center text-[11px]"
          style={{
            borderColor: 'var(--isla-divider)',
            color: 'var(--isla-text-secondary)',
          }}
        >
          <strong>Isla v{appVersion}</strong> · Floating Offline Music Player
        </div>
      </section>
    </div>
  );
};

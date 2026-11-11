import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRightLeft,
  Check,
  EyeOff,
  FolderPlus,
  Maximize2,
  Minimize2,
  Moon,
  Pause,
  Pin,
  Play,
  Plus,
  Power,
  Repeat,
  Repeat1,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Sun,
} from 'lucide-react';
import type { AppSettings, PlayerSnapshot } from '../types/isla';
import { hexToRgba } from '../utils/format';

interface AppContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  expanded: boolean;
  player: PlayerSnapshot;
  settings: AppSettings;
  accentColor: string;
  onClose: () => void;
  onToggleExpand: () => void;
  onTogglePlayPause: () => void;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onCycleCrossfade: () => void;
  onAddMusicFolder: () => void;
  onImportAudioFiles: () => void;
  onToggleAlwaysOnTop: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onMinimizeToTray: () => void;
  onQuitApplication: () => void;
}

export const AppContextMenu: React.FC<AppContextMenuProps> = ({
  open,
  x,
  y,
  expanded,
  player,
  settings,
  accentColor,
  onClose,
  onToggleExpand,
  onTogglePlayPause,
  onNextTrack,
  onPreviousTrack,
  onToggleShuffle,
  onCycleRepeat,
  onCycleCrossfade,
  onAddMusicFolder,
  onImportAudioFiles,
  onToggleAlwaysOnTop,
  onToggleTheme,
  onOpenSettings,
  onMinimizeToTray,
  onQuitApplication,
}) => {
  const menuWidth = 224;
  const openUpward = y > 206;
  const openLeftward = x > 218;

  const clampedLeft = Math.min(436 - menuWidth - 12, Math.max(12, openLeftward ? x - menuWidth : x));
  const originX = openLeftward ? 'right' : 'left';
  const originY = openUpward ? 'bottom' : 'top';

  const positionStyle: React.CSSProperties = {
    left: `${clampedLeft}px`,
    top: '12px',
    transformOrigin: `${originX} ${originY}`,
  };

  const runAndClose = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Full-canvas transparent backdrop to catch outside clicks cleanly */}
          <div
            className="fixed inset-0 z-40"
            onMouseDown={(e) => {
              e.stopPropagation();
              onClose();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
          />

          <motion.div
            initial={
              settings.reducedMotion
                ? { opacity: 0 }
                : {
                    opacity: 0,
                    scale: 0.92,
                    y: openUpward ? 6 : -6,
                  }
            }
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
            }}
            exit={
              settings.reducedMotion
                ? { opacity: 0 }
                : {
                    opacity: 0,
                    scale: 0.94,
                    y: openUpward ? 4 : -4,
                  }
            }
            transition={{
              type: 'spring',
              stiffness: 440,
              damping: 30,
              mass: 0.68,
            }}
            style={{
              ...positionStyle,
              color: 'var(--isla-text-primary)',
              borderColor: 'var(--isla-divider)',
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="isla-glass-panel fixed z-50 w-56 max-h-[388px] overflow-y-auto isla-scroll rounded-[20px] p-1.5 text-[12px] border select-none"
          >
            {/* Expand / Collapse Island */}
            <button
              type="button"
              onClick={() => runAndClose(onToggleExpand)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-semibold cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2.5">
                {expanded ? (
                  <Minimize2 size={13.5} style={{ color: accentColor }} />
                ) : (
                  <Maximize2 size={13.5} style={{ color: accentColor }} />
                )}
                <span>{expanded ? 'Collapse to Pill' : 'Expand Isla Player'}</span>
              </span>
              <span
                className="text-[10.5px] font-normal"
                style={{ color: 'var(--isla-text-secondary)' }}
              >
                {expanded ? 'Esc' : 'Click'}
              </span>
            </button>

            <div
              className="my-1 h-px"
              style={{ backgroundColor: 'var(--isla-divider)' }}
            />

            {/* Transport Controls */}
            <button
              type="button"
              onClick={() => runAndClose(onTogglePlayPause)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2.5 truncate">
                {player.isPlaying ? (
                  <Pause size={13.5} />
                ) : (
                  <Play size={13.5} />
                )}
                <span className="truncate">
                  {player.isPlaying ? 'Pause' : 'Play'}
                  {player.currentTrack ? ` · ${player.currentTrack.title}` : ''}
                </span>
              </span>
              <span
                className="text-[10.5px] shrink-0 ml-1"
                style={{ color: 'var(--isla-text-secondary)' }}
              >
                Space
              </span>
            </button>

            <div className="grid grid-cols-2 gap-1 mt-0.5">
              <button
                type="button"
                onClick={() => runAndClose(onPreviousTrack)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
              >
                <SkipBack size={13} />
                <span>Previous</span>
              </button>
              <button
                type="button"
                onClick={() => runAndClose(onNextTrack)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
              >
                <SkipForward size={13} />
                <span>Next</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 mt-0.5">
              <button
                type="button"
                onClick={() => runAndClose(onToggleShuffle)}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
                style={{
                  backgroundColor: player.shuffle
                    ? hexToRgba(accentColor, 0.11)
                    : undefined,
                  color: player.shuffle ? accentColor : undefined,
                }}
              >
                <span className="flex items-center gap-1.5">
                  <Shuffle size={12.5} />
                  <span>Shuffle</span>
                </span>
                <span className="text-[10.5px] opacity-75">
                  {player.shuffle ? 'On' : 'Off'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => runAndClose(onCycleRepeat)}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
                style={{
                  backgroundColor:
                    player.repeatMode !== 'off'
                      ? hexToRgba(accentColor, 0.11)
                      : undefined,
                  color: player.repeatMode !== 'off' ? accentColor : undefined,
                }}
              >
                <span className="flex items-center gap-1.5">
                  {player.repeatMode === 'one' ? (
                    <Repeat1 size={12.5} />
                  ) : (
                    <Repeat size={12.5} />
                  )}
                  <span>Repeat</span>
                </span>
                <span className="text-[10.5px] uppercase opacity-75">
                  {player.repeatMode}
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => runAndClose(onCycleCrossfade)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 mt-0.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
              style={{
                backgroundColor:
                  settings.crossfadeEnabled !== false
                    ? hexToRgba(accentColor, 0.11)
                    : undefined,
                color:
                  settings.crossfadeEnabled !== false ? accentColor : undefined,
              }}
            >
              <span className="flex items-center gap-2">
                <ArrowRightLeft size={13} />
                <span>Automix Crossfade</span>
              </span>
              <span className="text-[10.5px] font-bold isla-tabular">
                {settings.crossfadeEnabled !== false
                  ? `${Math.round(settings.crossfadeSecs ?? 6)}s`
                  : 'Off'}
              </span>
            </button>

            <div
              className="my-1 h-px"
              style={{ backgroundColor: 'var(--isla-divider)' }}
            />

            {/* Library Quick Actions */}
            <button
              type="button"
              onClick={() => runAndClose(onAddMusicFolder)}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
            >
              <FolderPlus size={13.5} />
              <span>Add Music Folder...</span>
            </button>

            <button
              type="button"
              onClick={() => runAndClose(onImportAudioFiles)}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
            >
              <Plus size={13.5} />
              <span>Import Audio Files...</span>
            </button>

            <div
              className="my-1 h-px"
              style={{ backgroundColor: 'var(--isla-divider)' }}
            />

            {/* Window & Appearance Quick Toggles */}
            <button
              type="button"
              onClick={() => runAndClose(onToggleAlwaysOnTop)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Pin size={13.5} />
                <span>Always on Top</span>
              </span>
              {settings.alwaysOnTop && (
                <Check size={13.5} style={{ color: accentColor }} />
              )}
            </button>

            <button
              type="button"
              onClick={() => runAndClose(onToggleTheme)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2.5">
                {settings.theme === 'dark' ? (
                  <Sun size={13.5} />
                ) : (
                  <Moon size={13.5} />
                )}
                <span>Switch Theme</span>
              </span>
              <span
                className="text-[10.5px] capitalize"
                style={{ color: 'var(--isla-text-secondary)' }}
              >
                {settings.theme}
              </span>
            </button>

            <button
              type="button"
              onClick={() => runAndClose(onOpenSettings)}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
            >
              <Settings size={13.5} />
              <span>Settings...</span>
            </button>

            <div
              className="my-1 h-px"
              style={{ backgroundColor: 'var(--isla-divider)' }}
            />

            <button
              type="button"
              onClick={() => runAndClose(onMinimizeToTray)}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.055] dark:hover:bg-white/[0.08] font-medium cursor-pointer transition-colors"
            >
              <EyeOff size={13.5} />
              <span>Minimize to Tray</span>
            </button>

            <button
              type="button"
              onClick={() => runAndClose(onQuitApplication)}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-rose-500/10 text-rose-500 font-medium cursor-pointer transition-colors"
            >
              <Power size={13.5} />
              <span>Quit Isla</span>
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

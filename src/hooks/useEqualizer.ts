import { useCallback, useEffect, useRef, useState } from 'react';
import type { EqualizerSettings } from '../types/isla';
import { normalizeEqualizer } from '../utils/equalizer';
import { islaBridge } from '../services/bridge';

export function useEqualizer(initial: EqualizerSettings) {
  const [value, setValue] = useState(() => normalizeEqualizer(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const latest = useRef(value);
  const version = useRef(0);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previews = useRef<Promise<void>>(Promise.resolve());
  const saves = useRef<Promise<void>>(Promise.resolve());

  const preview = useCallback((settings: EqualizerSettings, revision: number) => {
    const request = previews.current.catch(() => {}).then(async () => {
      if (revision === version.current) await islaBridge.previewEqualizer(settings);
    });
    previews.current = request;
    return request;
  }, []);

  const persist = useCallback(() => {
    if (previewTimer.current) { clearTimeout(previewTimer.current); previewTimer.current = null; }
    const revision = version.current;
    const settings = latest.current;
    // Attach a rejection handler immediately, even when an older save is still pending.
    const ready = preview(settings, revision).then(() => ({ ok: true as const }), (reason: unknown) => ({ ok: false as const, reason }));
    saves.current = saves.current.catch(() => {}).then(async () => {
      const result = await ready;
      if (!result.ok) throw result.reason;
      if (revision !== version.current) return;
      if (mounted.current) setSaving(true);
      const saved = await islaBridge.saveEqualizer(settings);
      if (revision === version.current) {
        dirty.current = false;
        latest.current = normalizeEqualizer(saved.equalizer);
        if (mounted.current) { setValue(latest.current); setError(null); setPending(false); }
      }
    }).catch((reason: unknown) => { if (mounted.current) setError(String(reason)); })
      .finally(() => { if (mounted.current) setSaving(false); });
  }, [preview]);

  const change = useCallback((next: EqualizerSettings) => {
    latest.current = normalizeEqualizer(next);
    version.current += 1;
    dirty.current = true;
    setValue(latest.current); setError(null); setPending(true);
    if (!previewTimer.current) previewTimer.current = setTimeout(() => {
      previewTimer.current = null;
      void preview(latest.current, version.current).catch((reason: unknown) => { if (mounted.current) setError(String(reason)); });
    }, 40);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 220);
  }, [persist, preview]);

  useEffect(() => {
    if (!dirty.current) { latest.current = normalizeEqualizer(initial); setValue(latest.current); }
  }, [initial]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (previewTimer.current) clearTimeout(previewTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirty.current) persist();
    };
  }, [persist]);

  return { value, change, error, saving, pending, retry: persist };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { islaBridge } from '../services/bridge';
import type { AudioDeviceInfo } from '../types/isla';

export function useAudioOutputs() {
  const [devices,setDevices] = useState<AudioDeviceInfo[]>([]);
  const [refreshing,setRefreshing] = useState(true);
  const [error,setError] = useState<string|null>(null);
  const mounted = useRef(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    if (!mounted.current) return;
    setRefreshing(true);
    try {
      const next = await islaBridge.getAudioOutputDevices();
      if (mounted.current && request === version.current) { setDevices(next); setError(null); }
    } catch {
      if (mounted.current && request === version.current) setError('Cannot refresh audio outputs. Try again.');
    } finally {
      if (mounted.current && request === version.current) setRefreshing(false);
    }
  },[]);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (()=>void)|undefined;
    void (async () => {
      try {
        const stop = await islaBridge.onAudioOutputsChanged((next) => {
          if (disposed) return;
          ++version.current; // A late focus-refresh response must not replace a newer topology event.
          setDevices(next); setRefreshing(false); setError(null);
        });
        if (disposed) { stop(); return; }
        unlisten = stop;
      } catch { /* The snapshot and focus refresh still work if event registration fails. */ }
      // Subscribe before reading the snapshot so a topology change cannot fall between them.
      if (!disposed) await refresh();
    })();
    const focus = () => { void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus',focus);
    document.addEventListener('visibilitychange',visible);
    return () => {
      disposed = true; mounted.current = false; ++version.current;
      unlisten?.(); window.removeEventListener('focus',focus); document.removeEventListener('visibilitychange',visible);
    };
  },[refresh]);
  return { devices,refresh,refreshing,error };
}

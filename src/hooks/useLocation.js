import { useState, useEffect, useCallback, useRef } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

/**
 * Display-only default — the map centres here until the first real GPS fix.
 * Nothing should ever treat this as the driver's position.
 */
const DEFAULT_REGION = [51.5074, -0.1278]; // Central London

/**
 * useLocation — handles iOS permission flow:
 *  1. Request "When In Use" on first load
 *  2. Acquire a real GPS fix as fast as possible (cached fix first, then
 *     high accuracy, then a temporary watch as a last resort)
 *  3. Optionally escalate to continuous watching during rides
 *
 * `hasFix` is true ONLY once real device coordinates have been received —
 * use it to avoid rendering markers/UI at the default region.
 */
export default function useLocation() {
  const [location, setLocation] = useState(DEFAULT_REGION);
  const [hasFix, setHasFix] = useState(false);
  const [locating, setLocating] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState('prompt'); // 'prompt' | 'granted' | 'denied'
  const [error, setError] = useState(null);
  const [watchId, setWatchId] = useState(null);
  const hasFixRef = useRef(false);
  const retryWatchIdRef = useRef(null);

  const applyFix = useCallback((lat, lng) => {
    hasFixRef.current = true;
    setHasFix(true);
    setLocating(false);
    setLocation([lat, lng]);
  }, []);

  // --- Native / web position helpers -------------------------------------

  const getPositionOnce = useCallback((options) => {
    if (Capacitor.isNativePlatform()) {
      return Geolocation.getCurrentPosition(options);
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  }, []);

  /**
   * Acquire a fix fast: try a cached/low-accuracy reading first so the map
   * snaps to the right area immediately, then refine with high accuracy.
   * Throws only if BOTH attempts fail.
   */
  const acquireFix = useCallback(async () => {
    // 1) Fast, possibly cached fix — instant on most devices
    try {
      const quick = await getPositionOnce({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
      applyFix(quick.coords.latitude, quick.coords.longitude);
    } catch {
      // Ignore — the accurate attempt below may still succeed
    }

    // 2) High-accuracy fix — GPS cold start can exceed 10s, allow 20s
    const accurate = await getPositionOnce({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    applyFix(accurate.coords.latitude, accurate.coords.longitude);
  }, [applyFix, getPositionOnce]);

  /**
   * Last resort: watch until the first fix arrives, then stop.
   * Used when one-shot fixes time out (cold GPS, weak signal).
   */
  const startRetryWatch = useCallback(() => {
    if (retryWatchIdRef.current !== null) return;

    const onPosition = (pos) => {
      if (pos?.coords) {
        applyFix(pos.coords.latitude, pos.coords.longitude);
      }
    };

    if (Capacitor.isNativePlatform()) {
      Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
        (pos) => onPosition(pos)
      ).then((id) => {
        // If a fix already landed while we were setting up, clear immediately
        if (hasFixRef.current) {
          Geolocation.clearWatch({ id }).catch(() => {});
        } else {
          retryWatchIdRef.current = id;
        }
      }).catch(() => {});
    } else {
      retryWatchIdRef.current = navigator.geolocation.watchPosition(
        onPosition,
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000 }
      );
    }
  }, [applyFix]);

  const stopRetryWatch = useCallback(() => {
    if (retryWatchIdRef.current === null) return;
    if (Capacitor.isNativePlatform()) {
      Geolocation.clearWatch({ id: retryWatchIdRef.current }).catch(() => {});
    } else {
      navigator.geolocation.clearWatch(retryWatchIdRef.current);
    }
    retryWatchIdRef.current = null;
  }, []);

  // Stop the retry watch as soon as a fix lands
  useEffect(() => {
    if (hasFix) stopRetryWatch();
  }, [hasFix, stopRetryWatch]);

  // --- Permission flow ----------------------------------------------------

  const checkPermission = useCallback(async () => {
    try {
      if (!Capacitor.isNativePlatform()) {
        return 'prompt'; // Web: permission is requested implicitly by getCurrentPosition
      }
      const status = await Geolocation.checkPermissions();
      const loc = status.location;
      setPermissionStatus(loc);
      return loc;
    } catch (e) {
      console.warn('Permission check failed:', e);
      return 'prompt';
    }
  }, []);

  /**
   * Request foreground location ("When In Use") and acquire a fix.
   * Position errors are NOT permission errors — a GPS timeout must not
   * mark the permission as denied.
   */
  const requestPermission = useCallback(async () => {
    setLocating(true);
    try {
      if (Capacitor.isNativePlatform()) {
        const result = await Geolocation.requestPermissions({ permissions: ['location'] });
        setPermissionStatus(result.location);
        if (result.location !== 'granted') {
          setLocating(false);
          return result.location;
        }
      } else {
        setPermissionStatus('granted');
      }

      try {
        await acquireFix();
        return 'granted';
      } catch (posErr) {
        console.warn('Position unavailable, falling back to watch:', posErr);
        startRetryWatch(); // keeps trying in the background until a fix lands
        return 'granted';
      }
    } catch (e) {
      console.error('Location permission error:', e);
      setError(e.message);
      setPermissionStatus('denied');
      setLocating(false);
      return 'denied';
    }
  }, [acquireFix, startRetryWatch]);

  // --- Continuous watching (active rides) ---------------------------------

  const startWatching = useCallback(async () => {
    try {
      if (watchId) return; // Already watching

      const onPosition = (pos, err) => {
        if (pos?.coords) {
          applyFix(pos.coords.latitude, pos.coords.longitude);
        }
        if (err) {
          console.warn('Watch error:', err);
        }
      };

      if (Capacitor.isNativePlatform()) {
        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
          onPosition
        );
        setWatchId(id);
      } else {
        const id = navigator.geolocation.watchPosition(
          onPosition,
          (err) => console.warn('Watch error:', err),
          { enableHighAccuracy: true, maximumAge: 5000 }
        );
        setWatchId(id);
      }
    } catch (e) {
      console.error('Watch position error:', e);
    }
  }, [watchId, applyFix]);

  const stopWatching = useCallback(async () => {
    if (watchId !== null) {
      try {
        if (Capacitor.isNativePlatform()) {
          await Geolocation.clearWatch({ id: watchId });
        } else {
          navigator.geolocation.clearWatch(watchId);
        }
      } catch (e) {
        console.warn('Clear watch error:', e);
      }
      setWatchId(null);
    }
  }, [watchId]);

  // One-shot position refresh (used before ride actions)
  const getCurrentPosition = useCallback(async () => {
    try {
      const pos = await getPositionOnce({ enableHighAccuracy: true, timeout: 20000 });
      applyFix(pos.coords.latitude, pos.coords.longitude);
      return [pos.coords.latitude, pos.coords.longitude];
    } catch (e) {
      console.error('getCurrentPosition error:', e);
      return hasFixRef.current ? location : null;
    }
  }, [location, applyFix, getPositionOnce]);

  // On mount: if permission was granted previously, locate immediately.
  // If not yet asked, request it — the map is the home screen, so asking
  // at launch is the expected native flow.
  useEffect(() => {
    (async () => {
      const status = await checkPermission();
      if (status === 'granted') {
        setLocating(true);
        try {
          await acquireFix();
        } catch {
          startRetryWatch();
        }
      } else if (status === 'prompt') {
        await requestPermission();
      } else {
        setLocating(false); // denied — can't do anything without Settings
      }
    })();

    return () => {
      stopRetryWatch();
      if (watchId !== null) {
        if (Capacitor.isNativePlatform()) {
          Geolocation.clearWatch({ id: watchId }).catch(() => {});
        } else {
          navigator.geolocation.clearWatch(watchId);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    location,          // [lat, lng] — real fix when hasFix, else DEFAULT_REGION
    hasFix,            // true only once real device coordinates exist
    locating,          // true while trying to acquire the first fix
    permissionStatus,
    error,
    requestPermission,
    getCurrentPosition,
    startWatching,
    stopWatching,
    isWatching: watchId !== null
  };
}

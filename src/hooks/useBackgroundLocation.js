import { useCallback, useEffect, useRef, useState } from 'react';
import { registerPlugin } from '@capacitor/core';
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { enqueue, peek, drop, dropForeign, size } from '../lib/locationQueue';

/**
 * Streams the driver's position to `driver_locations` while they are on shift.
 *
 * iOS will not grant "Always" on the first ask — it offers "While Using the
 * App" and only later shows its own upgrade prompt. "While Using" is not enough
 * once the app leaves the screen, so the watcher reports NOT_AUTHORIZED and we
 * surface that to the UI rather than failing silently.
 *
 * Delivery is not assumed to succeed. Every fix is queued first and then
 * flushed, so a dead zone delays the trail instead of losing it. The returned
 * state distinguishes "the GPS is working" from "ops can actually see me" —
 * those are different claims, and reporting the first as the second is how a
 * driver ends up invisible while the app looks healthy.
 *
 * Returns { permissionDenied, isTracking, hasFix, queuedCount, lastSyncedAt,
 * openSettings } so the portal can show the driver what, if anything, to fix.
 */

const BATCH_SIZE = 50;          // rows per insert when draining a backlog
const FLUSH_INTERVAL_MS = 20000; // retry cadence while a backlog exists
const HEARTBEAT_MS = 45000;      // max silence before we re-assert position
const POISON_RETRIES = 3;        // rejections before a batch is given up on

/**
 * True for errors the server will never accept, however many times we retry:
 * Postgres classes 22 (data exception), 23 (integrity constraint) and 42
 * (access/privilege — this is what RLS returns). A batch failing for one of
 * these blocks every point behind it forever, so it has to be dropped.
 * Network failures and 5xx have no such code and are always retried.
 */
function isPermanentRejection(error) {
  return typeof error?.code === 'string' && /^(22|23|42)/.test(error.code);
}

export default function useBackgroundLocation(isActiveDriver = false, activeRideId = null) {
  const { session } = useAuth();
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [hasFix, setHasFix] = useState(false);
  const [uploadHealthy, setUploadHealthy] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const watcherRef = useRef(null);
  const flushingRef = useRef(false);
  const failureCountRef = useRef(0);
  const lastPointRef = useRef(null);   // last row we captured, for heartbeats
  const lastCaptureRef = useRef(0);    // when we last captured anything
  const rideIdRef = useRef(activeRideId);

  useEffect(() => { rideIdRef.current = activeRideId; }, [activeRideId]);

  const openSettings = useCallback(() => {
    BackgroundGeolocation.openSettings();
  }, []);

  const driverId = session?.user?.id ?? null;

  /**
   * Drain the queue oldest-first. Stops on the first failure so ordering is
   * preserved; a batch that keeps failing *while online* is treated as poison
   * and dropped, because a permanently stuck head blocks every later point.
   */
  const flush = useCallback(async () => {
    if (!driverId || flushingRef.current) return;
    flushingRef.current = true;

    try {
      dropForeign(driverId);

      while (size() > 0) {
        const batch = peek(BATCH_SIZE);
        const { error } = await supabase.from('driver_locations').insert(batch);

        if (error) {
          failureCountRef.current += 1;
          setUploadHealthy(false);

          if (isPermanentRejection(error) && failureCountRef.current >= POISON_RETRIES) {
            // Rejected on its merits, not by the network — dropping the head is
            // the only way to let the rest of the trail through. A transient
            // outage never lands here, so real points are not thrown away.
            console.error('Dropping undeliverable location batch', error);
            drop(batch.length);
            failureCountRef.current = 0;
            continue;
          }
          break;
        }

        drop(batch.length);
        failureCountRef.current = 0;
        setUploadHealthy(true);
        setLastSyncedAt(Date.now());
      }
    } catch (err) {
      // Never let a delivery problem escape into the GPS callback.
      console.error('Location flush failed', err);
      setUploadHealthy(false);
    } finally {
      flushingRef.current = false;
      setQueuedCount(size());
    }
  }, [driverId]);

  const record = useCallback((row) => {
    lastPointRef.current = row;
    lastCaptureRef.current = Date.now();
    setQueuedCount(enqueue(row));
    flush();
  }, [flush]);

  // --- Watcher lifecycle ---------------------------------------------------

  useEffect(() => {
    if (!driverId || !isActiveDriver) {
      if (watcherRef.current) {
        BackgroundGeolocation.removeWatcher({ id: watcherRef.current });
        watcherRef.current = null;
      }
      setHasFix(false);
      // Going off shift is not a permission problem — clear any stale warning.
      setPermissionDenied(false);
      return;
    }

    let cancelled = false;

    const startTracking = async () => {
      try {
        const id = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: 'Sharing your location with your passenger. Keep ELS Driver running.',
            backgroundTitle: 'On Shift — ELS Driver',
            requestPermissions: true,
            stale: false,
            distanceFilter: 10, // Update every 10 meters
          },
          (location, error) => {
            if (error) {
              if (error.code === 'NOT_AUTHORIZED') {
                setPermissionDenied(true);
                setHasFix(false);
              }
              console.error(error);
              return;
            }

            if (!location) return;

            setPermissionDenied(false);
            setHasFix(true);

            record({
              driver_id: driverId,
              ride_id: rideIdRef.current || null,
              // PostGIS geography point format: POINT(lon lat)
              coords: `POINT(${location.longitude} ${location.latitude})`,
              heading: location.bearing || 0,
              speed_mph: (location.speed || 0) * 2.23694, // m/s to mph
              // Capture time, not insert time — a replayed point must land in
              // the trail where it actually happened.
              recorded_at: new Date(location.time || Date.now()).toISOString(),
            });
          }
        );

        if (cancelled) {
          BackgroundGeolocation.removeWatcher({ id });
          return;
        }
        watcherRef.current = id;
      } catch (err) {
        console.error('Background tracking setup failed', err);
        setPermissionDenied(true);
      }
    };

    startTracking();

    return () => {
      cancelled = true;
      if (watcherRef.current) {
        BackgroundGeolocation.removeWatcher({ id: watcherRef.current });
        watcherRef.current = null;
      }
    };
  }, [driverId, isActiveDriver, record]);

  // --- Delivery: retry backlog, heartbeat, reconnect ------------------------

  useEffect(() => {
    if (!driverId || !isActiveDriver) return;

    setQueuedCount(size());
    flush(); // drain anything left over from a previous run

    const retry = setInterval(() => { if (size() > 0) flush(); }, FLUSH_INTERVAL_MS);

    // A stationary car emits no GPS callbacks at a 10m filter, which is
    // indistinguishable from a dead phone. Re-assert the last known position
    // so silence always means something is actually wrong.
    const heartbeat = setInterval(() => {
      const last = lastPointRef.current;
      if (!last) return;
      if (Date.now() - lastCaptureRef.current < HEARTBEAT_MS) return;
      record({ ...last, ride_id: rideIdRef.current || null, recorded_at: new Date().toISOString() });
    }, HEARTBEAT_MS);

    const onOnline = () => { failureCountRef.current = 0; flush(); };
    window.addEventListener('online', onOnline);

    return () => {
      clearInterval(retry);
      clearInterval(heartbeat);
      window.removeEventListener('online', onOnline);
    };
  }, [driverId, isActiveDriver, flush, record]);

  return {
    permissionDenied,
    // Honest: the GPS is producing fixes AND they are reaching the server.
    isTracking: hasFix && uploadHealthy,
    hasFix,
    queuedCount,
    lastSyncedAt,
    openSettings,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { registerPlugin } from '@capacitor/core';
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

/**
 * Streams the driver's position to `driver_locations` while they are on shift.
 *
 * iOS will not grant "Always" on the first ask — it offers "While Using the
 * App" and only later shows its own upgrade prompt. "While Using" is not enough
 * once the app leaves the screen, so the watcher reports NOT_AUTHORIZED and we
 * surface that to the UI rather than failing silently.
 *
 * Returns { permissionDenied, isTracking, openSettings } so the portal can show
 * the driver what to fix.
 */
export default function useBackgroundLocation(isActiveDriver = false, activeRideId = null) {
  const { session } = useAuth();
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const watcherRef = useRef(null);

  const openSettings = useCallback(() => {
    BackgroundGeolocation.openSettings();
  }, []);

  useEffect(() => {
    if (!session?.user?.id || !isActiveDriver) {
      if (watcherRef.current) {
        BackgroundGeolocation.removeWatcher({ id: watcherRef.current });
        watcherRef.current = null;
      }
      setIsTracking(false);
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
          async (location, error) => {
            if (error) {
              if (error.code === 'NOT_AUTHORIZED') {
                setPermissionDenied(true);
                setIsTracking(false);
              }
              console.error(error);
              return;
            }

            if (location) {
              setPermissionDenied(false);
              setIsTracking(true);

              // PostGIS geography point format: POINT(lon lat)
              const pointStr = `POINT(${location.longitude} ${location.latitude})`;

              await supabase.from('driver_locations').insert({
                driver_id: session.user.id,
                ride_id: activeRideId || null,
                coords: pointStr,
                heading: location.bearing || 0,
                speed_mph: (location.speed || 0) * 2.23694, // m/s to mph
              });
            }
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
  }, [session, isActiveDriver, activeRideId]);

  return { permissionDenied, isTracking, openSettings };
}

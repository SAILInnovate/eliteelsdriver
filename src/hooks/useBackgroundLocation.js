import { useEffect, useState } from 'react';
import { registerPlugin } from '@capacitor/core';
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function useBackgroundLocation(isActiveDriver = false, activeRideId = null) {
  const { session } = useAuth();
  const [watcherId, setWatcherId] = useState(null);

  useEffect(() => {
    if (!session?.user?.id || !isActiveDriver) {
      if (watcherId) {
        BackgroundGeolocation.removeWatcher({ id: watcherId });
        setWatcherId(null);
      }
      return;
    }

    let id = null;

    const startTracking = async () => {
      try {
        id = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: "Elite ELS is tracking your location to update your passenger.",
            backgroundTitle: "Elite Driver Active",
            requestPermissions: true,
            stale: false,
            distanceFilter: 10, // Update every 10 meters
          },
          async (location, error) => {
            if (error) {
              if (error.code === "NOT_AUTHORIZED") {
                if (window.confirm("Location access is required for active drivers. Open settings?")) {
                  BackgroundGeolocation.openSettings();
                }
              }
              console.error(error);
              return;
            }

            if (location) {
              // PostGIS geography point format: POINT(lon lat)
              const pointStr = `POINT(${location.longitude} ${location.latitude})`;
              
              // We'll call a stored procedure or just insert into driver_locations if PostGIS understands the string.
              // Often, Supabase requires calling an RPC for PostGIS, but let's try direct insert as text if allowed, 
              // or just update a standard lat/lng table. 
              // Assuming driver_locations table handles the coords if we send it as WKT string
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
        setWatcherId(id);
      } catch (err) {
        console.error("Background tracking setup failed", err);
      }
    };

    startTracking();

    return () => {
      if (id) {
        BackgroundGeolocation.removeWatcher({ id });
      }
    };
  }, [session, isActiveDriver, activeRideId]);

  return watcherId;
}

import { useEffect, useRef } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/**
 * Registers the device for push and keeps the token on the driver's row.
 *
 * Two callbacks, because a push on its own isn't enough for a driver:
 *   onReceived — the push landed while the app was open. iOS shows nothing
 *                in that case, so the caller raises its own in-app toast.
 *   onOpened   — the driver tapped the push from the lock screen or banner;
 *                the caller decides which screen that should open.
 */
export default function usePushNotifications({ onReceived, onOpened } = {}) {
  const { session } = useAuth();
  // Held in refs so a re-created callback never tears down the listeners
  const receivedRef = useRef(onReceived);
  const openedRef = useRef(onOpened);
  receivedRef.current = onReceived;
  openedRef.current = onOpened;

  useEffect(() => {
    // Push notifications are only available on physical devices natively.
    if (!session?.user?.id || Capacitor.getPlatform() === 'web') return;

    const registerPush = async () => {
      let permStatus = await PushNotifications.checkPermissions();

      if (permStatus.receive === 'prompt') {
        permStatus = await PushNotifications.requestPermissions();
      }

      if (permStatus.receive !== 'granted') {
        console.warn('User denied push notification permissions');
        return;
      }

      await PushNotifications.register();
    };

    const addListeners = async () => {
      await PushNotifications.addListener('registration', async (token) => {
        // The apns-topic must be the bundle the token was minted under, and
        // driver + passenger tokens both land in global_users — so record it.
        let bundleId = null;
        try { bundleId = (await App.getInfo()).id; } catch (_) { bundleId = null; }
        console.log('Push registration success, token: ' + token.value);
        // Through save_push_token(), not a table write: global_users has no
        // self-UPDATE policy (and must not have one — it holds `role`), so a
        // direct update is silently reduced to zero rows by RLS for everyone
        // who isn't an admin, with no error to log. Every driver token was
        // lost that way. The RPC says what happened.
        const { data, error } = await supabase.rpc('save_push_token', {
          p_token: token.value,
          p_platform: Capacitor.getPlatform(),
          p_bundle_id: bundleId,
        });

        if (error) {
          console.error('Error saving push token', error);
        } else if (data && data.saved === false) {
          console.error('Push token not saved:', data.reason);
        }
      });

      await PushNotifications.addListener('registrationError', (err) => {
        console.error('Push registration error: ', err.error);
      });

      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        // Foreground push: the system banner is suppressed, so hand it up.
        try { receivedRef.current?.(notification); } catch (e) { console.warn('push received handler failed', e); }
      });

      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        try { openedRef.current?.(action?.notification, action); } catch (e) { console.warn('push open handler failed', e); }
      });
    };

    registerPush();
    addListeners();

    return () => {
      PushNotifications.removeAllListeners();
    };
  }, [session]);
}

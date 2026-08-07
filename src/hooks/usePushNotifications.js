import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Capacitor } from '@capacitor/core';

export default function usePushNotifications() {
  const { session } = useAuth();

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
        console.log('Push registration success, token: ' + token.value);
        // Save the device token to Supabase for this user
        const { error } = await supabase.from('global_users').update({
          push_token: token.value
        }).eq('id', session.user.id);
        
        if (error) {
           console.error('Error saving push token', error);
        }
      });

      await PushNotifications.addListener('registrationError', (err) => {
        console.error('Push registration error: ', err.error);
      });

      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push received: ', notification);
        // You can show a local toast here if the app is open
      });

      await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        console.log('Push action performed: ', notification.actionId, notification.inputValue);
        // Navigate to specific ride or chat based on payload
      });
    };

    registerPush();
    addListeners();

    return () => {
      PushNotifications.removeAllListeners();
    };
  }, [session]);
}

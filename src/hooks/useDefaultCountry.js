import { useState, useEffect } from 'react';

export default function useDefaultCountry() {
    const [country, setCountry] = useState('US');

    useEffect(() => {
        const detectCountry = async () => {
            // 1. Instant Local Timezone Check (Works offline & instantly on native)
            try {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
                if (tz) {
                    if (tz.includes('London') || tz.includes('Belfast') || tz === 'Europe/London') { setCountry('GB'); return; }
                    if (tz.includes('Sydney') || tz.includes('Melbourne')) { setCountry('AU'); return; }
                    if (tz.includes('Toronto') || tz.includes('Vancouver')) { setCountry('CA'); return; }
                    if (tz.includes('Dublin')) { setCountry('IE'); return; }
                    // If it is America/New_York etc, we can let it be US.
                }
            } catch (e) {
                console.log('Timezone detection failed', e);
            }

            // 2. Permissive IP APIs that do not block Capacitor origins (capacitor://localhost)
            try {
                const res = await fetch('https://api.country.is');
                const data = await res.json();
                if (data.country) {
                    setCountry(data.country.toUpperCase());
                    return;
                }
            } catch (e) {
                console.log('API 1 Failed', e);
            }

            try {
                const res = await fetch('https://ipwho.is/');
                const data = await res.json();
                if (data.country_code) {
                    setCountry(data.country_code.toUpperCase());
                    return;
                }
            } catch (e) {
                console.log('API 2 Failed', e);
            }

            // 3. Last Resort Fallback (Device Language)
            try {
                const userLang = navigator.language || (navigator.languages && navigator.languages[0]);
                if (userLang && userLang.includes('-')) {
                    const code = userLang.split('-')[1].toUpperCase();
                    if (code && code.length === 2) {
                        setCountry(code);
                    }
                }
            } catch (e) { }
        };

        detectCountry();
    }, []);

    return country;
}

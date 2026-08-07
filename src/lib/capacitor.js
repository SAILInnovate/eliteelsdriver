/**
 * Capacitor native utilities with web fallbacks.
 * These helpers use Capacitor plugins when running natively,
 * and fall back to web APIs in the browser.
 */

import { Capacitor } from '@capacitor/core';

export async function triggerHaptic(style = 'medium') {
    try {
        const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
        const map = {
            light: ImpactStyle.Light,
            medium: ImpactStyle.Medium,
            heavy: ImpactStyle.Heavy,
        };
        await Haptics.impact({ style: map[style] || ImpactStyle.Medium });
    } catch {
        // Web fallback
        if (navigator.vibrate) {
            const durations = { light: 10, medium: 25, heavy: 50 };
            navigator.vibrate(durations[style] || 25);
        }
    }
}

export async function triggerNotificationHaptic() {
    try {
        const { Haptics, NotificationType } = await import('@capacitor/haptics');
        await Haptics.notification({ type: NotificationType.Success });
    } catch {
        if (navigator.vibrate) {
            navigator.vibrate([50, 30, 50]);
        }
    }
}

export async function triggerSelectionHaptic() {
    try {
        const { Haptics } = await import('@capacitor/haptics');
        await Haptics.selectionStart();
        await Haptics.selectionChanged();
    } catch {
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
    }
}

export async function openExternalUrl(url) {
    try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
    } catch {
        window.open(url, '_blank');
    }
}

/**
 * OFFICE CONTACT
 * The ELS landline is no longer monitored — every inbound contact route in the
 * app goes to the office WhatsApp line instead. Never add a `tel:` link to the
 * office; drivers should only ever be pointed at WhatsApp.
 */
export const OFFICE_WHATSAPP = '447540723250';
export const OFFICE_WHATSAPP_DISPLAY = '+44 7540 723250';

export function openWhatsApp(message) {
    const url = `https://wa.me/${OFFICE_WHATSAPP}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
    // '_system' hands the link to the OS (same pattern as the nav app deep
    // links), so WhatsApp itself opens rather than a webview showing wa.me.
    window.open(url, '_system');
}

export async function shareLink({ title, text, url }) {
    try {
        const { Share } = await import('@capacitor/share');
        const shareOptions = { title, text, dialogTitle: title };
        // On iOS, if url is provided it's often appended to the text automatically.
        // If the text already includes the url, don't pass it separately to avoid duplicates.
        if (url && !text.includes(url)) {
            shareOptions.url = url;
        }
        await Share.share(shareOptions);
        return true;
    } catch (err) {
        // Fallback to web share or silent failure
        if (navigator.share) {
            try {
                await navigator.share({ title, text, url });
                return true;
            } catch (webErr) {
                console.error('Web Share failed', webErr);
            }
        }
        return false;
    }
}

export function isNativePlatform() {
    return Capacitor.isNativePlatform();
}

/**
 * REVENUECAT / PURCHASES
 */
let isPurchasesConfigured = false;

export async function configurePurchases(userId) {
    if (!isNativePlatform()) return;
    if (isPurchasesConfigured) return;

    try {
        const { Purchases } = await import('@revenuecat/purchases-capacitor');
        await Purchases.configure({ apiKey: "appl_qebRpSqbmbkbZMnVxEUrIgwhXdj" });
        if (userId) await Purchases.logIn({ appUserID: userId });
        isPurchasesConfigured = true;
        console.log("RevenueCat Configured");
    } catch (err) {
        console.error("RevenueCat Configuration Error:", err);
    }
}

export async function getProStatus() {
    if (!isNativePlatform()) return false;
    try {
        const { Purchases } = await import('@revenuecat/purchases-capacitor');
        const { customerInfo } = await Purchases.getCustomerInfo();
        return typeof customerInfo.entitlements.active['pro'] !== "undefined";
    } catch (err) {
        console.error("Error getting Pro status:", err);
        return false;
    }
}

export async function purchasePro(userId) {
    if (!isNativePlatform()) return null;
    try {
        const { Purchases } = await import('@revenuecat/purchases-capacitor');
        await configurePurchases(userId);

        // Use Offerings (Recommended by RevenueCat)
        const { offerings } = await Purchases.getOfferings();

        if (offerings.current && offerings.current.monthly) {
            const { customerInfo } = await Purchases.purchasePackage({ aPackage: offerings.current.monthly });
            return typeof customerInfo.entitlements.active['pro'] !== "undefined";
        } else {
            // Fallback to direct product purchase if offerings aren't set up
            const { customerInfo } = await Purchases.purchaseProduct({
                productIdentifier: 'clinch_pro_monthly'
            });
            return typeof customerInfo.entitlements.active['pro'] !== "undefined";
        }
    } catch (err) {
        console.error("Purchase error detail:", err);
        throw err;
    }
}

export async function restoreProPurchases(userId) {
    if (!isNativePlatform()) return false;
    try {
        const { Purchases } = await import('@revenuecat/purchases-capacitor');
        await configurePurchases(userId);
        const { customerInfo } = await Purchases.restorePurchases();
        return typeof customerInfo.entitlements.active['pro'] !== "undefined";
    } catch (err) {
        console.error("Restore error:", err);
        return false;
    }
}

export async function showNativeManageSubscriptions() {
    if (!isNativePlatform()) return;
    try {
        const { Purchases } = await import('@revenuecat/purchases-capacitor');
        await Purchases.showManageSubscriptions();
    } catch (err) {
        console.error("Error showing manage subs:", err);
    }
}

/**
 * CONTACT PICKER
 * Pulls up native contacts to select a phone number.
 */
export async function pickContactNumber() {
    // 1. Try Capgo Native Contacts (SPM Compatible)
    if (isNativePlatform()) {
        try {
            const { CapacitorContacts } = await import('@capgo/capacitor-contacts');
            const result = await CapacitorContacts.pickContact({
                fields: ['fullName', 'phoneNumbers']
            });

            if (result.contacts && result.contacts.length > 0) {
                const contact = result.contacts[0];
                // Cache this contact immediately too
                saveContactsToCache(result.contacts);
                if (contact.phoneNumbers && contact.phoneNumbers.length > 0) {
                    return contact.phoneNumbers[0].value;
                }
            }
        } catch (nativeErr) {
            console.warn("Native contacts failed, trying web fallback...", nativeErr);
        }
    }

    // 2. Try Web Contact Picker API (Chrome for Android, etc)
    if ('contacts' in navigator && 'ContactsManager' in window) {
        try {
            const props = ['tel'];
            const opts = { multiple: false };
            const contacts = await navigator.contacts.select(props, opts);
            if (contacts.length > 0 && contacts[0].tel && contacts[0].tel.length > 0) {
                return contacts[0].tel[0];
            }
        } catch (webErr) {
            console.error("Web contacts picker failed:", webErr);
        }
    }

    return null;
}

/**
 * CONTACTS SYNC & CACHE
 * Fetches all contacts and saves them for fast searching.
 */
export async function syncContacts() {
    if (!isNativePlatform()) return [];
    try {
        const { CapacitorContacts } = await import('@capgo/capacitor-contacts');

        // Request permission explicitly
        const status = await CapacitorContacts.requestPermissions();
        if (status.readContacts !== 'granted') return [];

        const result = await CapacitorContacts.getContacts({
            fields: ['fullName', 'phoneNumbers']
        });

        if (result.contacts) {
            saveContactsToCache(result.contacts);
            return result.contacts;
        }
    } catch (err) {
        console.error("Sync contacts failed:", err);
    }
    return [];
}

function saveContactsToCache(newContacts) {
    try {
        const existing = JSON.parse(localStorage.getItem('clinch_contacts_cache') || '[]');
        // Merge and de-dupe by ID
        const map = new Map();
        existing.forEach(c => map.set(c.id, c));
        newContacts.forEach(c => map.set(c.id, c));

        const merged = Array.from(map.values());
        localStorage.setItem('clinch_contacts_cache', JSON.stringify(merged));
        localStorage.setItem('clinch_contacts_last_sync', Date.now().toString());
    } catch (e) {
        console.error("Cache save failed:", e);
    }
}

export function searchCachedContacts(query) {
    if (!query || query.length < 2) return [];
    try {
        const cache = JSON.parse(localStorage.getItem('clinch_contacts_cache') || '[]');
        const q = query.toLowerCase();
        return cache.filter(c =>
            (c.fullName && c.fullName.toLowerCase().includes(q)) ||
            (c.phoneNumbers && c.phoneNumbers.some(p => p.value.includes(q)))
        ).slice(0, 5); // Return top 5 matches
    } catch {
        return [];
    }
}

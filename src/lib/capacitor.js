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

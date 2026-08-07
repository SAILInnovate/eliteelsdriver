import NavBar from '../components/NavBar';
import BottomNav from '../components/BottomNav';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { triggerHaptic, isNativePlatform, triggerNotificationHaptic, configurePurchases, getProStatus, purchasePro, restoreProPurchases, showNativeManageSubscriptions } from '../lib/capacitor';
import MenuDrawer from '../components/MenuDrawer';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import Toast from '../components/Toast';

export default function SettingsPage() {
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);
    const { user } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [isPurchasing, setIsPurchasing] = useState(false);
    const [isPro, setIsPro] = useState(false);
    const [toast, setToast] = useState(null);
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(user?.user_metadata?.full_name || '');
    const [savingName, setSavingName] = useState(false);

    // Initialize RevenueCat and fetch Pro status when Settings Page loads
    // Also check Supabase as a fallback so the upgrade card hides correctly
    useEffect(() => {
        async function initAndFetch() {
            let proFound = false;

            // 1. Check RevenueCat on native
            if (isNativePlatform()) {
                await configurePurchases(user?.id);
                proFound = await getProStatus();
                console.log('[Pro Check] RevenueCat result:', proFound);
            }

            // 2. Always check Supabase as a fallback (native + web)
            if (!proFound && user) {
                try {
                    console.log('[Pro Check] Checking Supabase for user:', user.id);
                    const { data, error } = await supabase.from('user_subscriptions').select('tier').eq('user_id', user.id).single();
                    console.log('[Pro Check] Supabase result:', data, 'error:', error);
                    if (data?.tier === 'pro') proFound = true;
                } catch (err) {
                    console.error("Supabase sub fetch error:", err);
                }
            }

            console.log('[Pro Check] Final isPro:', proFound);
            setIsPro(proFound);
        }
        initAndFetch();
    }, [user]);

    const handlePurchase = async () => {
        setIsPurchasing(true);

        if (isNativePlatform()) {
            try {
                triggerHaptic('medium');
                const success = await purchasePro(user?.id);
                if (success) {
                    setIsPro(true);
                    triggerNotificationHaptic();
                    setToast({ type: 'success', message: 'Success! You are now a Clinch+ Pro user.' });
                }
            } catch (e) {
                if (!e.userCancelled) {
                    console.error("Purchase error: ", e);
                    setToast({ type: 'error', message: "Purchase failed: " + e.message });
                }
            } finally {
                setIsPurchasing(false);
            }
        } else {
            // WEB STRIPE FALLBACK
            try {
                // Call Supabase Edge Function to generate the Stripe Checkout Session URL
                const { data, error } = await supabase.functions.invoke('create-checkout-session', {
                    body: { userId: user.id }
                });

                if (error) throw error;
                if (data && data.url) {
                    window.location.href = data.url; // Redirect to Stripe
                } else {
                    alert('Could not connect to Stripe.');
                }
            } catch (err) {
                console.error(err);
                alert('Checkout is currently unavailable.');
            } finally {
                setIsPurchasing(false);
            }
        }
    };

    return (
        <div className="app-wrapper">
            <NavBar onMenuClick={() => setMenuOpen(true)} />

            <div className="scroll-content">
                <div className="app-content" style={{ padding: '24px' }}>
                    <h1 style={{ color: '#008080', marginBottom: '8px' }}>Settings</h1>
                    <p style={{ color: '#666', marginBottom: '24px' }}>Manage your account and preferences.</p>

                    <div style={{ background: 'var(--color-white)', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
                        <h3 style={{ marginBottom: '16px', color: 'var(--color-text)' }}>Profile</h3>
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ fontSize: '13px', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>Name</label>
                            {editingName ? (
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        value={nameValue}
                                        onChange={(e) => setNameValue(e.target.value)}
                                        style={{
                                            flex: 1, padding: '8px 12px', borderRadius: '10px',
                                            border: '1px solid var(--color-gray-200)', fontSize: '15px',
                                            fontWeight: '600', outline: 'none'
                                        }}
                                        autoFocus
                                    />
                                    <button
                                        disabled={savingName}
                                        onClick={async () => {
                                            setSavingName(true);
                                            try {
                                                const { error } = await supabase.auth.updateUser({
                                                    data: { full_name: nameValue.trim() }
                                                });
                                                if (error) throw error;
                                                setEditingName(false);
                                                setToast({ type: 'success', message: 'Name updated! ✅' });
                                            } catch (err) {
                                                setToast({ type: 'error', message: 'Failed to update name.' });
                                            } finally {
                                                setSavingName(false);
                                            }
                                        }}
                                        style={{
                                            padding: '8px 16px', borderRadius: '10px',
                                            background: 'var(--color-teal)', color: 'white',
                                            fontWeight: '700', border: 'none', cursor: 'pointer',
                                            fontSize: '14px'
                                        }}
                                    >
                                        {savingName ? '...' : 'Save'}
                                    </button>
                                    <button
                                        onClick={() => { setEditingName(false); setNameValue(user?.user_metadata?.full_name || ''); }}
                                        style={{
                                            padding: '8px 12px', borderRadius: '10px',
                                            background: 'var(--color-gray-100)', color: 'var(--color-text-secondary)',
                                            fontWeight: '600', border: 'none', cursor: 'pointer',
                                            fontSize: '14px'
                                        }}
                                    >
                                        ✕
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ fontWeight: 600 }}>{user?.user_metadata?.full_name || 'Not set'}</div>
                                    <button
                                        onClick={() => setEditingName(true)}
                                        style={{
                                            padding: '4px 12px', borderRadius: '8px',
                                            background: 'var(--color-gray-100)', color: 'var(--color-teal)',
                                            fontWeight: '700', border: 'none', cursor: 'pointer',
                                            fontSize: '13px'
                                        }}
                                    >
                                        Edit
                                    </button>
                                </div>
                            )}
                        </div>
                        <div>
                            <label style={{ fontSize: '13px', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>Phone Number</label>
                            <div style={{ fontWeight: 600 }}>{user?.phone || 'Not set'}</div>
                        </div>
                    </div>

                    {/* CLINCH+ UPGRADE CARD */}
                    {!isPro ? (
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 20 }}
                            style={{
                                background: 'linear-gradient(135deg, #1f2937 0%, #FFFFFF827 100%)',
                                padding: '24px',
                                borderRadius: '16px',
                                boxShadow: '0 12px 30px rgba(0,0,0,0.15)',
                                marginBottom: '16px',
                                color: 'white',
                                position: 'relative',
                                overflow: 'hidden'
                            }}
                        >
                            <div style={{ position: 'absolute', top: '-20px', right: '-20px', width: '100px', height: '100px', background: 'rgba(0,128,128,0.2)', filter: 'blur(30px)', borderRadius: '50%' }}></div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '800', background: 'linear-gradient(90deg, #98FF98, #008080)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                                        Clinch+ Pro
                                    </h3>
                                    <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#9CA3AF' }}>For Freelancers & Sellers</p>
                                </div>
                                <div style={{ fontSize: '18px', fontWeight: '700', color: '#fff' }}>£9.99<span style={{ fontSize: '12px', color: '#9CA3AF', fontWeight: 'normal' }}>/mo</span></div>
                            </div>

                            <ul style={{ padding: 0, margin: '0 0 20px 0', listStyle: 'none', fontSize: '14px', lineHeight: '1.6' }}>
                                <li style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <span style={{ color: '#98FF98' }}>✓</span> Auto-Send SMS Reminders
                                </li>
                                <li style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <span style={{ color: '#98FF98' }}>✓</span> Export to PDF via Email
                                </li>
                                <li style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <span style={{ color: '#98FF98' }}>✓</span> Premium 'Verified' Gold Badge
                                </li>
                                <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ color: '#98FF98' }}>✓</span> File dispute resolution Engine
                                </li>
                            </ul>

                            <button
                                onClick={handlePurchase}
                                disabled={isPurchasing}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    background: isPurchasing ? '#e5e7eb' : 'white',
                                    color: isPurchasing ? '#9ca3af' : '#FFFFFF827',
                                    border: 'none',
                                    borderRadius: '12px',
                                    fontWeight: '700',
                                    fontSize: '15px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}
                            >
                                <span>
                                    {isPurchasing
                                        ? 'Processing...'
                                        : isNativePlatform() ? 'Upgrade with Apple Pay' : 'Upgrade via Stripe'}
                                </span>
                                {!isPurchasing && <span style={{ fontSize: '18px' }}>⚡</span>}
                            </button>
                        </motion.div>
                    ) : (
                        <div style={{ background: 'var(--color-white)', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', marginBottom: '16px', textAlign: 'center' }}>
                            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🏅</div>
                            <h3 style={{ color: '#D4AF37' }}>Clinch+ Pro Active</h3>
                            <button
                                className="btn-secondary"
                                style={{ marginTop: '16px', width: '100%', fontSize: '14px', background: '#f8f9fa' }}
                                onClick={async () => {
                                    try {
                                        triggerHaptic('light');
                                        if (isNativePlatform()) {
                                            await showNativeManageSubscriptions();
                                        } else {
                                            // Handle opening the Stripe Customer Billing Portal for Web users
                                            setToast({ type: 'success', message: 'Redirecting to your Stripe Billing Portal...' });
                                            const { data, error } = await supabase.functions.invoke('create-portal-session', {
                                                body: { userId: user.id }
                                            });
                                            if (error) throw error;
                                            if (data && data.url) {
                                                window.location.href = data.url;
                                            }
                                        }
                                    } catch (err) {
                                        console.error('Error opening manage subs:', err);
                                        setToast({ type: 'error', message: 'Could not open subscription manager.' });
                                    }
                                }}
                            >
                                Manage Subscription
                            </button>
                        </div>
                    )}

                    <div style={{ background: 'var(--color-white)', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
                        <h3 style={{ marginBottom: '16px', color: 'var(--color-text)' }}>Purchases</h3>
                        <button
                            className="btn-secondary"
                            style={{ width: '100%', fontSize: '14px' }}
                            onClick={async () => {
                                try {
                                    triggerHaptic('light');
                                    setIsPurchasing(true);
                                    if (isNativePlatform()) {
                                        const success = await restoreProPurchases(user?.id);
                                        if (success) {
                                            setIsPro(true);
                                            setToast({ type: 'success', message: 'Pro unlocked! welcome back.' });
                                        } else {
                                            setToast({ type: 'error', message: 'No active pro subscription found.' });
                                        }
                                    } else {
                                        setToast({ type: 'info', message: 'Restore purchases is only available on iOS.' });
                                    }
                                } catch (e) {
                                    setToast({ type: 'error', message: 'Failed to restore purchases.' });
                                } finally {
                                    setIsPurchasing(false);
                                }
                            }}
                        >
                            {isPurchasing ? 'Restoring...' : 'Restore Purchases'}
                        </button>
                    </div>

                    <div style={{ background: 'var(--color-white)', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
                        <h3 style={{ marginBottom: '16px', color: 'var(--color-text)' }}>Notifications</h3>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--color-text)' }}>
                            <span>SMS Alerts</span>
                            <div style={{ width: '40px', height: '24px', background: '#30D158', borderRadius: '12px', position: 'relative' }}>
                                <div style={{ width: '20px', height: '20px', background: '#fff', borderRadius: '50%', position: 'absolute', top: '2px', right: '2px' }}></div>
                            </div>
                        </div>
                    </div>

                    <div style={{ background: 'var(--color-white)', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
                        <h3 style={{ marginBottom: '16px', color: 'var(--color-text)' }}>Display</h3>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--color-text)' }}>Dark Mode</span>
                            <div
                                onClick={() => {
                                    triggerHaptic('light');
                                    toggleTheme();
                                }}
                                style={{
                                    width: '40px',
                                    height: '24px',
                                    background: theme === 'dark' ? '#30D158' : '#E5E5EA',
                                    borderRadius: '12px',
                                    position: 'relative',
                                    cursor: 'pointer',
                                    transition: 'background 0.3s'
                                }}
                            >
                                <div style={{
                                    width: '20px',
                                    height: '20px',
                                    background: '#fff',
                                    borderRadius: '50%',
                                    position: 'absolute',
                                    top: '2px',
                                    left: theme === 'dark' ? '18px' : '2px',
                                    transition: 'left 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                }}></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <BottomNav currentTab={null} onChangeTab={(tab) => navigate(`/?tab=${tab}`)} />

            {menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} />}
            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}

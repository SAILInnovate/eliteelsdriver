import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import NavBar from '../components/NavBar';
import PromiseCard from '../components/PromiseCard';
import VaultSection from '../components/VaultSection';
import SentConfirmation from '../components/SentConfirmation';
import MenuDrawer from '../components/MenuDrawer';
import Toast from '../components/Toast';
import BottomNav from '../components/BottomNav';
import NetworkTab from '../components/NetworkTab';
import VerificationBadge from '../components/VerificationBadge';
import CountUp from 'react-countup';
import TabsView from '../components/TabsView';
import { supabase } from '../lib/supabase';
import { trackEvent } from '../lib/posthog';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import DriverApp from '../components/DriverApp';

export default function DashboardPage() {
    const location = useLocation();
    const [menuOpen, setMenuOpen] = useState(false);
    const [currentTab, setCurrentTab] = useState(() => {
        const params = new URLSearchParams(location.search);
        return params.get('tab') || 'home';
    });
    const [sent, setSent] = useState(false);
    const [sentPhone, setSentPhone] = useState('');
    const [sentUrl, setSentUrl] = useState('');
    const [toast, setToast] = useState(null);

    const { user, updateProfileName } = useAuth();
    const [settingUpProfile, setSettingUpProfile] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [clinches, setClinches] = useState([]);
    const [loadingClinches, setLoadingClinches] = useState(true);
    const [isPro, setIsPro] = useState(false);
    const [showBadge, setShowBadge] = useState(false);
    const [successCount, setSuccessCount] = useState(0);
    const [tabs, setTabs] = useState([]);

    useEffect(() => {
        if (user && !user.user_metadata?.full_name) {
            setSettingUpProfile(true);
        }
    }, [user]);

    // Sync currentTab if location changes (e.g., from MenuDrawer navigation)
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tabParam = params.get('tab');
        if (tabParam) {
            setCurrentTab(tabParam);
        }
    }, [location.search]);

    useEffect(() => {
        async function fetchClinches() {
            if (!user) return;
            try {
                // 1. Fix the Supabase '+' quirk. Auth strips the '+', but UI saves it!
                const rawPhone = user?.phone || 'none';
                const cleanPhone = rawPhone.replace('+', '');

                // 2. We search for the sender's UUID, or the recipient phone with OR without the + 
                const { data, error } = await supabase
                    .from('clinches')
                    .select('*')
                    .or(`sender_id.eq.${user.id},recipient_phone.eq.+${cleanPhone},recipient_phone.eq.${cleanPhone}`)
                    .order('created_at', { ascending: false });

                if (error) throw error;
                const fetchedClinches = data || [];
                setClinches(fetchedClinches);

                const count = fetchedClinches.filter(c => c.status === 'clinched').length;
                setSuccessCount(count);

                // If user hits 3 successful clinches, trigger event and potentially show badge
                if (count >= 3) {
                    trackEvent('Clinch Badge Earned', { count });
                }

                // Fetch Pro status for web (on native it comes from Purchases)
                const { data: subData } = await supabase
                    .from('user_subscriptions')
                    .select('tier')
                    .eq('user_id', user.id)
                    .single();

                if (subData?.tier === 'pro') setIsPro(true);

                // Fetch Tabs for Financial Overview (Using the exact same phone normalization lookup)
                const { data: tabsData } = await supabase
                    .from('clinch_tabs')
                    .select('*')
                    .or(`creator_id.eq.${user.id},recipient_phone.eq.+${cleanPhone},recipient_phone.eq.${cleanPhone}`)
                    .eq('status', 'active');

                setTabs(tabsData || []);
            } catch (err) {
                console.error('Error fetching clinches:', err);
            } finally {
                setLoadingClinches(false);
            }
        }

        fetchClinches();
    }, [user, sent]); // Re-fetch when a new clinch is sent


    const handleSend = (terms, phone, shareUrl) => {
        setSentPhone(phone);
        setSentUrl(shareUrl);
        setSent(true);
        setToast({ type: 'success', message: 'Clinch link ready! 🤝' });
    };

    const handleNewClinch = () => {
        setSent(false);
        setSentPhone('');
        setSentUrl('');
    };

    const handleSaveProfile = async () => {
        if (!nameInput.trim()) return;
        if (!nameInput.trim().includes(' ')) {
            setToast({ type: 'error', message: 'Please enter your full name so your profile can be verified.' });
            return;
        }
        setSavingName(true);
        try {
            await updateProfileName(nameInput.trim());
            setSettingUpProfile(false);
            setToast({ type: 'success', message: 'Profile updated! Welcome to Clinch. 🤝' });
        } catch (err) {
            console.error(err);
            setToast({ type: 'error', message: 'Failed to save name. Please try again.' });
        }
        setSavingName(false);
    };

    if (settingUpProfile) {
        return (
            <div className="app-layout" style={{ justifyContent: 'center', alignItems: 'center', padding: '24px' }}>
                <div style={{ background: 'var(--color-white)', borderRadius: '16px', padding: '32px 24px', width: '100%', maxWidth: '400px', textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>👋</div>
                    <h2 style={{ color: '#008080', marginBottom: '8px' }}>Let's set up your profile.</h2>
                    <div style={{ padding: '12px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '8px', marginBottom: '24px', color: '#0369A1', fontSize: '13px', textAlign: 'left', lineHeight: '1.5' }}>
                        <strong>💡 Trust Tip:</strong> Use your real name so people know who they are shaking hands with. A verified name builds your Trust Score faster.
                    </div>
                    <input
                        type="text"
                        className="form-input"
                        placeholder="First and Last Name"
                        value={nameInput}
                        onChange={e => setNameInput(e.target.value)}
                        style={{ marginBottom: '16px', textAlign: 'center', fontSize: '18px' }}
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && handleSaveProfile()}
                    />
                    <button
                        className="btn-primary"
                        onClick={handleSaveProfile}
                        disabled={!nameInput.trim() || savingName}
                    >
                        {savingName ? 'Saving...' : 'Get Started'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            className="app-wrapper"
            initial={{ opacity: 0, scale: 0.98, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
            <NavBar onMenuClick={() => setMenuOpen(true)} />

            <div className="scroll-content">
                {/* Ongoing Financial Ledger - Shown only on Home Tab */}
                {currentTab === 'home' && tabs.length > 0 && (
                    <div style={{ padding: '0 20px', marginTop: '16px' }}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            style={{
                                background: '#FFFFFF827',
                                borderRadius: '24px',
                                padding: '16px',
                                color: 'white',
                                boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
                                position: 'relative',
                                overflow: 'hidden',
                                border: '1px solid rgba(0,0,0,0.05)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <div style={{ fontSize: '10px', fontWeight: '900', color: 'var(--color-teal)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                    Ongoing Live Ledger 🔄
                                </div>
                                <div style={{ fontSize: '10px', fontWeight: '700', opacity: 0.5 }}>Estimated Monthly</div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                {/* Incoming Section */}
                                <div style={{ background: 'rgba(34, 197, 94, 0.05)', padding: '16px', borderRadius: '16px', border: '1px solid rgba(34, 197, 94, 0.1)' }}>
                                    <div style={{ fontSize: '10px', fontWeight: '800', color: '#4ADE80', textTransform: 'uppercase', marginBottom: '4px' }}>Incoming 🟢</div>
                                    <div style={{ fontSize: '20px', fontWeight: '900', letterSpacing: '-1px' }}>
                                        +£<CountUp
                                            end={tabs.reduce((acc, t) => {
                                                const isCreator = t.creator_id === user.id;
                                                const isOwedToUser = isCreator ? (t.direction !== 'out') : (t.direction === 'out');
                                                if (!isOwedToUser) return acc;
                                                const amt = parseFloat(t.amount) || 0;
                                                return acc + (t.frequency === 'weekly' ? amt * 4.33 : amt);
                                            }, 0)}
                                            decimals={0}
                                            duration={1.5}
                                        />
                                    </div>
                                </div>

                                {/* Outgoing Section */}
                                <div style={{ background: 'rgba(239, 68, 68, 0.05)', padding: '16px', borderRadius: '16px', border: '1px solid rgba(239, 68, 68, 0.1)' }}>
                                    <div style={{ fontSize: '10px', fontWeight: '800', color: '#F87171', textTransform: 'uppercase', marginBottom: '4px' }}>Outgoing 🔴</div>
                                    <div style={{ fontSize: '20px', fontWeight: '900', letterSpacing: '-1px' }}>
                                        -£<CountUp
                                            end={tabs.reduce((acc, t) => {
                                                const isCreator = t.creator_id === user.id;
                                                const isOwedToUser = isCreator ? (t.direction !== 'out') : (t.direction === 'out');
                                                if (isOwedToUser) return acc;
                                                const amt = parseFloat(t.amount) || 0;
                                                return acc + (t.frequency === 'weekly' ? amt * 4.33 : amt);
                                            }, 0)}
                                            decimals={0}
                                            duration={1.5}
                                        />
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
                <AnimatePresence mode="wait">
                    {currentTab === 'ride' && (
                        <motion.div
                            key="ride"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            transition={{ duration: 0.2 }}
                            style={{ padding: 0, flex: 1, display: 'flex', flexDirection: 'column' }}
                        >
                            <DriverApp />
                        </motion.div>
                    )}
                    {currentTab === 'home' && (
                        <motion.div
                            key="home"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            transition={{ duration: 0.2 }}
                            style={{ padding: '0 20px' }}
                        >
                            {sent ? (
                                <SentConfirmation phone={sentPhone} shareUrl={sentUrl} onNewClinch={handleNewClinch} />
                            ) : (
                                <>
                                    {successCount >= 3 && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            style={{
                                                background: 'linear-gradient(90deg, #008080, #005D5D)',
                                                borderRadius: '16px',
                                                padding: '16px',
                                                marginBottom: '20px',
                                                color: 'white',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                boxShadow: '0 4px 12px rgba(0, 128, 128, 0.2)'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <span style={{ fontSize: '24px' }}>🏆</span>
                                                <div>
                                                    <h4 style={{ margin: 0, fontSize: '15px' }}>Clinch Verified!</h4>
                                                    <p style={{ margin: 0, fontSize: '11px', opacity: 0.9 }}>You've earned your Reliable Seller badge.</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setShowBadge(true)}
                                                style={{
                                                    background: 'white',
                                                    color: '#008080',
                                                    border: 'none',
                                                    padding: '6px 12px',
                                                    borderRadius: '8px',
                                                    fontSize: '12px',
                                                    fontWeight: '800',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                VIEW
                                            </button>
                                        </motion.div>
                                    )}
                                    <PromiseCard onSend={handleSend} />
                                </>
                            )}
                        </motion.div>
                    )}

                    {currentTab === 'vault' && (
                        <motion.div
                            key="vault"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            style={{ padding: '20px' }}
                        >
                            {loadingClinches ? (
                                <div style={{ padding: '20px' }}>
                                    <div style={{ width: '100%', height: '140px', background: 'var(--color-gray-100)', borderRadius: '16px', marginBottom: '24px', animation: 'pulse 1.5s infinite' }} />
                                    <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                                        {[1, 2, 3].map(i => <div key={i} style={{ width: '60px', height: '24px', background: 'var(--color-gray-100)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />)}
                                    </div>
                                    <div style={{ width: '150px', height: '24px', background: 'var(--color-gray-200)', borderRadius: '4px', marginBottom: '16px', animation: 'pulse 1.5s infinite' }} />
                                    {[1, 2, 3].map(i => <div key={i} style={{ height: '76px', background: 'var(--color-gray-100)', borderRadius: '16px', marginBottom: '12px', animation: 'pulse 1.5s infinite' }} />)}
                                </div>
                            ) : (
                                <VaultSection clinches={clinches} isPro={isPro} />
                            )}
                        </motion.div>
                    )}

                    {currentTab === 'tabs' && (
                        <motion.div
                            key="tabs"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            <TabsView setToast={setToast} isPro={isPro} />
                        </motion.div>
                    )}

                    {currentTab === 'network' && (
                        <motion.div
                            key="network"
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            transition={{ duration: 0.2 }}
                        >
                            <NetworkTab />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <BottomNav currentTab={currentTab} onChangeTab={setCurrentTab} />

            <AnimatePresence>
                {menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} />}
            </AnimatePresence>

            <AnimatePresence>
                {showBadge && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 1000,
                            background: 'rgba(0,0,0,0.85)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '20px',
                            backdropFilter: 'blur(8px)'
                        }}
                        onClick={() => setShowBadge(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            style={{
                                background: 'var(--color-bg)',
                                borderRadius: '32px',
                                width: '100%',
                                maxWidth: '400px',
                                position: 'relative',
                                overflow: 'hidden'
                            }}
                            onClick={e => e.stopPropagation()}
                        >
                            <button
                                onClick={() => setShowBadge(false)}
                                style={{
                                    position: 'absolute',
                                    top: '20px',
                                    right: '20px',
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '50%',
                                    background: 'var(--color-gray-100)',
                                    zIndex: 10,
                                    fontSize: '20px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer'
                                }}
                            >
                                ✕
                            </button>
                            <VerificationBadge count={successCount} user={user} />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </motion.div>
    );
}

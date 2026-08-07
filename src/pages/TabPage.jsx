import { useState, useEffect } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';

export default function TabPage() {
    const { id } = useParams();
    const { user, loading: authLoading } = useAuth();
    const [tab, setTab] = useState(null);
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function fetchTab() {
            try {
                // Fetch the tab from the public table (we might need to ensure RLS allows viewing by ID if public, or requires auth)
                // For a receiver to view it, they either need to be logged in with the right phone, or we make it publicly viewable by ID like clinches
                const { data, error } = await supabase
                    .from('clinch_tabs')
                    .select('*')
                    .eq('id', id)
                    .single();

                if (error) throw error;
                setTab(data);

                // Fetch entries
                const { data: entriesData } = await supabase
                    .from('tab_entries')
                    .select('*')
                    .eq('tab_id', id)
                    .order('created_at', { ascending: false });

                setEntries(entriesData || []);
            } catch (err) {
                console.error(err);
                setError('Failed to load tab. The link may be invalid.');
            } finally {
                setLoading(false);
            }
        }

        if (id) fetchTab();
    }, [id]);

    const handleAccept = async () => {
        try {
            const { error } = await supabase.rpc('accept_tab', { p_tab_id: id });
            if (error) throw error;
            setTab(prev => ({ ...prev, status: 'active' }));
        } catch (err) {
            console.error(err);
            alert('Failed to accept tab.');
        }
    };

    if (loading || authLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <div style={{
                    width: '48px', height: '48px', borderRadius: '50%',
                    background: 'var(--color-gray-100)',
                    animation: 'pulse 1.5s ease-in-out infinite'
                }} />
                <style>{`
                    @keyframes pulse {
                        0%, 100% { opacity: 0.3; transform: scale(0.95); }
                        50% { opacity: 0.8; transform: scale(1.05); }
                    }
                `}</style>
            </div>
        );
    }

    if (error || !tab) {
        return (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <h1 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '16px' }}>Tab Not Found</h1>
                <p style={{ color: 'var(--color-text-secondary)' }}>{error || "This tab doesn't exist or you don't have access."}</p>
                <button
                    className="btn-primary"
                    onClick={() => window.location.href = '/'}
                    style={{ marginTop: '24px', maxWidth: '200px' }}
                >
                    Go Home
                </button>
            </div>
        );
    }

    const isCreator = user?.id === tab.creator_id;
    const isSettleable = tab.running_total >= tab.settle_threshold;
    const progressPercent = Math.min(100, (tab.running_total / tab.settle_threshold) * 100);
    const currencySymbol = '£';

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--color-bg)',
            padding: '24px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)',
            maxWidth: '480px',
            margin: '0 auto'
        }}>
            <Helmet>
                <title>{tab.label} | Clinch Tab</title>
            </Helmet>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <button
                    onClick={() => window.location.href = '/?tab=tabs'}
                    style={{
                        width: '40px', height: '40px', borderRadius: '50%', background: 'var(--color-gray-200)',
                        border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '20px', cursor: 'pointer', color: 'var(--color-text)'
                    }}
                >
                    ←
                </button>
                <img src="/assets/clinch-logo.png" alt="Clinch" style={{ height: '24px' }} />
                <div style={{ width: '40px' }} />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                    background: 'var(--color-white)', borderRadius: '24px',
                    padding: '32px 24px', textAlign: 'center',
                    boxShadow: 'var(--shadow-lg)', border: '1px solid var(--color-gray-200)',
                    marginBottom: '24px'
                }}
            >
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔄</div>
                <h1 style={{ fontSize: '24px', fontWeight: '900', color: 'var(--color-text)', margin: '0 0 8px 0' }}>
                    {tab.label}
                </h1>

                <div style={{ fontSize: '48px', fontWeight: '900', color: 'var(--color-teal)', letterSpacing: '-2px', lineHeight: 1, marginBottom: '8px' }}>
                    {currencySymbol}{parseFloat(tab.running_total).toFixed(2)}
                </div>

                <p style={{ fontSize: '15px', color: 'var(--color-text-secondary)', fontWeight: '600', margin: '0 0 16px 0' }}>
                    {isCreator ? `Owed by ${tab.recipient_phone}` : `Owed to ${tab.creator_name || 'Creator'}`}
                </p>

                <button
                    onClick={() => {
                        navigator.clipboard.writeText(window.location.href);
                        alert('Link copied! 🤝');
                    }}
                    style={{
                        padding: '8px 16px', borderRadius: '12px', background: 'var(--color-gray-100)',
                        border: 'none', color: 'var(--color-teal)', fontSize: '13px', fontWeight: '700',
                        cursor: 'pointer', marginBottom: '24px'
                    }}
                >
                    🔗 Copy Link
                </button>

                {/* Progress bar */}
                <div style={{ width: '100%', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '700', color: 'var(--color-text-secondary)', marginBottom: '8px', textTransform: 'uppercase' }}>
                        <span>Current</span>
                        <span>Settle at {currencySymbol}{parseFloat(tab.settle_threshold).toFixed(0)}</span>
                    </div>
                    <div style={{ height: '8px', borderRadius: '4px', background: 'var(--color-gray-100)', overflow: 'hidden' }}>
                        <div style={{
                            height: '100%', borderRadius: '4px', width: `${progressPercent}%`,
                            background: isSettleable ? 'linear-gradient(90deg, #22C55E, #4ADE80)' : 'linear-gradient(90deg, #008080, #33CCCC)',
                            transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)'
                        }} />
                    </div>
                </div>

                {isSettleable && (
                    <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '16px', color: '#16A34A', fontWeight: '800', fontSize: '14px' }}>
                        ✅ Threshold reached. Time to settle up!
                    </div>
                )}

                {tab.status === 'pending' && (
                    <div style={{ marginTop: '24px' }}>
                        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
                            {isCreator
                                ? "Waiting for recipient to agree..."
                                : "The creator has started this tab. Agree to track recurring promises together."}
                        </p>
                        {!isCreator && (
                            <button
                                className="btn-primary"
                                onClick={handleAccept}
                                style={{ background: 'linear-gradient(90deg, #98FF98, #7AE07A)', color: '#004D4D' }}
                            >
                                👍 Agree & Start Tab
                            </button>
                        )}
                    </div>
                )}
            </motion.div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                style={{
                    background: 'var(--color-white)', borderRadius: '24px',
                    padding: '24px', boxShadow: 'var(--shadow-sm)',
                    border: '1px solid var(--color-gray-200)'
                }}
            >
                <h3 style={{ fontSize: '14px', fontWeight: '800', color: 'var(--color-teal)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '16px' }}>
                    Tab History
                </h3>

                {entries.length === 0 ? (
                    <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', textAlign: 'center', padding: '20px 0' }}>
                        No charges yet.
                    </p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {entries.map((entry, idx) => (
                            <div key={entry.id} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '16px 0', borderBottom: idx === entries.length - 1 ? 'none' : '1px solid var(--color-gray-100)'
                            }}>
                                <div>
                                    <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--color-text)' }}>
                                        +{currencySymbol}{parseFloat(entry.amount).toFixed(2)}
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                                        {entry.note || 'Recurring charge'}
                                    </div>
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: '500' }}>
                                    {new Date(entry.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </motion.div>
        </div>
    );
}

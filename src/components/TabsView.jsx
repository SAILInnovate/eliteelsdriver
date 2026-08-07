import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { triggerHaptic, triggerNotificationHaptic } from '../lib/capacitor';
import { trackEvent } from '../lib/posthog';
import { motion, AnimatePresence } from 'framer-motion';
import TabCreator from './TabCreator';
import ActionSlider from './ActionSlider';
import jsPDF from 'jspdf';

export default function TabsView({ setToast, isPro }) {
    const { user } = useAuth();
    const [tabs, setTabs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreator, setShowCreator] = useState(false);
    const [selectedTab, setSelectedTab] = useState(null);
    const [entries, setEntries] = useState([]);
    const [chargeValue, setChargeValue] = useState(0);
    const [chargeNote, setChargeNote] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('active'); // 'active', 'archived'

    useEffect(() => {
        fetchTabs();
    }, [user]);

    const fetchTabs = async () => {
        if (!user) return;
        try {
            // Fix Supabase Auth phone stripping '+' behavior
            const rawPhone = user?.phone || 'none';
            const cleanPhone = rawPhone.replace('+', '');

            const { data, error } = await supabase
                .from('clinch_tabs')
                .select('*')
                .or(`creator_id.eq.${user.id},recipient_phone.eq.+${cleanPhone},recipient_phone.eq.${cleanPhone}`)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setTabs(data || []);
        } catch (err) {
            console.error('Error fetching tabs:', err);
        } finally {
            setLoading(false);
        }
    };

    const filteredTabs = tabs.filter(t => {
        // 1. Status Filter
        if (activeFilter === 'active' && !['active', 'paused', 'settled', 'pending'].includes(t.status)) return false;
        if (activeFilter === 'archived' && !['cancelled', 'archived'].includes(t.status)) return false;

        // 2. Search Filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return t.label?.toLowerCase().includes(query) ||
                t.recipient_phone?.toLowerCase().includes(query) ||
                t.creator_name?.toLowerCase().includes(query);
        }
        return true;
    });

    const fetchEntries = async (tabId) => {
        const { data } = await supabase
            .from('tab_entries')
            .select('*')
            .eq('tab_id', tabId)
            .order('created_at', { ascending: false });
        setEntries(data || []);
    };

    const handleTabClick = (tab) => {
        triggerHaptic('light');
        setSelectedTab(tab);
        fetchEntries(tab.id);
    };

    const handleSettleUp = async (tab) => {
        triggerHaptic('medium');
        trackEvent('Tab Settled', { amount: tab.running_total, label: tab.label });

        // For now, just link out to a payment method
        const msg = `Hey! Your Clinch Tab for "${tab.label}" has reached £${tab.running_total.toFixed(2)}. Time to settle up! 🤝`;
        const smsUrl = `sms:${tab.recipient_phone}?body=${encodeURIComponent(msg)}`;
        window.location.href = smsUrl;
    };

    const handleManualCharge = async (tab, chargeAmount, note) => {
        if (chargeAmount <= 0) return;
        try {
            const { error: entryError } = await supabase.from('tab_entries').insert([{
                tab_id: tab.id,
                amount: chargeAmount,
                note: note || chargeNote || 'Manual adjustment'
            }]);
            if (entryError) throw entryError;

            // Update tab total
            const { error: updateError } = await supabase.rpc('increment_tab_total', {
                p_tab_id: tab.id,
                p_amount: chargeAmount
            });
            if (updateError) throw updateError;

            trackEvent('Manual Charge Added', { amount: chargeAmount, tab_id: tab.id, note: note || chargeNote });
            fetchTabs();
            fetchEntries(tab.id);
            // Update selected tab state locally
            setSelectedTab(prev => ({ ...prev, running_total: parseFloat(prev.running_total) + chargeAmount }));
            setChargeNote('');
        } catch (err) {
            console.error('Charge failed:', err);
            alert('Failed to add charge: ' + err.message);
        }
    };

    const handleCopyLink = (tabId) => {
        const link = `https://clinch.to/tab/${tabId}`;
        navigator.clipboard.writeText(link);
        triggerHaptic('light');
        if (setToast) {
            setToast({ type: 'success', message: 'Link copied to clipboard! 📋' });
        } else {
            alert('Link copied!');
        }
    };

    const resolveContactName = (phone) => {
        try {
            const cache = JSON.parse(localStorage.getItem('clinch_contacts_cache') || '[]');
            const contact = cache.find(c => c.phoneNumbers?.some(p => p.value.replace(/\s+/g, '') === phone.replace(/\s+/g, '')));
            return contact ? contact.fullName : phone;
        } catch {
            return phone;
        }
    };

    const loadImageAsBase64 = (url) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext('2d').drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = reject;
            img.src = url;
        });
    };

    const handleExportTabPDF = async (tab) => {
        try {
            if (!isPro) {
                triggerHaptic('warning');
                const wantsToUpgrade = window.confirm("Clinch+ Pro Required ⚡\n\nExporting tab statements as PDF is a premium feature. Would you like to upgrade in Settings?");
                if (wantsToUpgrade) window.location.href = '/settings';
                return;
            }

            triggerHaptic('medium');

            let logoBase64, handshakeBase64;
            try {
                [logoBase64, handshakeBase64] = await Promise.all([
                    loadImageAsBase64('/assets/clinch-logo.png'),
                    loadImageAsBase64('/assets/geometric-handshake.png')
                ]);
            } catch (e) { console.warn('Could not load images', e); }

            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const margin = 20;
            const pageWidth = 210;
            const contentWidth = pageWidth - (2 * margin);
            let y = 0;

            const isCreator = tab.creator_id === user.id;
            const otherParty = isCreator ? resolveContactName(tab.recipient_phone) : (tab.creator_name || 'Creator');

            // Header
            doc.setFillColor(1, 58, 58);
            doc.rect(0, 0, pageWidth, 52, 'F');
            doc.setFillColor(0, 128, 128);
            doc.rect(0, 52, pageWidth, 3, 'F');

            if (logoBase64) {
                doc.addImage(logoBase64, 'PNG', margin, 12, 50, 20);
            } else {
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(28);
                doc.setFont('helvetica', 'bold');
                doc.text('CLINCH', margin, 28);
            }

            doc.setTextColor(152, 255, 152);
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text('TAB STATEMENT', pageWidth - margin, 22, { align: 'right' });

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(`ID: ${tab.id.slice(0, 8).toUpperCase()}`, pageWidth - margin, 30, { align: 'right' });
            doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - margin, 36, { align: 'right' });

            // Diagonal watermark
            doc.saveGraphicsState();
            doc.setGState(new doc.GState({ opacity: 0.04 }));
            doc.setTextColor(0, 128, 128);
            doc.setFontSize(28);
            doc.setFont('helvetica', 'bold');
            for (let wy = 40; wy < 300; wy += 45) {
                for (let wx = -60; wx < 250; wx += 120) {
                    doc.text('CLINCH VERIFIED', wx, wy, { angle: 35 });
                }
            }
            doc.restoreGraphicsState();

            if (handshakeBase64) {
                doc.saveGraphicsState();
                doc.setGState(new doc.GState({ opacity: 0.05 }));
                doc.addImage(handshakeBase64, 'PNG', 55, 120, 100, 80);
                doc.restoreGraphicsState();
            }

            y = 65;

            // Tab Summary
            doc.setTextColor(0, 128, 128);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('TAB DETAILS', margin, y);
            y += 4;
            doc.setLineWidth(0.8);
            doc.line(margin, y, margin + 30, y);
            y += 10;

            // Title
            doc.setTextColor(30, 41, 59);
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.text(tab.label, margin, y);
            y += 10;

            // Status badge
            const statusColors = { active: [0, 128, 128], paused: [255, 165, 0], archived: [156, 163, 175], cancelled: [255, 69, 58] };
            const statusColor = statusColors[tab.status] || [100, 100, 100];
            doc.setFillColor(...statusColor);
            doc.roundedRect(margin, y - 4, 28, 8, 2, 2, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(8);
            doc.text(tab.status.toUpperCase(), margin + 14, y + 1, { align: 'center' });
            y += 14;

            // Info grid
            const infoItems = [
                ['Amount', `£${parseFloat(tab.amount).toFixed(2)} / ${tab.frequency}`],
                ['Direction', tab.direction === 'in' ? 'Incoming (owed to you)' : 'Outgoing (you owe)'],
                ['Other Party', otherParty],
                ['Running Total', `£${parseFloat(tab.running_total).toFixed(2)}`],
                ['Created', new Date(tab.created_at).toLocaleDateString()],
            ];

            if (tab.settle_threshold) infoItems.push(['Settle Threshold', `£${parseFloat(tab.settle_threshold).toFixed(2)}`]);
            if (tab.settle_date) infoItems.push(['Settle Date', new Date(tab.settle_date).toLocaleDateString()]);

            infoItems.forEach(([label, value]) => {
                doc.setTextColor(100, 116, 139);
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.text(label.toUpperCase(), margin, y);

                doc.setTextColor(30, 41, 59);
                doc.setFontSize(10);
                doc.setFont('helvetica', 'normal');
                doc.text(value, margin + 50, y);
                y += 7;
            });

            y += 10;

            // Charge History
            doc.setTextColor(0, 128, 128);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('CHARGE HISTORY', margin, y);
            y += 4;
            doc.setLineWidth(0.8);
            doc.line(margin, y, margin + 30, y);
            y += 8;

            if (entries.length === 0) {
                doc.setTextColor(148, 163, 184);
                doc.setFontSize(10);
                doc.setFont('helvetica', 'normal');
                doc.text('No charges recorded yet.', margin, y);
                y += 10;
            } else {
                // Table header
                doc.setFillColor(248, 250, 252);
                doc.rect(margin, y, contentWidth, 8, 'F');
                doc.setTextColor(100, 116, 139);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text('DATE', margin + 3, y + 5);
                doc.text('DESCRIPTION', margin + 40, y + 5);
                doc.text('AMOUNT', pageWidth - margin - 3, y + 5, { align: 'right' });
                y += 10;

                entries.forEach((entry, i) => {
                    if (y > 260) {
                        doc.addPage();
                        y = 20;
                    }

                    if (i % 2 === 0) {
                        doc.setFillColor(252, 252, 253);
                        doc.rect(margin, y - 3, contentWidth, 8, 'F');
                    }

                    doc.setTextColor(100, 116, 139);
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'normal');
                    doc.text(new Date(entry.created_at).toLocaleDateString(), margin + 3, y + 2);

                    doc.setTextColor(30, 41, 59);
                    doc.text(entry.note || 'Recurring charge', margin + 40, y + 2);

                    doc.setTextColor(0, 128, 128);
                    doc.setFont('helvetica', 'bold');
                    doc.text(`+£${parseFloat(entry.amount).toFixed(2)}`, pageWidth - margin - 3, y + 2, { align: 'right' });

                    y += 8;
                });

                // Total row
                y += 2;
                doc.setDrawColor(0, 128, 128);
                doc.setLineWidth(0.5);
                doc.line(margin, y, pageWidth - margin, y);
                y += 6;
                doc.setTextColor(30, 41, 59);
                doc.setFontSize(11);
                doc.setFont('helvetica', 'bold');
                doc.text('TOTAL', margin + 3, y);
                doc.setTextColor(0, 128, 128);
                doc.text(`£${parseFloat(tab.running_total).toFixed(2)}`, pageWidth - margin - 3, y, { align: 'right' });
            }

            // Footer
            const footerY = 272;
            doc.setDrawColor(0, 128, 128);
            doc.setLineWidth(0.5);
            doc.line(margin, footerY, pageWidth - margin, footerY);

            doc.setTextColor(148, 163, 184);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text('This statement is a secure, verifiable record of tab activity.', pageWidth / 2, footerY + 6, { align: 'center' });
            doc.text('Generated by Clinch — Digital Handshake Protocol  •  clinch.to', pageWidth / 2, footerY + 11, { align: 'center' });

            if (handshakeBase64) {
                doc.saveGraphicsState();
                doc.setGState(new doc.GState({ opacity: 0.15 }));
                doc.addImage(handshakeBase64, 'PNG', pageWidth - margin - 20, footerY - 8, 20, 16);
                doc.restoreGraphicsState();
            }

            doc.save(`Clinch_Tab_${tab.label.replace(/\s+/g, '_')}_${tab.id.slice(0, 8)}.pdf`);
            if (setToast) setToast({ type: 'success', message: 'PDF downloaded! 📄' });

        } catch (err) {
            console.error('Tab PDF export failed:', err);
            alert('Failed to generate PDF.');
        }
    };

    const handlePause = async (tab) => {
        try {
            const { error } = await supabase.rpc('pause_tab', { p_tab_id: tab.id });
            if (error) throw error;
            triggerHaptic('medium');
            fetchTabs();
            setSelectedTab(prev => ({ ...prev, status: 'paused' }));
            if (setToast) setToast({ type: 'success', message: 'Tab paused ⏸️' });
        } catch (err) {
            console.error(err);
            alert('Pause failed: ' + err.message);
        }
    };

    const handleResume = async (tab) => {
        try {
            const { error } = await supabase.rpc('resume_tab', { p_tab_id: tab.id });
            if (error) throw error;
            triggerHaptic('medium');
            fetchTabs();
            setSelectedTab(prev => ({ ...prev, status: 'active' }));
            if (setToast) setToast({ type: 'success', message: 'Tab resumed! ▶️' });
        } catch (err) {
            console.error(err);
            alert('Resume failed: ' + err.message);
        }
    };

    const handleCancelAction = async (tab, action) => {
        try {
            const { error } = await supabase.rpc('cancel_tab', { p_tab_id: tab.id, p_action: action });
            if (error) throw error;
            triggerNotificationHaptic();
            fetchTabs();
            setSelectedTab(null);
            if (setToast) {
                const msgs = {
                    archive: 'Tab archived 📦',
                    forgive: 'Balance forgiven! ❤️',
                    settle_close: 'Settled and closed! 🤝'
                };
                setToast({ type: 'success', message: msgs[action] });
            }
        } catch (err) {
            console.error(err);
            alert('Operation failed: ' + err.message);
        }
    };

    const handleCreated = (newTab) => {
        setShowCreator(false);
        setTabs(prev => [newTab, ...prev]);
    };

    const currencySymbol = '£';

    if (loading) {
        return (
            <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                    <div>
                        <div style={{ width: '80px', height: '28px', background: 'var(--color-gray-200)', borderRadius: '8px', marginBottom: '8px', animation: 'pulse 1.5s infinite' }} />
                        <div style={{ width: '120px', height: '16px', background: 'var(--color-gray-100)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
                    </div>
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--color-gray-200)', animation: 'pulse 1.5s infinite' }} />
                </div>
                <div style={{ width: '100%', height: '44px', background: 'var(--color-gray-100)', borderRadius: '12px', marginBottom: '20px', animation: 'pulse 1.5s infinite' }} />
                {[1, 2, 3].map(i => (
                    <div key={i} style={{ height: '88px', background: 'var(--color-gray-100)', borderRadius: '16px', marginBottom: '12px', animation: 'pulse 1.5s infinite' }} />
                ))}
            </div>
        );
    }

    return (
        <div style={{ padding: '20px' }}>
            {/* Header */}
            <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: '24px'
            }}>
                <div>
                    <h2 style={{
                        fontSize: '28px', fontWeight: '900', color: 'var(--color-teal)',
                        margin: 0, letterSpacing: '-1px'
                    }}>
                        Tabs
                    </h2>
                    <p style={{
                        fontSize: '13px', color: 'var(--color-text-secondary)',
                        margin: '4px 0 0', fontWeight: '500'
                    }}>
                        Track recurring promises
                    </p>
                </div>

                <button
                    onClick={() => { setShowCreator(true); triggerHaptic('light'); }}
                    style={{
                        width: '48px', height: '48px', borderRadius: '50%',
                        background: 'var(--color-teal)', color: 'white',
                        fontSize: '28px', fontWeight: '300', border: 'none',
                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,128,128,0.3)'
                    }}
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
            </div>

            {/* Search and Tabs */}
            <div style={{ marginBottom: '20px' }}>
                <input
                    type="text"
                    placeholder="Search tabs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        border: '1px solid var(--color-gray-200)',
                        background: 'var(--color-white)',
                        fontSize: '15px',
                        marginBottom: '16px'
                    }}
                />
                <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--color-gray-100)', paddingBottom: '2px' }}>
                    {['active', 'archived'].map(f => (
                        <button
                            key={f}
                            onClick={() => setActiveFilter(f)}
                            style={{
                                padding: '8px 4px',
                                background: 'transparent',
                                border: 'none',
                                color: activeFilter === f ? 'var(--color-teal)' : 'var(--color-text-secondary)',
                                fontWeight: '700',
                                fontSize: '14px',
                                cursor: 'pointer',
                                position: 'relative',
                                textTransform: 'capitalize'
                            }}
                        >
                            {f === 'archived' ? 'Archived 📦' : 'All Tabs'}
                            {activeFilter === f && (
                                <motion.div
                                    layoutId="activeTabFilter"
                                    style={{
                                        position: 'absolute',
                                        bottom: '-2px',
                                        left: 0,
                                        right: 0,
                                        height: '2px',
                                        background: 'var(--color-teal)'
                                    }}
                                />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Empty State */}
            {tabs.length === 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                        textAlign: 'center', padding: '48px 24px',
                        background: 'var(--color-white)', borderRadius: '24px',
                        boxShadow: 'var(--shadow-card)'
                    }}
                >
                    <div style={{ fontSize: '56px', marginBottom: '16px' }}>🔄</div>
                    <h3 style={{
                        fontSize: '20px', fontWeight: '800',
                        color: 'var(--color-text)', marginBottom: '8px'
                    }}>
                        No Tabs Yet
                    </h3>
                    <p style={{
                        fontSize: '14px', color: 'var(--color-text-secondary)',
                        lineHeight: '1.5', maxWidth: '240px', margin: '0 auto 24px'
                    }}>
                        Start a recurring tab with someone — perfect for split bills, coffee funds, or freelance retainers.
                    </p>
                    <button
                        className="btn-primary"
                        onClick={() => { setShowCreator(true); triggerHaptic('light'); }}
                        style={{ maxWidth: '200px', margin: '0 auto' }}
                    >
                        🔄 Start a Tab
                    </button>
                </motion.div>
            )}

            {/* Tab Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {filteredTabs.length === 0 && searchQuery && (
                    <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '20px 0' }}>
                        No tabs found for "{searchQuery}".
                    </p>
                )}
                {filteredTabs.map((tab, i) => {
                    const today = new Date();
                    const isDateReached = tab.settlement_type === 'date' && today.getDate() >= (tab.due_day || 1);
                    const isAmountReached = tab.running_total >= tab.settle_threshold;
                    const isSettleable = isAmountReached || isDateReached;

                    const progressPercent = tab.settlement_type === 'date'
                        ? Math.min(100, (today.getDate() / (tab.due_day || 1)) * 100)
                        : Math.min(100, (tab.running_total / tab.settle_threshold) * 100);

                    const isCreator = tab.creator_id === user.id;
                    const isOwedToUser = isCreator ? (tab.direction !== 'out') : (tab.direction === 'out');

                    return (
                        <motion.div
                            key={tab.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                            onClick={() => handleTabClick(tab)}
                            style={{
                                background: 'var(--color-white)',
                                borderRadius: '20px',
                                padding: '20px',
                                boxShadow: 'var(--shadow-sm)',
                                cursor: 'pointer',
                                transition: 'transform 0.15s, box-shadow 0.15s',
                                border: isSettleable ? '2px solid #98FF98' : '1px solid var(--color-gray-200)'
                            }}
                        >
                            <div style={{
                                display: 'flex', justifyContent: 'space-between',
                                alignItems: 'flex-start', marginBottom: '12px'
                            }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <h3 style={{
                                            fontSize: '17px', fontWeight: '800',
                                            color: 'var(--color-text)', margin: 0
                                        }}>
                                            {tab.label}
                                        </h3>
                                        {isOwedToUser ? (
                                            <span style={{ fontSize: '10px', background: 'var(--color-teal)', color: 'white', padding: '3px 8px', borderRadius: '100px', fontWeight: '900', letterSpacing: '0.5px' }}>OWED TO YOU</span>
                                        ) : (
                                            <span style={{ fontSize: '10px', background: '#FF453A', color: 'white', padding: '3px 8px', borderRadius: '100px', fontWeight: '900', letterSpacing: '0.5px' }}>YOU OWE</span>
                                        )}
                                    </div>
                                    <p style={{
                                        fontSize: '12px', color: 'var(--color-text-secondary)',
                                        margin: '4px 0 0', fontWeight: '500'
                                    }}>
                                        {currencySymbol}{parseFloat(tab.amount).toFixed(2)}/{tab.frequency === 'weekly' ? 'wk' : 'mo'} • {isOwedToUser ? `From: ${isCreator ? resolveContactName(tab.recipient_phone) : tab.creator_name || 'Creator'}` : `To: ${isCreator ? resolveContactName(tab.recipient_phone) : tab.creator_name || 'Creator'}`}
                                    </p>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                    <div style={{
                                        fontSize: '24px', fontWeight: '900',
                                        color: isSettleable ? '#22C55E' : 'var(--color-teal)',
                                        letterSpacing: '-1px'
                                    }}>
                                        {currencySymbol}{parseFloat(tab.running_total).toFixed(2)}
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleCopyLink(tab.id); }}
                                        style={{
                                            background: 'none', border: 'none', padding: '4px',
                                            fontSize: '14px', cursor: 'pointer', opacity: 0.6
                                        }}
                                        title="Copy Link"
                                    >
                                        🔗
                                    </button>
                                </div>
                            </div>

                            {/* Progress bar */}
                            <div style={{
                                height: '6px', borderRadius: '3px',
                                background: 'var(--color-gray-100)', overflow: 'hidden',
                                marginBottom: '12px'
                            }}>
                                <div style={{
                                    height: '100%', borderRadius: '3px',
                                    width: `${progressPercent}%`,
                                    background: isSettleable
                                        ? 'linear-gradient(90deg, #22C55E, #4ADE80)'
                                        : 'linear-gradient(90deg, #008080, #33CCCC)',
                                    transition: 'width 0.5s ease'
                                }} />
                            </div>

                            <div style={{
                                display: 'flex', justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <span style={{
                                    fontSize: '11px', color: 'var(--color-text-secondary)',
                                    fontWeight: '600', textTransform: 'uppercase'
                                }}>
                                    {tab.status === 'active' ? (
                                        isSettleable ? '🟢 Ready to settle' : `Next: ${tab.next_due ? new Date(tab.next_due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}`
                                    ) : (
                                        `${tab.status}`
                                    )}
                                </span>

                                {isSettleable && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleSettleUp(tab); }}
                                        style={{
                                            padding: '8px 16px', borderRadius: '100px',
                                            background: 'linear-gradient(90deg, #22C55E, #16A34A)',
                                            color: 'white', fontSize: '13px', fontWeight: '800',
                                            border: 'none', cursor: 'pointer',
                                            boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)'
                                        }}
                                    >
                                        Settle Up 💸
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* Tab Detail Sheet */}
            <AnimatePresence>
                {selectedTab && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSelectedTab(null)}
                        style={{
                            position: 'fixed', inset: 0, zIndex: 2000,
                            background: 'rgba(0,0,0,0.5)',
                            backdropFilter: 'blur(4px)'
                        }}
                    >
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            onClick={e => e.stopPropagation()}
                            style={{
                                position: 'absolute', bottom: 0, left: 0, right: 0,
                                background: 'var(--color-bg)', borderRadius: '28px 28px 0 0',
                                padding: '0 20px calc(env(safe-area-inset-bottom, 0px) + 60px)',
                                maxHeight: '90dvh', overflow: 'auto',
                                display: 'flex', flexDirection: 'column'
                            }}
                        >
                            {/* Sheet handle (Click to close) */}
                            <div
                                onClick={() => setSelectedTab(null)}
                                style={{
                                    padding: '20px 0', cursor: 'pointer', position: 'sticky',
                                    top: 0, background: 'var(--color-bg)', zIndex: 10,
                                    display: 'flex', justifyContent: 'center'
                                }}
                            >
                                <div style={{
                                    width: '40px', height: '5px', borderRadius: '3px',
                                    background: 'var(--color-gray-300)'
                                }} />
                            </div>

                            {/* Summary */}
                            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                                <h3 style={{
                                    fontSize: '22px', fontWeight: '900',
                                    color: 'var(--color-text)', margin: 0
                                }}>
                                    {selectedTab.label}
                                </h3>
                                <div style={{
                                    fontSize: '32px', fontWeight: '900', color: 'var(--color-teal)',
                                    letterSpacing: '-2px', margin: '4px 0'
                                }}>
                                    {currencySymbol}{parseFloat(selectedTab.running_total).toFixed(2)}
                                </div>
                                <p style={{
                                    fontSize: '13px', color: 'var(--color-text-secondary)',
                                    margin: 0
                                }}>
                                    {currencySymbol}{parseFloat(selectedTab.amount).toFixed(2)} / {selectedTab.frequency} • {(() => {
                                        const isCreatorSheet = selectedTab.creator_id === user.id;
                                        const isOwedSheet = isCreatorSheet ? (selectedTab.direction !== 'out') : (selectedTab.direction === 'out');
                                        return isOwedSheet ? `Receiving from ${isCreatorSheet ? resolveContactName(selectedTab.recipient_phone) : selectedTab.creator_name || 'Creator'}` : `Paying to ${isCreatorSheet ? resolveContactName(selectedTab.recipient_phone) : selectedTab.creator_name || 'Creator'}`;
                                    })()}
                                </p>
                                <button
                                    onClick={() => handleCopyLink(selectedTab.id)}
                                    style={{
                                        marginTop: '12px', padding: '8px 16px', borderRadius: '12px',
                                        background: 'var(--color-gray-100)', color: 'var(--color-teal)',
                                        fontWeight: '700', fontSize: '13px', border: 'none', cursor: 'pointer'
                                    }}
                                >
                                    🔗 Copy Link
                                </button>
                                <button
                                    onClick={() => handleExportTabPDF(selectedTab)}
                                    style={{
                                        marginTop: '8px', padding: '8px 16px', borderRadius: '12px',
                                        background: 'linear-gradient(135deg, #013A3A, #008080)', color: 'white',
                                        fontWeight: '700', fontSize: '13px', border: 'none', cursor: 'pointer'
                                    }}
                                >
                                    📄 Download PDF
                                </button>
                            </div>

                            {/* Charge Builder */}
                            <div style={{
                                background: 'var(--color-gray-100)',
                                borderRadius: '20px',
                                padding: '16px',
                                marginBottom: '24px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                    <div>
                                        <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--color-teal)', display: 'block' }}>
                                            Add Charge
                                        </span>
                                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', fontWeight: '600' }}>
                                            One-off adjustment to balance
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', background: 'white', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--color-gray-200)' }}>
                                        <span style={{ fontSize: '14px', fontWeight: '800', border: 'none', background: 'transparent', width: 'auto' }}>
                                            +£
                                        </span>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            value={chargeValue || ''}
                                            onChange={(e) => setChargeValue(parseFloat(e.target.value) || 0)}
                                            style={{
                                                fontSize: '18px', fontWeight: '900', color: 'var(--color-teal)',
                                                border: 'none', background: 'transparent', width: '80px', outline: 'none'
                                            }}
                                            placeholder="0.00"
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                    {[0.01, 0.10, 1.00, 5.00].map(val => (
                                        <AdderButton
                                            key={val}
                                            val={val}
                                            onAdd={() => setChargeValue(v => parseFloat(((v || 0) + val).toFixed(2)))}
                                        />
                                    ))}
                                    <button
                                        onClick={() => { setChargeValue(0); setChargeNote(''); }}
                                        style={{
                                            flex: 1, padding: '10px 0', borderRadius: '12px',
                                            background: 'var(--color-gray-200)', color: 'var(--color-text)',
                                            fontWeight: '700', fontSize: '13px', border: 'none'
                                        }}
                                    >
                                        Clear
                                    </button>
                                </div>

                                <input
                                    type="text"
                                    placeholder="Add a note (e.g. Extra lunch, Coffee)"
                                    value={chargeNote}
                                    onChange={(e) => setChargeNote(e.target.value)}
                                    style={{
                                        width: '100%',
                                        marginTop: '12px',
                                        padding: '12px',
                                        borderRadius: '12px',
                                        border: '1px solid var(--color-gray-200)',
                                        fontSize: '14px',
                                        background: 'white'
                                    }}
                                />

                                {chargeValue > 0 && (
                                    <div style={{ marginTop: '16px' }}>
                                        <ActionSlider
                                            label={`Slide to add +${currencySymbol}${chargeValue.toFixed(2)}`}
                                            successLabel="Charge Added!"
                                            onComplete={() => {
                                                handleManualCharge(selectedTab, chargeValue);
                                                setChargeValue(0);
                                            }}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* History */}
                            <h4 style={{
                                fontSize: '13px', fontWeight: '800', color: 'var(--color-teal)',
                                textTransform: 'uppercase', letterSpacing: '1px',
                                marginBottom: '12px'
                            }}>
                                History
                            </h4>

                            {entries.length === 0 ? (
                                <p style={{
                                    fontSize: '13px', color: 'var(--color-text-secondary)',
                                    textAlign: 'center', padding: '20px'
                                }}>
                                    No entries yet.
                                </p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    {entries.map(entry => (
                                        <div key={entry.id} style={{
                                            display: 'flex', justifyContent: 'space-between',
                                            alignItems: 'center', padding: '12px 0',
                                            borderBottom: '1px solid var(--color-gray-100)'
                                        }}>
                                            <div>
                                                <p style={{
                                                    fontSize: '14px', fontWeight: '600',
                                                    color: 'var(--color-text)', margin: 0
                                                }}>
                                                    +{currencySymbol}{parseFloat(entry.amount).toFixed(2)}
                                                </p>
                                                <p style={{
                                                    fontSize: '11px', color: 'var(--color-text-secondary)',
                                                    margin: '2px 0 0'
                                                }}>
                                                    {entry.note || 'Recurring charge'}
                                                </p>
                                            </div>
                                            <span style={{
                                                fontSize: '11px', color: 'var(--color-text-secondary)'
                                            }}>
                                                {new Date(entry.created_at).toLocaleDateString(undefined, {
                                                    month: 'short', day: 'numeric'
                                                })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Settle Button */}
                            {selectedTab.running_total >= selectedTab.settle_threshold && (
                                <div style={{ marginTop: '20px' }}>
                                    <ActionSlider
                                        label={`Slide to Settle ${currencySymbol}${parseFloat(selectedTab.running_total).toFixed(2)}`}
                                        successLabel="Settled!"
                                        onComplete={() => handleSettleUp(selectedTab)}
                                    />
                                </div>
                            )}

                            {/* Management Actions */}
                            {selectedTab.status !== 'archived' && selectedTab.status !== 'cancelled' && (
                                <div style={{
                                    marginTop: '40px',
                                    paddingTop: '24px',
                                    borderTop: '1px solid var(--color-gray-100)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '12px'
                                }}>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        {selectedTab.status === 'paused' ? (
                                            <button
                                                onClick={() => handleResume(selectedTab)}
                                                style={{
                                                    flex: 1, padding: '12px', borderRadius: '12px',
                                                    background: 'var(--color-teal)', color: 'white',
                                                    fontWeight: '800', border: 'none', cursor: 'pointer'
                                                }}
                                            >
                                                ▶️ Resume Tab
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handlePause(selectedTab)}
                                                style={{
                                                    flex: 1, padding: '12px', borderRadius: '12px',
                                                    background: 'var(--color-gray-100)', color: 'var(--color-text)',
                                                    fontWeight: '700', border: 'none', cursor: 'pointer'
                                                }}
                                            >
                                                ⏸️ Pause Tab
                                            </button>
                                        )}
                                    </div>

                                    {parseFloat(selectedTab.running_total) === 0 ? (
                                        <button
                                            onClick={() => handleCancelAction(selectedTab, 'archive')}
                                            style={{
                                                width: '100%', padding: '12px', borderRadius: '12px',
                                                background: 'rgba(255,69,58,0.1)', color: '#FF453A',
                                                fontWeight: '700', border: 'none', cursor: 'pointer'
                                            }}
                                        >
                                            📦 Archive Tab
                                        </button>
                                    ) : (
                                        ((selectedTab.creator_id === user.id && selectedTab.direction !== 'out') || (selectedTab.creator_id !== user.id && selectedTab.direction === 'out')) ? (
                                            <div style={{ marginTop: '12px' }}>
                                                <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textAlign: 'center', marginBottom: '8px' }}>
                                                    They owe you money. You can forgive the debt to close this.
                                                </p>
                                                <ActionSlider
                                                    label="Slide to Forgive & Close"
                                                    successLabel="Debt Forgiven"
                                                    color="#FF453A"
                                                    onComplete={() => handleCancelAction(selectedTab, 'forgive')}
                                                />
                                            </div>
                                        ) : (
                                            <div style={{ marginTop: '12px' }}>
                                                <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textAlign: 'center', marginBottom: '8px' }}>
                                                    You have an outstanding balance. Settle it to close the tab.
                                                </p>
                                                <ActionSlider
                                                    label="Slide to Settle & Close"
                                                    successLabel="Settled & Closed"
                                                    onComplete={() => handleCancelAction(selectedTab, 'settle_close')}
                                                />
                                            </div>
                                        )
                                    )}
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Creator Modal */}
            <AnimatePresence>
                {showCreator && (
                    <TabCreator
                        onCreated={handleCreated}
                        onClose={() => setShowCreator(false)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

function AdderButton({ val, onAdd }) {
    const [holdInterval, setHoldInterval] = useState(null);

    const startHold = () => {
        onAdd();
        const interval = setInterval(() => {
            onAdd();
            triggerHaptic('light');
        }, 150);
        setHoldInterval(interval);
    };

    const stopHold = () => {
        if (holdInterval) {
            clearInterval(holdInterval);
            setHoldInterval(null);
        }
    };

    const label = val < 1 ? `${Math.round(val * 100)}p` : `£${val}`;

    return (
        <button
            onMouseDown={startHold}
            onMouseUp={stopHold}
            onMouseLeave={stopHold}
            onContextMenu={(e) => e.preventDefault()}
            onTouchStart={(e) => {
                if (e.cancelable) e.preventDefault();
                startHold();
            }}
            onTouchEnd={stopHold}
            style={{
                flex: 1, padding: '12px 0', borderRadius: '12px',
                background: 'white', color: 'var(--color-teal)',
                fontWeight: '800', fontSize: '14px', border: '1px solid var(--color-gray-200)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation'
            }}
        >
            {label}
        </button>
    );
}

import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { triggerHaptic, triggerNotificationHaptic, shareLink, pickContactNumber, isNativePlatform } from '../lib/capacitor';
import DatePickerSheet from './DatePickerSheet';
import PhoneInput from 'react-phone-number-input';
import useDefaultCountry from '../hooks/useDefaultCountry';
import { useAuth } from '../context/AuthContext';
import { trackEvent } from '../lib/posthog';
import ActionSlider from './ActionSlider';
import { motion, AnimatePresence } from 'framer-motion';

export default function PromiseCard({ onSend }) {
    const { user } = useAuth();
    const defaultCountry = useDefaultCountry();
    const [terms, setTerms] = useState('');
    const [phone, setPhone] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [sending, setSending] = useState(false);
    const [showRationale, setShowRationale] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [recents, setRecents] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('clinch_recents') || '[]');
        } catch { return []; }
    });

    const templates = [
        { label: "🛒 Buy/Sell", text: "I agree to buy the [Item] for £[Amount] and will pick it up by [Date]." },
        { label: "🏠 Split Bills", text: "I agree to transfer my half of the [Utility] bill (£[Amount]) by Friday." },
        { label: "🎨 Freelance", text: "I agree to pay the final £[Amount] invoice upon delivery of the project." },
        { label: "💸 Loan", text: "I promise to pay back the £[Amount] I borrowed by next Tuesday." },
        { label: "🤝 Bet", text: "If [Event] happens, I owe you [Amount or Item]." },
        { label: "📊 Equity/Shares", text: "I agree that [Name A] holds [X]% and [Name B] holds [Y]% equity in [Project]. To be formalized upon incorporation." }
    ];

    const handleTemplateClick = (text) => {
        setTerms(text);
        triggerHaptic('light');
    };

    const canSend = terms.trim().length > 5 && phone.trim().length > 5;

    const handlePickContact = async () => {
        triggerHaptic('medium');
        const number = await pickContactNumber();
        if (number) {
            setPhone(number);
            trackEvent('Contact Picked', { source: 'promise_card' });
        }
    };

    const addToRecents = (num) => {
        if (!num) return;
        const newRecents = [num, ...recents.filter(r => r !== num)].slice(0, 3);
        setRecents(newRecents);
        localStorage.setItem('clinch_recents', JSON.stringify(newRecents));
    };

    const handleSend = async () => {
        if (!canSend || sending) return;

        // Prevent self-promises
        const cleanPhone = phone.trim().replace(/\s+/g, '');
        const userPhone = (user?.phone || '').replace(/\s+/g, '');
        if (cleanPhone === userPhone) {
            alert("You can't send a Clinch to yourself!");
            return;
        }

        triggerHaptic('light');
        setSending(true);

        try {
            // 1. Save to Supabase
            const { data, error } = await supabase
                .from('clinches')
                .insert([
                    {
                        terms: terms.trim(),
                        recipient_phone: phone.trim(),
                        due_date: dueDate ? new Date(dueDate).toISOString() : null,
                        status: 'pending',
                        sender_id: user?.id || null,
                        sender_name: user?.user_metadata?.full_name || user?.phone || 'Someone',
                        sender_phone: user?.phone || null
                    }
                ])
                .select()
                .single();

            if (error) throw error;

            addToRecents(phone.trim());

            trackEvent('Link Generated', {
                clinch_id: data.id,
                is_authenticated: !!user,
                has_due_date: !!dueDate
            });

            const shareUrl = `https://clinch.to/agree/${data.id}`;
            const shareMessage = `I've sent you a Digital Handshake via Clinch: ${shareUrl}`;

            // 2. Trigger Native Share (Works on iOS/Android or fallback)
            try {
                const shared = await shareLink({
                    title: 'Clinch Handshake',
                    text: shareMessage,
                    url: shareUrl,
                });

                // If native share was unavailable or failed (e.g. user canceled), fallback to SMS
                if (!shared && !navigator.share) {
                    const smsUrl = `sms:${phone}?body=${encodeURIComponent(shareMessage)}`;
                    window.location.href = smsUrl;
                }
            } catch (shareErr) {
                console.warn("Share sheet was interrupted, but Clinch was still created.", shareErr);
            }

            setSending(false);
            onSend(terms, phone, shareUrl);
            setTerms('');
            setPhone('');
            setDueDate('');
        } catch (error) {
            console.error('CRITICAL: Database Insert Failed:', error);
            setSending(false);
            alert("Failed to create clinch: " + (error.message || JSON.stringify(error)));
        }
    };

    return (
        <div className="promise-card" id="promise-card">
            <img
                src="/assets/geometric-handshake.png"
                alt="Digital Handshake"
                className="promise-card__header-img"
            />

            <h2 className="promise-card__title">Make a Promise</h2>
            <p className="promise-card__subtitle">
                Type your agreement below and send a Clinch link
            </p>

            <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
                    <label className="form-label" htmlFor="clinch-terms" style={{ marginBottom: 0 }}>
                        The Terms
                    </label>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: '600' }}>Quick Tap 👇</span>
                </div>

                <div className="template-pills-container">
                    {templates.map((t, i) => (
                        <button
                            key={i}
                            type="button"
                            className="template-pill"
                            onClick={() => handleTemplateClick(t.text)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <textarea
                    id="clinch-terms"
                    className="form-textarea"
                    placeholder="e.g., I agree to hold the Sony Camera for Dave until Friday at 5 PM for $400."
                    value={terms}
                    onChange={e => setTerms(e.target.value)}
                    rows={4}
                />
            </div>

            <div className="form-group">
                <label className="form-label" htmlFor="clinch-phone">
                    Who is this for?
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                    <div style={{ flex: 1 }}>
                        <PhoneInput
                            className="clinch-phone-input"
                            id="clinch-phone"
                            placeholder="Enter phone number..."
                            defaultCountry={defaultCountry}
                            value={phone}
                            onChange={(val) => setPhone(val || '')}
                            style={{ margin: 0 }}
                            international
                            withCountryCallingCode
                            limitMaxLength
                            smartCaret={false}
                        />
                    </div>
                    {isNativePlatform() && (
                        <button
                            onClick={handlePickContact}
                            style={{
                                width: '48px', height: '48px', borderRadius: '12px',
                                background: 'var(--color-teal)', color: 'white',
                                fontSize: '20px', border: 'none', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: '0 4px 12px rgba(0,128,128,0.2)',
                                flexShrink: 0
                            }}
                        >
                            👤
                        </button>
                    )}
                </div>
                {recents.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: 'var(--color-text-secondary)', marginBottom: '6px', textTransform: 'uppercase' }}>
                            Recent ⚡️
                        </p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            {recents.map(r => (
                                <button
                                    key={r}
                                    onClick={() => { setPhone(r); triggerHaptic('light'); }}
                                    style={{
                                        padding: '6px 12px', borderRadius: '8px',
                                        background: 'var(--color-gray-100)', color: 'var(--color-text)',
                                        fontSize: '12px', fontWeight: '600', border: 'none'
                                    }}
                                >
                                    {r.length > 10 ? r.slice(-8) : r}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="form-group">
                <label className="form-label" htmlFor="due-date">
                    Due Date <span style={{ color: 'var(--color-text-secondary)', fontWeight: 'normal', fontSize: '12px' }}>(Optional Reminders)</span>
                </label>
                <div
                    onClick={() => { setShowDatePicker(true); triggerHaptic('light'); }}
                    style={{
                        height: '52px',
                        background: 'var(--color-gray-100)',
                        borderRadius: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: '700',
                        color: dueDate ? 'var(--color-teal)' : 'var(--color-text-secondary)',
                        border: dueDate ? '2px solid var(--color-teal-light)' : '2px solid transparent',
                        cursor: 'pointer'
                    }}
                >
                    {dueDate ? new Date(dueDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : "Pick a date"}
                </div>
            </div>

            <AnimatePresence>
                {canSend && (
                    <motion.div
                        initial={{ opacity: 0, height: 0, marginTop: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <ActionSlider
                            label="Slide to Send Handshake"
                            successLabel="Handshake Sent!"
                            disabled={sending}
                            onComplete={handleSend}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
            <DatePickerSheet
                isOpen={showDatePicker}
                onClose={() => setShowDatePicker(false)}
                onSelect={(date) => {
                    setDueDate(date ? date.toISOString() : '');
                    setShowDatePicker(false);
                    triggerHaptic('medium');
                }}
                value={dueDate}
            />
        </div>
    );
}

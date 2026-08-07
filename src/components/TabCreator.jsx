import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { triggerHaptic, triggerNotificationHaptic, shareLink, pickContactNumber, syncContacts, searchCachedContacts, isNativePlatform } from '../lib/capacitor';
import { trackEvent } from '../lib/posthog';
import PhoneInput from 'react-phone-number-input';
import useDefaultCountry from '../hooks/useDefaultCountry';
import { motion, AnimatePresence } from 'framer-motion';

export default function TabCreator({ onCreated, onClose }) {
    const { user } = useAuth();
    const defaultCountry = useDefaultCountry();

    const [step, setStep] = useState(1); // 1=amount, 2=details, 3=confirm
    const [direction, setDirection] = useState('in'); // 'in' = Request, 'out' = Pay
    const [amount, setAmount] = useState('');
    const [label, setLabel] = useState('');
    const [phone, setPhone] = useState('');
    const [contactResults, setContactResults] = useState([]);
    const [sending, setSending] = useState(false);
    const [frequency, setFrequency] = useState('monthly');
    const [settlementType, setSettlementType] = useState('amount'); // 'amount', 'date'
    const [dueDay, setDueDay] = useState(1);
    const [manualThreshold, setManualThreshold] = useState('');
    const [recents, setRecents] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('clinch_recents') || '[]');
        } catch { return []; }
    });

    // Auto-sync contacts in background
    useEffect(() => {
        if (isNativePlatform()) {
            const lastSync = localStorage.getItem('clinch_contacts_last_sync');
            const oneHour = 3600000;
            if (!lastSync || (Date.now() - parseInt(lastSync)) > oneHour) {
                syncContacts();
            }
        }
    }, []);

    // Search contacts as phone/name is typed
    useEffect(() => {
        if (phone.length >= 2) {
            const results = searchCachedContacts(phone);

            // Deduplicate by phone number (removing spaces/hyphens so +44 123 is same as +44123)
            const uniqueResults = [];
            const seenPhones = new Set();

            for (const r of results) {
                const rawNum = r.phoneNumbers?.[0]?.value;
                if (!rawNum) continue;

                const normalizedNum = rawNum.replace(/\s|-|\(|\)/g, '');
                if (!seenPhones.has(normalizedNum)) {
                    seenPhones.add(normalizedNum);
                    uniqueResults.push(r);
                }
            }

            setContactResults(uniqueResults);
        } else {
            setContactResults([]);
        }
    }, [phone]);

    const quickAmounts = [0.01, 1, 5, 10, 20, 50];

    const handleNumberPress = (num) => {
        triggerHaptic('light');
        if (num === '.' && amount.includes('.')) return;
        if (amount.includes('.') && amount.split('.')[1]?.length >= 2) return;
        setAmount(prev => prev + num);
    };

    const handleDelete = () => {
        triggerHaptic('light');
        setAmount(prev => prev.slice(0, -1));
    };

    const handleQuickAmount = (val) => {
        triggerHaptic('medium');
        setAmount(val.toString());
    };

    const goNext = () => {
        triggerHaptic('light');
        setStep(s => s + 1);
    };

    const goBack = () => {
        triggerHaptic('light');
        if (step === 1) {
            onClose?.();
        } else {
            setStep(s => s - 1);
        }
    };

    const handlePickContact = async () => {
        triggerHaptic('medium');
        const number = await pickContactNumber();
        if (number) {
            setPhone(number);
            trackEvent('Contact Picked', { source: 'tab_creator' });
        }
    };

    const addToRecents = (num) => {
        if (!num) return;
        const newRecents = [num, ...recents.filter(r => r !== num)].slice(0, 3);
        setRecents(newRecents);
        localStorage.setItem('clinch_recents', JSON.stringify(newRecents));
    };

    const handleCreate = async () => {
        if (sending) return;
        setSending(true);
        triggerHaptic('medium');

        try {
            const parsedAmount = parseFloat(amount);
            const autoThreshold = Math.max(5, parsedAmount * (frequency === 'weekly' ? 4 : 2));
            const finalThreshold = settlementType === 'amount'
                ? (parseFloat(manualThreshold) || autoThreshold)
                : parsedAmount;

            const { data, error } = await supabase
                .from('clinch_tabs')
                .insert([{
                    creator_id: user.id,
                    creator_name: user?.user_metadata?.full_name || 'Someone',
                    recipient_phone: phone.trim(),
                    label: label.trim(),
                    amount: parsedAmount,
                    frequency,
                    direction,
                    settle_threshold: finalThreshold,
                    settlement_type: settlementType,
                    due_day: dueDay,
                    running_total: 0,
                    next_due: new Date(
                        Date.now() + (frequency === 'weekly' ? 7 : 30) * 86400000
                    ).toISOString().split('T')[0],
                    status: 'pending'
                }])
                .select()
                .single();

            if (error) throw error;

            addToRecents(phone.trim());


            trackEvent('Tab Created', {
                amount: parsedAmount,
                frequency,
                label: label.trim()
            });

            triggerNotificationHaptic();

            // Share the tab link
            const shareUrl = `https://clinch.to/tab/${data.id}`;
            await shareLink({
                title: `Clinch Tab: ${label}`,
                text: `I've started a Clinch Tab with you for ${label} (£${parsedAmount}/${frequency}). Track it here: ${shareUrl}`,
                url: shareUrl
            });

            onCreated?.(data);
        } catch (err) {
            console.error('Tab creation failed:', err);
            alert('Failed to create tab: ' + (err.message || 'Unknown error'));
        } finally {
            setSending(false);
        }
    };

    const parsedAmount = parseFloat(amount) || 0;
    const canProceedStep1 = parsedAmount > 0;
    const canProceedStep2 = label.trim().length > 1 && phone.length > 5;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1100,
                background: 'var(--color-bg)',
                display: 'flex',
                flexDirection: 'column',
                paddingTop: 'calc(20px + env(safe-area-inset-top, 0px))',
                paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
                overflow: 'auto',
                boxShadow: '0 -4px 12px rgba(0,0,0,0.05)'
            }}
        >
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 20px',
                marginBottom: '8px'
            }}>
                <button
                    onClick={goBack}
                    style={{
                        width: '40px', height: '40px', borderRadius: '50%',
                        background: 'var(--color-gray-100)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        fontSize: '20px', cursor: 'pointer', color: 'var(--color-text)'
                    }}
                >
                    ←
                </button>
                <h2 style={{
                    fontSize: '17px', fontWeight: '800',
                    color: 'var(--color-text)', margin: 0
                }}>
                    {step === 1 ? 'Set Amount' : step === 2 ? 'Ongoing Details' : 'Confirm'}
                </h2>
                <div style={{ width: '40px' }} />
            </div>

            {/* Progress bar */}
            <div style={{ padding: '0 20px', marginBottom: '20px' }}>
                <div style={{
                    height: '4px', borderRadius: '2px',
                    background: 'var(--color-gray-200)', overflow: 'hidden'
                }}>
                    <motion.div
                        animate={{ width: `${(step / 3) * 100}%` }}
                        style={{
                            height: '100%', borderRadius: '2px',
                            background: direction === 'in'
                                ? 'linear-gradient(90deg, #22C55E, #98FF98)'
                                : 'linear-gradient(90deg, #008080, #7FFFD4)' // softer tail for paying
                        }}
                    />
                </div>
            </div>

            <AnimatePresence mode="wait">
                {/* ===== STEP 1: AMOUNT ===== */}
                {step === 1 && (
                    <motion.div
                        key="step1"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 20px' }}
                    >
                        {/* Request / Pay Toggle */}
                        <div style={{ display: 'flex', background: 'var(--color-gray-100)', borderRadius: '16px', padding: '6px', margin: '0 auto 24px', width: '100%', maxWidth: '280px' }}>
                            <button
                                onClick={() => { setDirection('in'); triggerHaptic('light'); }}
                                style={{ flex: 1, padding: '14px', borderRadius: '12px', background: direction === 'in' ? 'white' : 'transparent', color: direction === 'in' ? '#22C55E' : 'var(--color-text-secondary)', fontWeight: '800', border: 'none', cursor: 'pointer', boxShadow: direction === 'in' ? '0 2px 8px rgba(0,0,0,0.05)' : 'none', fontSize: '15px' }}
                            >
                                Requesting
                            </button>
                            <button
                                onClick={() => { setDirection('out'); triggerHaptic('light'); }}
                                style={{ flex: 1, padding: '14px', borderRadius: '12px', background: direction === 'out' ? 'white' : 'transparent', color: direction === 'out' ? '#008080' : 'var(--color-text-secondary)', fontWeight: '800', border: 'none', cursor: 'pointer', boxShadow: direction === 'out' ? '0 2px 8px rgba(0,0,0,0.05)' : 'none', fontSize: '15px' }}
                            >
                                Paying
                            </button>
                        </div>

                        {/* Big Amount Display */}
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            minHeight: '160px'
                        }}>
                            <p style={{
                                fontSize: '14px', color: 'var(--color-text-secondary)',
                                fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase',
                                letterSpacing: '1px'
                            }}>
                                Amount per cycle
                            </p>
                            <div style={{
                                fontSize: amount.length > 5 ? '48px' : '64px',
                                fontWeight: '900',
                                color: parsedAmount > 0 ? (direction === 'in' ? '#22C55E' : 'var(--color-teal)') : 'var(--color-gray-300)',
                                letterSpacing: '-3px',
                                transition: 'all 0.15s ease',
                                lineHeight: 1
                            }}>
                                £{amount || '0'}
                            </div>
                        </div>

                        {/* Quick Amount Pills */}
                        <div style={{
                            display: 'flex', gap: '8px', justifyContent: 'center',
                            marginBottom: '20px', flexWrap: 'wrap'
                        }}>
                            {quickAmounts.map(q => (
                                <button
                                    key={q}
                                    onClick={() => handleQuickAmount(q)}
                                    style={{
                                        padding: '10px 18px', borderRadius: '100px',
                                        background: parsedAmount === q ? 'var(--color-teal)' : 'var(--color-gray-100)',
                                        color: parsedAmount === q ? 'white' : 'var(--color-text)',
                                        fontWeight: '700', fontSize: '15px', cursor: 'pointer',
                                        border: 'none', transition: 'all 0.15s'
                                    }}
                                >
                                    £{q}
                                </button>
                            ))}
                        </div>

                        {/* Numpad */}
                        <div style={{
                            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: '8px', maxWidth: '320px', margin: '0 auto', width: '100%'
                        }}>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, '.', 0, '⌫'].map(key => (
                                <button
                                    key={key}
                                    onClick={() => key === '⌫' ? handleDelete() : handleNumberPress(String(key))}
                                    style={{
                                        height: '56px', borderRadius: '16px',
                                        background: key === '⌫' ? 'transparent' : 'var(--color-gray-100)',
                                        color: 'var(--color-text)', fontSize: '22px', fontWeight: '600',
                                        cursor: 'pointer', border: 'none',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'transform 0.1s'
                                    }}
                                >
                                    {key}
                                </button>
                            ))}
                        </div>

                        <button
                            className="btn-primary"
                            onClick={goNext}
                            disabled={!canProceedStep1}
                            style={{ marginTop: '16px' }}
                        >
                            Next
                        </button>
                    </motion.div>
                )}

                {/* ===== STEP 2: DETAILS ===== */}
                {step === 2 && (
                    <motion.div
                        key="step2"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 20px' }}
                    >
                        {/* Amount recap */}
                        <div style={{
                            textAlign: 'center', padding: '16px',
                            background: 'var(--color-gray-100)', borderRadius: '16px',
                            marginBottom: '24px'
                        }}>
                            <span style={{ fontSize: '32px', fontWeight: '900', color: 'var(--color-teal)' }}>
                                £{parsedAmount.toFixed(2)}
                            </span>
                            <span style={{ fontSize: '15px', color: 'var(--color-text-secondary)', marginLeft: '4px', fontWeight: '600' }}>
                                /{frequency === 'weekly' ? 'week' : 'month'}
                            </span>
                            <div style={{
                                background: 'rgba(0,128,128,0.1)',
                                color: 'var(--color-teal)',
                                fontSize: '10px',
                                fontWeight: '900',
                                padding: '4px 8px',
                                borderRadius: '100px',
                                marginLeft: '12px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                            }}>
                                🔄 Recurring
                            </div>
                        </div>

                        {/* What's it for? */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{
                                fontSize: '13px', fontWeight: '700',
                                color: 'var(--color-teal)', marginBottom: '8px',
                                display: 'block', letterSpacing: '0.02em'
                            }}>
                                What's it for?
                            </label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="e.g., Coffee Fund, Gym Split, Rent..."
                                value={label}
                                onChange={e => setLabel(e.target.value)}
                                autoFocus
                                maxLength={50}
                                style={{ fontSize: '16px' }}
                            />
                        </div>

                        {/* Settlement Trigger */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{
                                fontSize: '13px', fontWeight: '700',
                                color: 'var(--color-teal)', marginBottom: '8px',
                                display: 'block'
                            }}>
                                Settlement Trigger
                            </label>
                            <div style={{
                                display: 'flex', gap: '8px',
                                background: 'var(--color-gray-100)', borderRadius: '12px',
                                padding: '4px', marginBottom: '8px'
                            }}>
                                <button
                                    onClick={() => { setSettlementType('amount'); triggerHaptic('light'); }}
                                    style={{
                                        flex: 1, padding: '10px', borderRadius: '10px',
                                        background: settlementType === 'amount' ? 'var(--color-teal)' : 'transparent',
                                        color: settlementType === 'amount' ? 'white' : 'var(--color-text)',
                                        fontWeight: '700', fontSize: '13px', border: 'none'
                                    }}
                                >
                                    When it hits £...
                                </button>
                                <button
                                    onClick={() => { setSettlementType('date'); triggerHaptic('light'); }}
                                    style={{
                                        flex: 1, padding: '10px', borderRadius: '10px',
                                        background: settlementType === 'date' ? 'var(--color-teal)' : 'transparent',
                                        color: settlementType === 'date' ? 'white' : 'var(--color-text)',
                                        fontWeight: '700', fontSize: '13px', border: 'none'
                                    }}
                                >
                                    On a specific day
                                </button>
                            </div>

                            {settlementType === 'date' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Settle on day</span>
                                    <select
                                        value={dueDay}
                                        onChange={(e) => setDueDay(parseInt(e.target.value))}
                                        style={{
                                            padding: '8px', borderRadius: '8px', border: '1px solid var(--color-gray-200)',
                                            background: 'white', fontSize: '14px', fontWeight: '700'
                                        }}
                                    >
                                        {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                                            <option key={d} value={d}>{d}{d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}</option>
                                        ))}
                                    </select>
                                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>of every month</span>
                                </div>
                            )}

                            {settlementType === 'amount' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Settle when it hits £</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        placeholder={Math.max(5, parsedAmount * (frequency === 'weekly' ? 4 : 2))}
                                        value={manualThreshold}
                                        onChange={e => setManualThreshold(e.target.value)}
                                        style={{
                                            width: '80px', padding: '8px', borderRadius: '8px',
                                            border: '1px solid var(--color-gray-200)',
                                            background: 'white', fontSize: '14px', fontWeight: '700'
                                        }}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Who owes you? */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{
                                fontSize: '13px', fontWeight: '700',
                                color: 'var(--color-teal)', marginBottom: '8px',
                                display: 'block'
                            }}>
                                {direction === 'in' ? 'Who owes you?' : 'Who are you paying?'}
                            </label>

                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <div style={{ flex: 1 }}>
                                    <PhoneInput
                                        className="clinch-phone-input"
                                        placeholder="Their phone number"
                                        defaultCountry={defaultCountry}
                                        value={phone}
                                        onChange={val => setPhone(val || '')}
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
                                            width: '44px', height: '44px', borderRadius: '12px',
                                            background: 'var(--color-teal)', color: 'white',
                                            fontSize: '20px', border: 'none', cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            boxShadow: '0 4px 12px rgba(0,128,128,0.2)'
                                        }}
                                        title="Pick Contact"
                                    >
                                        👤
                                    </button>
                                )}
                            </div>

                            {/* Contact Search Results */}
                            {contactResults.length > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    style={{
                                        marginTop: '12px',
                                        background: 'var(--color-gray-100)',
                                        borderRadius: '12px',
                                        overflow: 'hidden',
                                        border: '1px solid var(--color-teal)'
                                    }}
                                >
                                    {contactResults.map((c, i) => (
                                        <button
                                            key={c.id || i}
                                            onClick={() => {
                                                const num = c.phoneNumbers?.[0]?.value;
                                                if (num) setPhone(num);
                                                setContactResults([]);
                                                triggerHaptic('medium');
                                            }}
                                            style={{
                                                width: '100%',
                                                padding: '12px 16px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                border: 'none',
                                                background: 'transparent',
                                                borderBottom: i === contactResults.length - 1 ? 'none' : '1px solid var(--color-gray-200)',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <div style={{ textAlign: 'left' }}>
                                                <div style={{ fontWeight: '700', fontSize: '14px', color: 'var(--color-text)' }}>{c.fullName}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{c.phoneNumbers?.[0]?.value}</div>
                                            </div>
                                            <span style={{ fontSize: '16px' }}>⚡️</span>
                                        </button>
                                    ))}
                                </motion.div>
                            )}

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

                        <div style={{ flex: 1 }} />

                        <button
                            className="btn-primary"
                            onClick={goNext}
                            disabled={!canProceedStep2}
                        >
                            Review
                        </button>
                    </motion.div>
                )}

                {/* ===== STEP 3: CONFIRM ===== */}
                {step === 3 && (
                    <motion.div
                        key="step3"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 20px' }}
                    >
                        {/* Confirmation Card */}
                        <div style={{
                            background: direction === 'in'
                                ? 'linear-gradient(135deg, #22C55E 0%, #15803D 100%)'
                                : 'linear-gradient(135deg, #008080 0%, #004D4D 100%)',
                            borderRadius: '24px', padding: '32px 24px', textAlign: 'center',
                            color: 'white', marginBottom: '24px',
                            boxShadow: direction === 'in'
                                ? '0 12px 32px rgba(34, 197, 94, 0.3)'
                                : '0 12px 32px rgba(0, 128, 128, 0.3)'
                        }}>
                            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔄</div>
                            <div style={{ fontSize: '42px', fontWeight: '900', letterSpacing: '-2px', marginBottom: '4px' }}>
                                £{parsedAmount.toFixed(2)}
                            </div>
                            <div style={{
                                fontSize: '16px', fontWeight: '600', opacity: 0.9,
                                marginBottom: '16px'
                            }}>
                                {frequency === 'weekly' ? 'Every Week' : 'Every Month'}
                            </div>

                            <div style={{
                                background: 'rgba(0,0,0,0.15)', borderRadius: '12px',
                                padding: '12px 16px', fontSize: '15px', fontWeight: '700'
                            }}>
                                {label}
                            </div>

                            <div style={{
                                marginTop: '12px', fontSize: '13px', opacity: 0.7
                            }}>
                                {direction === 'in' ? '← Requesting from' : '→ Paying to'} {phone}
                            </div>
                        </div>

                        {/* Info */}
                        <div style={{
                            background: 'var(--color-gray-100)', borderRadius: '16px',
                            padding: '16px', marginBottom: '16px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                <span style={{ fontSize: '18px' }}>💡</span>
                                <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--color-text)' }}>
                                    How Tabs Work
                                </span>
                            </div>
                            <p style={{
                                fontSize: '13px', color: 'var(--color-text-secondary)',
                                lineHeight: '1.5', margin: 0
                            }}>
                                {settlementType === 'date' ? (
                                    `Clinch tracks what's owed automatically. We'll remind them to settle up on the ${dueDay}${dueDay === 1 ? 'st' : dueDay === 2 ? 'nd' : dueDay === 3 ? 'rd' : 'th'} of every month. No money moves through Clinch — just the promise.`
                                ) : (
                                    `Clinch tracks what's owed automatically. When the tab reaches £${(parseFloat(manualThreshold) || Math.max(5, parsedAmount * (frequency === 'weekly' ? 4 : 2))).toFixed(0)}, we'll remind them to settle up. No money moves through Clinch — just the promise.`
                                )}
                            </p>
                        </div>

                        <div style={{ flex: 1 }} />

                        <button
                            className="btn-primary"
                            onClick={handleCreate}
                            disabled={sending}
                            style={{
                                background: 'linear-gradient(90deg, #98FF98, #7AE07A)',
                                fontSize: '18px'
                            }}
                        >
                            {sending ? 'Creating...' : '🤝 Start Ongoing Tab'}
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

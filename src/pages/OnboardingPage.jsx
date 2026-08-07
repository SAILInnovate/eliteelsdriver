import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import PhoneInput from 'react-phone-number-input';
import useDefaultCountry from '../hooks/useDefaultCountry';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { useLanguage } from '../context/LanguageContext';

function humaniseError(raw) {
    const msg = (raw || '').toLowerCase();
    if (msg.includes('database')) return 'Unable to connect right now. Please try again.';
    if (msg.includes('rate') || msg.includes('limit')) return 'Too many attempts. Please wait a moment.';
    if (msg.includes('invalid') && msg.includes('code')) return 'That code didn\u2019t work. Please re-enter.';
    if (msg.includes('expired')) return 'Code expired. Tap Back to request a new one.';
    if (msg.includes('phone')) return 'Please check the number and try again.';
    if (msg.includes('network') || msg.includes('fetch')) return 'Connection issue. Check your signal and retry.';
    return 'Something went wrong. Please try again.';
}

const haptic = async (style = ImpactStyle.Light) => {
    try { await Haptics.impact({ style }); } catch (e) {}
};

const hapticNotify = async (type = NotificationType.Success) => {
    try { await Haptics.notification({ type }); } catch (e) {}
};

export default function OnboardingPage() {
    const { sendPhoneOtp, verifyPhoneOtp, user } = useAuth();
    const defaultCountry = useDefaultCountry();
    const { t, isRTL } = useLanguage();

    const humaniseError = (raw) => {
        const msg = (raw || '').toLowerCase();
        if (msg.includes('database')) return t('errConnect');
        if (msg.includes('rate') || msg.includes('limit')) return t('errRateLimit');
        if (msg.includes('invalid') && msg.includes('code')) return t('errInvalidCode');
        if (msg.includes('expired')) return t('errExpired');
        if (msg.includes('phone')) return t('errPhone');
        if (msg.includes('network') || msg.includes('fetch')) return t('errNetwork');
        return t('errGeneric');
    };

    const [phone, setPhone] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState(null);
    const [cooldown, setCooldown] = useState(0);

    const handleSendOtp = async () => {
        if (!phone || phone.length < 5) {
            hapticNotify(NotificationType.Error);
            setAuthError(t('errValidNumber'));
            return;
        }
        haptic(ImpactStyle.Medium);
        setAuthLoading(true);
        setAuthError(null);
        try {
            await sendPhoneOtp(phone);
            hapticNotify(NotificationType.Success);
            setOtpSent(true);
            setCooldown(60);
        } catch (err) {
            console.error(err);
            hapticNotify(NotificationType.Error);
            setAuthError(humaniseError(err.message));
        } finally {
            setAuthLoading(false);
        }
    };

    const isVerifyingRef = useRef(false);

    // 60s cooldown timer
    useEffect(() => {
        if (cooldown <= 0) return;
        const id = setTimeout(() => setCooldown(c => c - 1), 1000);
        return () => clearTimeout(id);
    }, [cooldown]);

    const handleVerifyOtp = async () => {
        if (!otpCode || otpCode.length < 6) {
            hapticNotify(NotificationType.Error);
            setAuthError(t('errCode'));
            return;
        }
        if (isVerifyingRef.current) return;
        isVerifyingRef.current = true;
        haptic(ImpactStyle.Medium);
        setAuthLoading(true);
        setAuthError(null);
        try {
            await verifyPhoneOtp(phone, otpCode);
            hapticNotify(NotificationType.Success);
        } catch (err) {
            console.error(err);
            hapticNotify(NotificationType.Error);
            setAuthError(humaniseError(err.message));
            isVerifyingRef.current = false;
        } finally {
            setAuthLoading(false);
        }
    };

    const verifiedCode = useRef(null);

    useEffect(() => {
        if (otpCode.length === 6 && !authLoading && otpCode !== verifiedCode.current) {
            verifiedCode.current = otpCode;
            handleVerifyOtp();
        }
    }, [otpCode]);

    const handleOtpChange = (e) => {
        const val = e.target.value.replace(/\D/g, '');
        if (val.length > otpCode.length) haptic(ImpactStyle.Light);
        setOtpCode(val);
    };

    const handleKeyDownPhone = (e) => {
        if (e.key === 'Enter') handleSendOtp();
    };

    const handleKeyDownOtp = (e) => {
        if (e.key === 'Enter') handleVerifyOtp();
    };

    if (user) {
        return <Navigate to="/" />;
    }

    const btnBase = {
        width: '100%',
        height: '56px',
        background: '#000000',
        color: '#FFFFFF',
        fontSize: '0.6875rem',
        letterSpacing: '4px',
        textTransform: 'uppercase',
        fontWeight: 600,
        border: 'none',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent'
    };

    return (
        <motion.div
            className="onboarding"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
            style={{ 
                height: '100dvh', 
                display: 'flex', 
                flexDirection: 'column', 
                background: 'transparent',
                color: '#FFFFFF',
                // --kb keeps the content box above the keyboard (Capacitor
                // resize: "none" means the OS won't shrink the webview for us)
                padding: 'calc(var(--safe-top) + 24px) 24px calc(var(--safe-bottom) + 24px + var(--kb, 0px)) 24px',
                transition: 'padding-bottom 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)',
                fontFamily: 'var(--font-family)',
                overflow: 'hidden',
                position: 'fixed',
                inset: 0
            }}
        >
            {/* Background video handled by shared layer in App.jsx */}
            <Helmet>
                <title>Elite ELS</title>
            </Helmet>

            {/* Top section — logo + input in the upper third */}
            <div style={{ width: '100%', maxWidth: '340px', margin: '0 auto', paddingTop: '10vh', position: 'relative', zIndex: 1 }}>
                
                {/* Logo — small, left-aligned, editorial */}
                <motion.img
                    src="/elitels.png"
                    alt="Elite"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.9 }}
                    transition={{ duration: 0.8, delay: 0.1 }}
                    style={{ height: '48px', marginBottom: '40px' }}
                />

                {/* Error */}
                {authError && (
                    <motion.p 
                        initial={{ opacity: 0, y: -5 }} 
                        animate={{ opacity: 1, y: 0 }}
                        style={{ color: '#FF6B6B', fontSize: '0.75rem', marginBottom: '20px', fontWeight: 500, letterSpacing: '0.5px' }}
                    >
                        {authError}
                    </motion.p>
                )}

                {!otpSent ? (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}>
                        
                        <h1 style={{ 
                            fontFamily: 'var(--font-display)', 
                            fontSize: '2rem', 
                            fontWeight: 400,
                            color: '#FFFFFF',
                            marginBottom: '6px',
                            letterSpacing: '-0.02em'
                        }}>
                            {t('welcome')}
                        </h1>
                        <p style={{ 
                            fontSize: '0.8125rem',
                            color: 'rgba(255,255,255,0.6)',
                            marginBottom: '32px',
                            fontWeight: 400
                        }}>
                            {t('enterMobile')}
                        </p>

                        <PhoneInput
                            placeholder="Mobile Number"
                            defaultCountry={defaultCountry}
                            value={phone}
                            onChange={(val) => setPhone(val || '')}
                            onKeyDown={handleKeyDownPhone}
                            international
                            withCountryCallingCode
                            limitMaxLength
                            smartCaret={false}
                            autoFocus
                            style={{ marginBottom: '24px' }}
                        />
                        <motion.button 
                            onClick={handleSendOtp} 
                            disabled={authLoading || !phone || phone.length < 5}
                            whileTap={{ scale: 0.97 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                            style={{
                                ...btnBase,
                                opacity: (authLoading || !phone || phone.length < 5) ? 0.25 : 1,
                                transition: 'opacity 0.5s ease'
                            }}
                        >
                            {authLoading ? '...' : t('continue')}
                        </motion.button>
                    </motion.div>
                ) : (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
                        
                        <h1 style={{ 
                            fontFamily: 'var(--font-display)', 
                            fontSize: '2rem', 
                            fontWeight: 400,
                            color: '#FFFFFF',
                            marginBottom: '6px',
                            letterSpacing: '-0.02em'
                        }}>
                            {t('verify')}
                        </h1>
                        <p style={{ 
                            fontSize: '0.8125rem',
                            color: 'rgba(255,255,255,0.6)',
                            marginBottom: '32px',
                            fontWeight: 400
                        }}>
                            {t('enterCode')}
                        </p>

                        <input
                            type="text"
                            inputMode="numeric"
                            placeholder="••••••"
                            value={otpCode}
                            onChange={handleOtpChange}
                            onKeyDown={handleKeyDownOtp}
                            autoFocus
                            maxLength={6}
                            style={{ 
                                width: '100%',
                                background: 'transparent',
                                border: 'none',
                                borderBottom: '1px solid rgba(255,255,255,0.25)',
                                color: '#FFFFFF',
                                fontFamily: 'var(--font-family)',
                                fontSize: '1.5rem',
                                outline: 'none',
                                fontWeight: 500,
                                letterSpacing: '12px',
                                textAlign: 'center',
                                height: '56px',
                                marginBottom: '24px',
                                transition: 'border-color 0.3s ease',
                                caretColor: '#FFFFFF'
                            }}
                        />
                        <motion.button 
                            onClick={handleVerifyOtp} 
                            disabled={authLoading || otpCode.length < 6}
                            whileTap={{ scale: 0.97 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                            style={{
                                ...btnBase,
                                opacity: (authLoading || otpCode.length < 6) ? 0.25 : 1,
                                transition: 'opacity 0.5s ease',
                                marginBottom: '16px'
                            }}
                        >
                            {authLoading ? '...' : t('verifyBtn')}
                        </motion.button>
                        <motion.button 
                            onClick={() => { if (cooldown > 0) return; haptic(); setOtpSent(false); setAuthError(null); setOtpCode(''); verifiedCode.current = null; isVerifyingRef.current = false; }} 
                            whileTap={cooldown > 0 ? {} : { scale: 0.95 }}
                            style={{ 
                                width: '100%', 
                                background: 'transparent', 
                                border: 'none', 
                                color: cooldown > 0 ? '#EBEBEB' : '#888888', 
                                fontSize: '0.75rem',
                                letterSpacing: '1px',
                                textTransform: 'uppercase',
                                fontWeight: 500,
                                cursor: cooldown > 0 ? 'default' : 'pointer',
                                WebkitTapHighlightColor: 'transparent',
                                transition: 'color 0.3s ease'
                            }}
                        >
                            {cooldown > 0 ? `${t('back')} · ${cooldown}s` : t('back')}
                        </motion.button>
                    </motion.div>
                )}
            </div>

            {/* Bottom spacer — pushes content to upper area */}
            <div style={{ flex: 1 }} />
        </motion.div>
    );
}

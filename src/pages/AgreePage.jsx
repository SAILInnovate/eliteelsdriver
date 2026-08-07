import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { triggerNotificationHaptic, triggerHaptic, triggerSelectionHaptic } from '../lib/capacitor';
import PhoneInput from 'react-phone-number-input';
import useDefaultCountry from '../hooks/useDefaultCountry';
import { Helmet } from 'react-helmet-async';
import { trackEvent } from '../lib/posthog';
import ActionSlider from '../components/ActionSlider';
import { useAuth } from '../context/AuthContext';

export default function AgreePage() {
    const { user } = useAuth();
    const defaultCountry = useDefaultCountry();
    const { id } = useParams();
    const [agreement, setAgreement] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [agreed, setAgreed] = useState(false);
    const [consentChecked, setConsentChecked] = useState(false);

    // Identity Verification States
    const [recipientPhone, setRecipientPhone] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [isVerified, setIsVerified] = useState(false);
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState(null);

    useEffect(() => {
        async function fetchAgreement() {
            if (!id || id === 'demo-id') {
                setAgreement({
                    sender: 'Dave Smith',
                    terms: 'I, Sarah, agree to pay Dave £150 for the shared electric bill by this Friday.',
                    created_at: new Date().toISOString(),
                });
                setLoading(false);
                return;
            }

            try {
                const { data, error } = await supabase
                    .from('clinches')
                    .select('*, sender:user_subscriptions(tier)')
                    .eq('id', id)
                    .single();

                if (error) throw error;
                // Currently sender name might not be stored. You might want to get it from profiles or just use their ID, 
                // but since we only saved 'recipient_email', we don't have sender name in DB yet unless auth is setup.
                // For MVP, we'll just show 'Someone' or if 'sender_email' is there.
                setAgreement({
                    id: data.id,
                    sender: data.sender_name || 'Someone',
                    terms: data.terms,
                    status: data.status,
                    created_at: data.created_at || new Date().toISOString(),
                    sender_tier: data.sender?.tier || 'free'
                });
            } catch (err) {
                console.error(err);
                setError('Failed to load agreement. The link may be invalid.');
            } finally {
                setLoading(false);
            }
        }

        fetchAgreement();
    }, [id]);

    const handleClinchSuccess = async () => {
        try {
            if (id && id !== 'demo-id') {
                // Call the secure server-side function to legally stamp IP and exact server time
                const { error: rpcError } = await supabase.rpc('seal_clinch', { clinch_id: id });

                if (rpcError) throw rpcError;

                trackEvent('Link Accepted', {
                    clinch_id: id,
                    sender_tier: agreement.sender_tier
                });
            }

            setTimeout(() => {
                setAgreed(true);
            }, 300);
        } catch (err) {
            console.error("Error saving clinch", err);
            alert("There was an error sealing this agreement. Please try again.");
        }
    };

    const handleReject = async () => {
        const confirmReject = window.confirm("Decline this agreement?\n\nThis will permanently reject the request and log it in the audit trail.");
        if (!confirmReject) return;

        try {
            triggerHaptic('warning');
            const { error: rejectError } = await supabase
                .from('clinches')
                .update({ status: 'rejected', rejected_at: new Date().toISOString() })
                .eq('id', id);

            if (rejectError) throw rejectError;

            trackEvent('Link Rejected', { clinch_id: id });
            setAgreement(prev => ({ ...prev, status: 'rejected' }));
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            console.error(err);
            alert("Failed to reject agreement.");
        }
    };

    const isVerifyingRef = useRef(false);
    const verifiedCode = useRef(null);

    // Auto-submit when 6 digits are entered
    useEffect(() => {
        if (otpCode.length === 6 && !authLoading && id !== 'demo-id' && otpCode !== verifiedCode.current) {
            verifiedCode.current = otpCode;
            handleVerifyOtp();
        }
    }, [otpCode, authLoading, id]);

    const handleSendOtp = async () => {
        if (!recipientPhone || recipientPhone.length < 5) {
            setAuthError("Please enter a valid phone number.");
            return;
        }
        setAuthLoading(true);
        setAuthError(null);
        try {
            if (id !== 'demo-id') {
                const { error } = await supabase.auth.signInWithOtp({ phone: recipientPhone });
                if (error) throw error;
            }
            setOtpSent(true);
        } catch (err) {
            console.error(err);
            setAuthError(err.message || 'Failed to send verification code.');
        } finally {
            setAuthLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        if (!otpCode || otpCode.length < 6) {
            setAuthError("Please enter the 6-digit code.");
            return;
        }
        if (isVerifyingRef.current) return;
        isVerifyingRef.current = true;
        setAuthLoading(true);
        setAuthError(null);
        try {
            if (id !== 'demo-id') {
                const { error } = await supabase.auth.verifyOtp({
                    phone: recipientPhone,
                    token: otpCode,
                    type: 'sms'
                });
                if (error) throw error;
            }
            setIsVerified(true);
            // Don't reset isVerifyingRef on success so the view cleanly shifts state
        } catch (err) {
            console.error(err);
            setAuthError(err.message || 'Invalid code. Please try again.');
            isVerifyingRef.current = false;
        } finally {
            setAuthLoading(false);
        }
    };
    if (loading) {
        return (
            <div className="agree-screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <img src="/assets/clinch-logo.png" alt="Loading..." className="agree-header__logo" style={{
                        height: '64px',
                        opacity: 0.5,
                        animation: 'pulse 1.5s ease-in-out infinite'
                    }} />
                    <p style={{
                        marginTop: '24px',
                        fontSize: '14px',
                        color: 'var(--color-text-secondary)',
                        fontWeight: '700',
                        letterSpacing: '1px',
                        textTransform: 'uppercase'
                    }}>
                        Opening Vault...
                    </p>
                </div>
                <style>{`
                    @keyframes pulse {
                        0%, 100% { opacity: 0.3; transform: scale(0.95); }
                        50% { opacity: 0.8; transform: scale(1.05); }
                    }
                `}</style>
            </div>
        );
    }

    if (error || (!loading && !agreement)) {
        return (
            <div className="agree-screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '0 32px' }}>
                <Helmet>
                    <title>Agreement Not Found | Clinch</title>
                </Helmet>

                <div style={{
                    width: '100px',
                    height: '100px',
                    background: 'rgba(255, 69, 58, 0.1)',
                    borderRadius: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '28px',
                    transform: 'rotate(-5deg)',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.05)'
                }}>
                    <span style={{ fontSize: '48px' }}>⚠️</span>
                </div>

                <h1 style={{
                    fontSize: '28px',
                    fontWeight: '800',
                    color: 'var(--color-text)',
                    marginBottom: '12px',
                    letterSpacing: '-0.5px'
                }}>
                    Clinch Not Found
                </h1>

                <p style={{
                    fontSize: '16px',
                    color: 'var(--color-text-secondary)',
                    lineHeight: '1.6',
                    marginBottom: '40px',
                    maxWidth: '280px'
                }}>
                    {error || "This agreement link is invalid, expired, or has been removed from the vault."}
                </p>

                <button
                    className="btn-primary"
                    onClick={() => window.location.href = '/'}
                    style={{ width: '100%', maxWidth: '240px' }}
                >
                    Return to App
                </button>

                <p style={{ marginTop: '24px', fontSize: '13px', color: 'var(--color-gray-400)' }}>
                    Need help? Contact support@clinch.to
                </p>
            </div>
        );
    }



    const handleKeyDownPhone = (e) => {
        if (e.key === 'Enter') {
            handleSendOtp();
        }
    };

    const handleKeyDownOtp = (e) => {
        if (e.key === 'Enter') {
            handleVerifyOtp();
        }
    };

    if (agreement && agreement.status === 'rejected') {
        return (
            <div className="agree-page--success" style={{ background: '#FFFFFF' }}>
                <Helmet>
                    <title>Agreement Rejected | Clinch</title>
                </Helmet>

                <div style={{
                    width: '80px', height: '80px', borderRadius: '50%',
                    background: 'rgba(255, 69, 58, 0.15)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', marginBottom: '32px'
                }}>
                    <span style={{ fontSize: '40px' }}>👎</span>
                </div>

                <h1 className="success-title" style={{ color: '#FF453A' }}>Rejected</h1>
                <p className="success-text">
                    You have formally declined this agreement. It has been permanently marked as rejected in the audit trail.
                </p>

                <div className="viral-invite-card" style={{ marginTop: '48px' }}>
                    <button
                        className="btn-primary"
                        onClick={() => window.location.href = user ? '/' : '/login'}
                        style={{ background: '#2C2C2E', color: 'white' }}
                    >
                        {user ? 'Go to Dashboard' : 'Start Clinching Free'}
                    </button>
                </div>
            </div>
        );
    }

    if (agreed) {
        return (
            <div className="agree-page--success">
                <Helmet>
                    <title>Successfully Clinched!</title>
                    <meta name="description" content="Agreement secured. Start building your trust graph with Clinch today." />
                </Helmet>
                <div className="success-confetti">
                    <div className="success-checkmark">✓</div>
                </div>

                <img src="/assets/geometric-handshake.png" alt="Clinched" className="success-handshake" />

                <h1 className="success-title">Clinched!</h1>
                <p className="success-text">
                    The deal is sealed. This agreement is now locked in the vault for both of you.
                </p>

                {user ? (
                    <div className="viral-invite-card">
                        <h3>Agreement sealed ✅</h3>
                        <p>This clinch is now in your vault. You can view it anytime from your dashboard.</p>
                        <button
                            className="btn-primary"
                            onClick={() => window.location.href = '/'}
                        >
                            Go to Dashboard
                        </button>
                    </div>
                ) : (
                    <div className="viral-invite-card">
                        <h3>Need to clinch to something?</h3>
                        <p>Next time you need someone to stick to their word, send a Digital Handshake in seconds.</p>
                        <button
                            className="btn-primary"
                            onClick={() => window.location.href = '/login'}
                        >
                            Start Clinching Free
                        </button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="agree-screen">
            <Helmet>
                <title>You're invited to Clinch | Secure Digital Handshake</title>
                <meta name="description" content="Review and secure your pending digital agreement using SMS verification." />
            </Helmet>
            <div className="agree-header">
                <img src="/assets/clinch-logo.png" alt="Clinch" className="agree-header__logo" />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <div className="agree-header__badge">
                        🤝 You're invited to Clinch
                    </div>
                    {agreement.sender_tier === 'pro' && (
                        <div style={{
                            background: 'linear-gradient(90deg, #FFD700, #B8860B)',
                            color: 'white',
                            fontSize: '11px',
                            fontWeight: '800',
                            padding: '4px 10px',
                            borderRadius: '20px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            display: 'inline-block',
                            width: 'fit-content',
                            boxShadow: '0 2px 5px rgba(184, 134, 11, 0.3)',
                            alignSelf: 'center'
                        }}>
                            Verified Pro Sender
                        </div>
                    )}
                </div>
            </div>

            <div className="agreement-card">
                <div className="agreement-card__icon">
                    <img src="/assets/breaking-chain.png" alt="Agreement" style={{ width: '32px' }} />
                </div>

                <p className="agree-card__sender">
                    <strong>{agreement.sender}</strong> wants to lock this in:
                </p>

                <div className="agreement-card__terms">
                    "{agreement.terms}"
                </div>

                <div className="agreement-card__meta">
                    Generated: {new Date(agreement.created_at).toLocaleDateString()}
                    <br />
                    IP and Timestamp will be recorded upon agreement.
                </div>
            </div>

            {!isVerified ? (
                <div className="auth-section" style={{
                    background: 'var(--color-white)',
                    borderRadius: '24px',
                    padding: '24px',
                    marginBottom: '24px',
                    boxShadow: 'var(--shadow-lg)',
                    border: '1px solid var(--color-gray-200)',
                    textAlign: 'center'
                }}>
                    <h3 style={{ marginBottom: '8px', color: 'var(--color-teal)', fontWeight: '800' }}>Verify your identity to clinch</h3>
                    <p style={{ fontSize: '15px', color: 'var(--color-text-secondary)', marginBottom: '24px', lineHeight: '1.5' }}>
                        We need to confirm it's really you before sealing this handshake.
                    </p>

                    {authError && <p style={{ color: '#ff453a', fontSize: '13px', marginBottom: '12px' }}>{authError}</p>}

                    {!otpSent ? (
                        <>
                            <PhoneInput
                                className="clinch-phone-input"
                                placeholder="Phone number"
                                defaultCountry={defaultCountry}
                                value={recipientPhone}
                                onChange={(val) => setRecipientPhone(val || '')}
                                onKeyDown={handleKeyDownPhone}
                                international
                                withCountryCallingCode
                                limitMaxLength
                                smartCaret={false}
                                autoFocus
                            />
                            <button className="btn-primary" onClick={handleSendOtp} disabled={authLoading || !recipientPhone || recipientPhone.length < 5}>
                                {authLoading ? 'Sending...' : 'Send Verification Code'}
                            </button>
                        </>
                    ) : (
                        <>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Enter 6-digit code"
                                value={otpCode}
                                onChange={e => setOtpCode(e.target.value)}
                                onKeyDown={handleKeyDownOtp}
                                autoFocus
                                style={{
                                    marginBottom: '12px',
                                    width: '100%',
                                    border: '2px solid var(--color-gray-200)',
                                    background: 'var(--color-gray-100)',
                                    textAlign: 'center',
                                    letterSpacing: '2px',
                                    fontSize: '18px',
                                    color: 'var(--color-text)'
                                }}
                                maxLength={6}
                            />
                            <button className="btn-primary" onClick={handleVerifyOtp} disabled={authLoading || otpCode.length < 6}>
                                {authLoading ? 'Verifying...' : 'Verify & Continue'}
                            </button>
                        </>
                    )}
                </div>
            ) : (
                <>
                    <div className="consent-section" style={{ padding: '0 20px', marginBottom: '24px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                        <input
                            type="checkbox"
                            id="consent"
                            checked={consentChecked}
                            onChange={(e) => setConsentChecked(e.target.checked)}
                            style={{ marginTop: '4px', width: '20px', height: '20px', accentColor: '#30D158' }}
                        />
                        <label htmlFor="consent" style={{ fontSize: '13px', color: '#666', lineHeight: '1.4' }}>
                            I confirm my identity and consent to the terms of this agreement. I understand this action seals a verifiable digital handshake.
                        </label>
                    </div>

                    <ActionSlider
                        disabled={!consentChecked}
                        onComplete={handleClinchSuccess}
                        label="Slide to Clinch >>"
                        successLabel="Clinched!"
                    />

                    <button
                        onClick={handleReject}
                        style={{
                            marginTop: '24px',
                            background: 'transparent',
                            color: '#FF453A',
                            border: '1px solid rgba(255, 69, 58, 0.3)',
                            padding: '16px',
                            borderRadius: '16px',
                            width: '100%',
                            fontSize: '15px',
                            fontWeight: '700',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                    >
                        <span>👎</span> I do not agree
                    </button>
                </>
            )}
        </div>
    );
}

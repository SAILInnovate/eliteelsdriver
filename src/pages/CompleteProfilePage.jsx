import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../context/LanguageContext';
import { buildNda, NDA_VERSION, NDA_TITLE } from '../content/driverNda';

const haptic = async (style = ImpactStyle.Light) => {
    try { await Haptics.impact({ style }); } catch (e) {}
};

const hapticNotify = async (type = NotificationType.Success) => {
    try { await Haptics.notification({ type }); } catch (e) {}
};

const inputStyle = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #EBEBEB',
    color: '#000000',
    fontFamily: 'var(--font-family)',
    fontSize: '1.125rem',
    outline: 'none',
    fontWeight: 400,
    height: '56px',
    marginBottom: '20px',
    transition: 'border-color 0.3s ease',
    caretColor: '#000000'
};

export default function CompleteProfilePage({ onComplete }) {
    const { user, updateProfileName } = useAuth();
    const { t } = useLanguage();

    const [step, setStep] = useState(null);
    const [fullName, setFullName] = useState('');
    const [ownsVehicle, setOwnsVehicle] = useState(null); // null until chosen
    const [vehicleReg, setVehicleReg] = useState('');
    const [vehicleMakeModel, setVehicleMakeModel] = useState('');
    const [vehicleColour, setVehicleColour] = useState('');
    const [hasProfile, setHasProfile] = useState(false); // existing driver only missing the NDA
    const [signature, setSignature] = useState('');
    const [scrolledToEnd, setScrolledToEnd] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Mandatory identity check — a new driver must upload their driving licence
    // before they can sign up, so we have a sanity check that this is a real person.
    const docFileRef = useRef(null);
    const [docUploading, setDocUploading] = useState(false);
    const [licenceDoc, setLicenceDoc] = useState(null); // { file_url } once uploaded

    useEffect(() => {
        const detectStep = async () => {
            const hasName = !!user?.user_metadata?.full_name;

            if (!hasName) {
                setStep('NAME');
                return;
            }

            // Already applied and signed the current NDA? Straight in.
            const [{ data: profile }, { data: nda }] = await Promise.all([
                supabase
                    .from('driver_profiles')
                    .select('user_id')
                    .eq('user_id', user.id)
                    .maybeSingle(),
                supabase
                    .from('driver_nda_acceptances')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('nda_version', NDA_VERSION)
                    .maybeSingle()
            ]);

            if (profile && nda) {
                onComplete();
                return;
            }

            if (profile) {
                // Existing driver from before the NDA (or a new NDA version):
                // just needs to sign, skip the vehicle step.
                setHasProfile(true);
                setStep('NDA');
                return;
            }

            setStep('VEHICLE');
        };

        if (user) detectStep();
    }, [user]);

    const handleNameSubmit = async () => {
        const trimmed = fullName.trim();
        if (!trimmed || trimmed.length < 2) {
            hapticNotify(NotificationType.Error);
            setError(t('errFullName'));
            return;
        }

        haptic(ImpactStyle.Medium);
        setLoading(true);
        setError(null);

        try {
            await updateProfileName(trimmed);
            hapticNotify(NotificationType.Success);
            setError(null);
            setStep('VEHICLE');
        } catch (err) {
            console.error(err);
            hapticNotify(NotificationType.Error);
            setError(t('errGeneric'));
        } finally {
            setLoading(false);
        }
    };

    const vehicleValid = ownsVehicle === false ||
        (ownsVehicle === true && vehicleReg.trim().length >= 2 && vehicleMakeModel.trim().length >= 2);

    const handleVehicleContinue = () => {
        if (!vehicleValid) {
            hapticNotify(NotificationType.Error);
            setError('Please complete your vehicle details.');
            return;
        }
        haptic(ImpactStyle.Medium);
        setError(null);
        setStep('DOCUMENT');
    };

    // --- DOCUMENT (mandatory driving licence upload) ---
    // Pick up any licence already uploaded (e.g. the driver navigated back or
    // retried), so we don't force a duplicate upload.
    useEffect(() => {
        if (step !== 'DOCUMENT' || !user || licenceDoc) return;
        supabase
            .from('driver_documents')
            .select('file_url')
            .eq('driver_id', user.id)
            .eq('doc_type', 'driving_licence')
            .maybeSingle()
            .then(({ data }) => {
                if (data?.file_url) setLicenceDoc({ file_url: data.file_url });
            });
    }, [step, user]);

    const handleDocUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;
        haptic(ImpactStyle.Light);
        setDocUploading(true);
        setError(null);
        try {
            const ext = file.name.split('.').pop();
            const path = `drivers/${user.id}/driving_licence_${Date.now()}.${ext}`;

            const { error: uploadErr } = await supabase.storage.from('audits').upload(path, file);
            if (uploadErr) throw uploadErr;

            const { data: urlData } = supabase.storage.from('audits').getPublicUrl(path);

            const { error: dbError } = await supabase.from('driver_documents').upsert({
                driver_id: user.id,
                doc_type: 'driving_licence',
                file_url: urlData.publicUrl,
                uploaded_at: new Date().toISOString()
            }, { onConflict: 'driver_id,doc_type' });
            if (dbError) throw dbError;

            setLicenceDoc({ file_url: urlData.publicUrl });
            hapticNotify(NotificationType.Success);
        } catch (err) {
            console.error(err);
            hapticNotify(NotificationType.Error);
            setError('Upload failed. Please try again.');
        } finally {
            setDocUploading(false);
            if (docFileRef.current) docFileRef.current.value = '';
        }
    };

    const handleDocumentContinue = () => {
        if (!licenceDoc) {
            hapticNotify(NotificationType.Error);
            setError('Please upload your driving licence to continue.');
            return;
        }
        haptic(ImpactStyle.Medium);
        setError(null);
        setStep('NDA');
    };

    // --- NDA (Apple-style scroll → type name → agree & sign) ---
    const driverName = user?.user_metadata?.full_name || fullName.trim();
    const effectiveDate = useMemo(() => new Date().toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
    }), []);
    const ndaBlocks = useMemo(
        () => buildNda({ driverName, phone: user?.phone ? `+${user.phone.replace(/^\+/, '')}` : null, effectiveDate }),
        [driverName, user?.phone, effectiveDate]
    );

    const normalise = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    const signatureValid = normalise(signature) === normalise(driverName) && signature.trim().length >= 2;

    const scrollRef = useRef(null);
    const handleNdaScroll = () => {
        const el = scrollRef.current;
        if (!el || scrolledToEnd) return;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 32) {
            haptic(ImpactStyle.Light); // native tick as the signature unlocks
            setScrolledToEnd(true);
        }
    };

    // Content shorter than the box (e.g. large screens) counts as read
    useEffect(() => {
        if (step !== 'NDA') return;
        const el = scrollRef.current;
        if (el && el.scrollHeight <= el.clientHeight) setScrolledToEnd(true);
    }, [step]);

    const handleAgreeSign = async () => {
        if (!scrolledToEnd || !signatureValid) {
            hapticNotify(NotificationType.Error);
            setError(scrolledToEnd
                ? 'Please type your full name exactly as registered to sign.'
                : 'Please read the agreement to the end first.');
            return;
        }

        haptic(ImpactStyle.Medium);
        setLoading(true);
        setError(null);

        try {
            // 1. Record the signed NDA (write-once audit row)
            const { error: ndaError } = await supabase
                .from('driver_nda_acceptances')
                .insert({
                    user_id: user.id,
                    nda_version: NDA_VERSION,
                    full_name: driverName,
                    signed_name: signature.trim(),
                    phone: user.phone || null,
                    user_agent: navigator.userAgent || null
                });

            // Already signed this version (e.g. retry after a network blip) is fine
            if (ndaError && ndaError.code !== '23505') throw ndaError;

            // 2. Submit the driver application (new drivers only)
            if (!hasProfile) {
                const { error: insertError } = await supabase
                    .from('driver_profiles')
                    .upsert({
                        user_id: user.id,
                        full_name: driverName,
                        phone: user.phone || null,
                        owns_vehicle: ownsVehicle === true,
                        vehicle_reg: ownsVehicle ? vehicleReg.trim().toUpperCase() : null,
                        vehicle_make_model: ownsVehicle ? vehicleMakeModel.trim() : null,
                        vehicle_colour: ownsVehicle ? (vehicleColour.trim() || null) : null,
                        applied_at: new Date().toISOString()
                    }, { onConflict: 'user_id' });

                if (insertError) throw insertError;
            }

            hapticNotify(NotificationType.Success);
            onComplete();
        } catch (err) {
            console.error(err);
            hapticNotify(NotificationType.Error);
            setError(t('errGeneric'));
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && step === 'NAME') handleNameSubmit();
    };

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

    const toggleBtn = (active) => ({
        flex: 1,
        height: '52px',
        background: active ? '#000000' : 'transparent',
        color: active ? '#FFFFFF' : '#888888',
        border: active ? '1px solid #000000' : '1px solid #EBEBEB',
        fontSize: '0.6875rem',
        letterSpacing: '2px',
        textTransform: 'uppercase',
        fontWeight: 600,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        transition: 'all 0.3s ease'
    });

    if (!step) return null;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            style={{
                height: '100dvh',
                display: 'flex',
                flexDirection: 'column',
                background: '#FFFFFF',
                color: '#000000',
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
            <Helmet>
                <title>Elite ELS</title>
            </Helmet>

            {/* Upper-third layout — the NDA step fills the viewport so the CTA stays pinned */}
            <div style={{
                width: '100%',
                maxWidth: '340px',
                margin: '0 auto',
                paddingTop: step === 'NDA' ? '2vh' : '8vh',
                ...(step === 'NDA'
                    ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
                    : { overflowY: 'auto' })
            }}>

                {/* Logo — small, left-aligned */}
                <motion.img
                    src="/elitels.png"
                    alt="Elite"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.9 }}
                    transition={{ duration: 0.8, delay: 0.1 }}
                    style={{ height: '48px', marginBottom: step === 'NDA' ? '24px' : '40px', alignSelf: 'flex-start', width: 'auto', objectFit: 'contain', flexShrink: 0 }}
                />

                {error && (
                    <motion.p
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{ color: '#FF6B6B', fontSize: '0.75rem', marginBottom: '20px', fontWeight: 500, letterSpacing: '0.5px' }}
                    >
                        {error}
                    </motion.p>
                )}

                <AnimatePresence mode="wait">

                    {/* ---- NAME STEP ---- */}
                    {step === 'NAME' && (
                        <motion.div
                            key="name"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.5 }}
                        >
                            <h1 style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: '2rem',
                                fontWeight: 400,
                                color: '#000000',
                                marginBottom: '6px',
                                letterSpacing: '-0.02em'
                            }}>
                                {t('oneLastThing')}
                            </h1>
                            <p style={{
                                fontSize: '0.8125rem',
                                color: '#888888',
                                marginBottom: '32px',
                                fontWeight: 400
                            }}>
                                {t('whatName')}
                            </p>

                            <input
                                type="text"
                                placeholder={t('fullName')}
                                value={fullName}
                                onChange={e => setFullName(e.target.value)}
                                onKeyDown={handleKeyDown}
                                autoFocus
                                autoCapitalize="words"
                                autoComplete="name"
                                style={{ ...inputStyle, marginBottom: '24px' }}
                            />

                            <motion.button
                                onClick={handleNameSubmit}
                                disabled={loading || fullName.trim().length < 2}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                                style={{
                                    ...btnBase,
                                    opacity: (loading || fullName.trim().length < 2) ? 0.25 : 1,
                                    transition: 'opacity 0.5s ease'
                                }}
                            >
                                {loading ? '...' : t('continue')}
                            </motion.button>
                        </motion.div>
                    )}

                    {/* ---- VEHICLE / APPLICATION STEP ---- */}
                    {step === 'VEHICLE' && (
                        <motion.div
                            key="vehicle"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.5 }}
                        >
                            <h1 style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: '2rem',
                                fontWeight: 400,
                                color: '#000000',
                                marginBottom: '6px',
                                letterSpacing: '-0.02em'
                            }}>
                                Your vehicle
                            </h1>
                            <p style={{
                                fontSize: '0.8125rem',
                                color: '#888888',
                                marginBottom: '32px',
                                fontWeight: 400,
                                lineHeight: 1.6
                            }}>
                                Drive your own car? Register it and we'll issue you an ELS plate so you can work with us.
                            </p>

                            {/* Own vehicle toggle */}
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '28px' }}>
                                <motion.button
                                    whileTap={{ scale: 0.97 }}
                                    onClick={() => { haptic(); setOwnsVehicle(true); }}
                                    style={toggleBtn(ownsVehicle === true)}
                                >
                                    My own vehicle
                                </motion.button>
                                <motion.button
                                    whileTap={{ scale: 0.97 }}
                                    onClick={() => { haptic(); setOwnsVehicle(false); }}
                                    style={toggleBtn(ownsVehicle === false)}
                                >
                                    ELS vehicle
                                </motion.button>
                            </div>

                            <AnimatePresence>
                                {ownsVehicle === true && (
                                    <motion.div
                                        key="own-vehicle-fields"
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        style={{ overflow: 'hidden' }}
                                    >
                                        <input
                                            type="text"
                                            placeholder="Registration (e.g. AB12 CDE)"
                                            value={vehicleReg}
                                            onChange={e => setVehicleReg(e.target.value.toUpperCase())}
                                            autoCapitalize="characters"
                                            style={{ ...inputStyle, letterSpacing: '2px', textTransform: 'uppercase' }}
                                        />
                                        <input
                                            type="text"
                                            placeholder="Make & model (e.g. Mercedes V-Class)"
                                            value={vehicleMakeModel}
                                            onChange={e => setVehicleMakeModel(e.target.value)}
                                            style={inputStyle}
                                        />
                                        <input
                                            type="text"
                                            placeholder="Colour (optional)"
                                            value={vehicleColour}
                                            onChange={e => setVehicleColour(e.target.value)}
                                            style={inputStyle}
                                        />
                                        <p style={{ fontSize: '0.7rem', color: '#555555', marginBottom: '24px', lineHeight: 1.6 }}>
                                            Once approved, ELS Operations will issue your ELS plate in the app. Jobs are assigned to you — no bidding, no chasing.
                                        </p>
                                    </motion.div>
                                )}
                                {ownsVehicle === false && (
                                    <motion.p
                                        key="fleet-note"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        style={{ fontSize: '0.7rem', color: '#555555', marginBottom: '24px', lineHeight: 1.6 }}
                                    >
                                        You'll drive an ELS fleet vehicle. Operations will assign your vehicle and jobs.
                                    </motion.p>
                                )}
                            </AnimatePresence>

                            <motion.button
                                onClick={handleVehicleContinue}
                                disabled={loading || ownsVehicle === null || !vehicleValid}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                                style={{
                                    ...btnBase,
                                    opacity: (loading || ownsVehicle === null || !vehicleValid) ? 0.25 : 1,
                                    transition: 'opacity 0.5s ease'
                                }}
                            >
                                Continue
                            </motion.button>
                        </motion.div>
                    )}

                    {/* ---- DOCUMENT / IDENTITY STEP ---- */}
                    {step === 'DOCUMENT' && (
                        <motion.div
                            key="document"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.5 }}
                        >
                            <h1 style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: '2rem',
                                fontWeight: 400,
                                color: '#000000',
                                marginBottom: '6px',
                                letterSpacing: '-0.02em'
                            }}>
                                Verify it's you
                            </h1>
                            <p style={{
                                fontSize: '0.8125rem',
                                color: '#888888',
                                marginBottom: '32px',
                                fontWeight: 400,
                                lineHeight: 1.6
                            }}>
                                Upload your DVLA driving licence. This confirms your identity — you can add your other documents later from your profile.
                            </p>

                            <input
                                ref={docFileRef}
                                type="file"
                                accept="image/*,.pdf"
                                style={{ display: 'none' }}
                                onChange={handleDocUpload}
                            />

                            <motion.button
                                whileTap={docUploading ? {} : { scale: 0.98 }}
                                onClick={() => { if (docUploading) return; haptic(); docFileRef.current?.click(); }}
                                style={{
                                    width: '100%',
                                    minHeight: '96px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    padding: '20px',
                                    marginBottom: '28px',
                                    background: licenceDoc ? 'rgba(138,115,85,0.06)' : 'transparent',
                                    border: licenceDoc ? '1px solid rgba(138,115,85,0.4)' : '1px dashed #CFCFCF',
                                    color: licenceDoc ? '#8A7355' : '#555555',
                                    cursor: docUploading ? 'default' : 'pointer',
                                    WebkitTapHighlightColor: 'transparent',
                                    transition: 'all 0.3s ease'
                                }}
                            >
                                <span style={{
                                    fontSize: '0.6875rem',
                                    letterSpacing: '2px',
                                    textTransform: 'uppercase',
                                    fontWeight: 600
                                }}>
                                    {docUploading
                                        ? 'Uploading…'
                                        : licenceDoc
                                            ? '✓  Driving Licence Uploaded'
                                            : 'DVLA Driving Licence'}
                                </span>
                                {!licenceDoc && !docUploading && (
                                    <span style={{ fontSize: '0.75rem', color: '#999999', letterSpacing: '0.5px' }}>
                                        Tap to upload a photo or PDF
                                    </span>
                                )}
                                {licenceDoc && !docUploading && (
                                    <span style={{ fontSize: '0.7rem', color: '#999999', letterSpacing: '0.5px' }}>
                                        Tap to replace
                                    </span>
                                )}
                            </motion.button>

                            <motion.button
                                onClick={handleDocumentContinue}
                                disabled={loading || docUploading || !licenceDoc}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                                style={{
                                    ...btnBase,
                                    opacity: (loading || docUploading || !licenceDoc) ? 0.25 : 1,
                                    transition: 'opacity 0.5s ease'
                                }}
                            >
                                Continue
                            </motion.button>
                        </motion.div>
                    )}

                    {/* ---- NDA STEP ---- */}
                    {step === 'NDA' && (
                        <motion.div
                            key="nda"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.5 }}
                            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
                        >
                            <h1 style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: '2rem',
                                fontWeight: 400,
                                color: '#000000',
                                marginBottom: '6px',
                                letterSpacing: '-0.02em'
                            }}>
                                One agreement
                            </h1>
                            <p style={{
                                fontSize: '0.8125rem',
                                color: '#888888',
                                marginBottom: '20px',
                                fontWeight: 400,
                                lineHeight: 1.6
                            }}>
                                Please read our confidentiality agreement, then sign by typing your full name.
                            </p>

                            {/* Scrollable agreement — flexes to fill, so the CTA stays on screen */}
                            <div style={{ flex: 1, minHeight: '180px', position: 'relative', marginBottom: '12px' }}>
                            <div
                                ref={scrollRef}
                                onScroll={handleNdaScroll}
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    overflowY: 'auto',
                                    WebkitOverflowScrolling: 'touch',
                                    border: '1px solid #EBEBEB',
                                    padding: '16px',
                                    background: '#FAFAFA'
                                }}
                            >
                                <p style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    letterSpacing: '1px',
                                    textTransform: 'uppercase',
                                    marginBottom: '14px',
                                    color: '#000000'
                                }}>
                                    {NDA_TITLE}
                                </p>
                                {ndaBlocks.map((block, i) => {
                                    if (block.type === 'heading') {
                                        return (
                                            <p key={i} style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#000000', margin: '16px 0 8px' }}>
                                                {block.body}
                                            </p>
                                        );
                                    }
                                    if (block.type === 'party') {
                                        return (
                                            <p key={i} style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#333333', lineHeight: 1.7, marginBottom: '8px' }}>
                                                {block.body}
                                            </p>
                                        );
                                    }
                                    if (block.type === 'clause') {
                                        return (
                                            <p key={i} style={{ fontSize: '0.6875rem', color: '#555555', lineHeight: 1.7, marginBottom: '8px', display: 'flex', gap: '8px' }}>
                                                <span style={{ flexShrink: 0, fontWeight: 600, color: '#333333' }}>{block.num}</span>
                                                <span>{block.body}</span>
                                            </p>
                                        );
                                    }
                                    return (
                                        <p key={i} style={{ fontSize: '0.6875rem', color: '#555555', lineHeight: 1.7, marginBottom: '8px' }}>
                                            {block.body}
                                        </p>
                                    );
                                })}
                            </div>

                            {/* Bottom fade — the iOS cue that there's more to read */}
                            <div style={{
                                position: 'absolute',
                                bottom: '1px',
                                left: '1px',
                                right: '1px',
                                height: '48px',
                                background: 'linear-gradient(rgba(250,250,250,0), #FAFAFA)',
                                pointerEvents: 'none',
                                opacity: scrolledToEnd ? 0 : 1,
                                transition: 'opacity 0.4s ease'
                            }} />
                            </div>

                            {/* Scroll hint / signature */}
                            {!scrolledToEnd ? (
                                <p style={{ fontSize: '0.7rem', color: '#888888', marginBottom: '24px', textAlign: 'center', letterSpacing: '0.5px' }}>
                                    Scroll to the end of the agreement to sign
                                </p>
                            ) : (
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
                                    <p style={{ fontSize: '0.7rem', color: '#555555', margin: '12px 0 4px', lineHeight: 1.6 }}>
                                        Signed by <strong>{driverName}</strong> · {effectiveDate}
                                    </p>
                                    <input
                                        type="text"
                                        placeholder="Type your full name to sign"
                                        value={signature}
                                        onChange={e => setSignature(e.target.value)}
                                        autoCapitalize="words"
                                        autoComplete="off"
                                        style={{
                                            ...inputStyle,
                                            fontFamily: 'var(--font-display)',
                                            fontStyle: 'italic',
                                            fontSize: '1.25rem',
                                            marginBottom: '20px'
                                        }}
                                    />
                                </motion.div>
                            )}

                            <motion.button
                                onClick={handleAgreeSign}
                                disabled={loading || !scrolledToEnd || !signatureValid}
                                whileTap={{ scale: 0.97 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                                style={{
                                    ...btnBase,
                                    opacity: (loading || !scrolledToEnd || !signatureValid) ? 0.25 : 1,
                                    transition: 'opacity 0.5s ease'
                                }}
                            >
                                {loading ? '...' : (hasProfile ? 'Agree & Sign' : 'Agree, Sign & Submit')}
                            </motion.button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Bottom spacer (not on the NDA step — it fills the viewport) */}
            {step !== 'NDA' && <div style={{ flex: 1 }} />}
        </motion.div>
    );
}

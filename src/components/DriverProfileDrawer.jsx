import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Check, ChevronRight, Globe, User, FileText, Camera, Shield, CreditCard, LogOut, Car, Briefcase, Star } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const LANG_LABELS = { en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', ar: 'العربية' };

const DOC_KEYS = [
  { key: 'driving_licence', icon: CreditCard, tKey: 'drivingLicence' },
  { key: 'pco_licence', icon: Shield, tKey: 'pcoLicence' },
  { key: 'dvla_check_code', icon: FileText, tKey: 'dvlaCheckCode' },
  { key: 'proof_of_id', icon: User, tKey: 'proofOfId' },
  { key: 'profile_photo', icon: Camera, tKey: 'profilePhoto' },
];

// Extra documents required when the driver brings their own vehicle
const OWN_VEHICLE_DOC_KEYS = [
  { key: 'insurance_certificate', icon: Shield, label: 'Insurance Certificate' },
  { key: 'mot_certificate', icon: FileText, label: 'MOT Certificate' },
  { key: 'v5c_logbook', icon: Car, label: 'V5C Logbook' },
];

const STATUS_STYLES = {
  pending_review: { label: 'Under Review', color: '#B45309', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)' },
  approved: { label: 'Approved', color: '#8A7355', bg: 'rgba(138,115,85,0.08)', border: 'rgba(138,115,85,0.3)' },
  suspended: { label: 'Suspended', color: '#EF4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
};

export default function DriverProfileDrawer({ open, onClose, onSignOut, profile }) {
  const { t, lang, setLang, supportedLanguages } = useLanguage();
  const { user } = useAuth();
  const [docs, setDocs] = useState({});
  const [uploading, setUploading] = useState(null);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const fileRef = useRef(null);
  const [uploadTarget, setUploadTarget] = useState(null);

  const driverName = user?.user_metadata?.full_name || user?.phone || 'Driver';

  const [orgName, setOrgName] = useState(null);
  // Client ratings — aggregates only. Individual comments stay with ops.
  const [rating, setRating] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (!open || !user || !profile) return;
    if (profile.subcontractor_id) {
      supabase.rpc('get_my_subcontractor').then(({ data }) => {
        if (data?.success && data?.company) {
          setOrgName(data.company);
        }
      });
    } else {
      setOrgName(null);
    }
  }, [open, user, profile?.subcontractor_id]);

  // My star rating from the clients I have driven
  useEffect(() => {
    if (!open || !user) return;
    supabase.rpc('get_my_driver_rating').then(({ data }) => {
      if (data?.ok) setRating(data);
    });
  }, [open, user]);

  // Load existing docs
  useEffect(() => {
    if (!open || !user) return;
    const loadDocs = async () => {
      const { data } = await supabase.from('driver_documents').select('*').eq('driver_id', user.id);
      if (data) {
        const map = {};
        data.forEach(d => { map[d.doc_type] = d; });
        setDocs(map);
      }
    };
    loadDocs();
  }, [open, user]);

  const triggerHaptic = () => { try { Haptics.impact({ style: ImpactStyle.Light }); } catch(e){} };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTarget) return;
    setUploading(uploadTarget);

    const ext = file.name.split('.').pop();
    const path = `drivers/${user.id}/${uploadTarget}_${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabase.storage.from('audits').upload(path, file);
    if (uploadErr) { setUploading(null); return; }

    const { data: urlData } = supabase.storage.from('audits').getPublicUrl(path);

    // Upsert doc record
    const { error: dbError } = await supabase.from('driver_documents').upsert({
      driver_id: user.id,
      doc_type: uploadTarget,
      file_url: urlData.publicUrl,
      uploaded_at: new Date().toISOString()
    }, { onConflict: 'driver_id,doc_type' });

    if (dbError) {
      console.error('Failed to save document to database:', dbError);
      alert('Failed to save document to database. Please try again.');
      setUploading(null);
      setUploadTarget(null);
      return;
    }

    setDocs(prev => ({ ...prev, [uploadTarget]: { file_url: urlData.publicUrl, uploaded_at: new Date().toISOString() } }));
    setUploading(null);
    setUploadTarget(null);
    triggerHaptic();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, backdropFilter: 'blur(4px)' }}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            style={{
              position: 'fixed', top: 0, left: 0, bottom: 0, width: '100%', zIndex: 10000,
              background: '#FFFFFF',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              willChange: 'transform'
            }}
          >
            {/* Header */}
            <div style={{
              paddingTop: 'calc(max(env(safe-area-inset-top), 20px) + 12px)',
              paddingLeft: '24px', paddingRight: '24px', paddingBottom: '20px',
              borderBottom: '1px solid rgba(0,0,0,0.06)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#8A7355', marginBottom: '6px' }}>Chauffeur</motion.div>
                  <motion.h2 initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.75rem', fontWeight: 500, color: '#000', lineHeight: 1.1, marginBottom: '6px' }}>{t('driverProfile')}</motion.h2>
                  <motion.p initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 }} style={{ fontSize: '0.8125rem', color: '#6B6B6B', letterSpacing: '0.3px' }}>{driverName}</motion.p>
                </div>
                <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} style={{ background: 'transparent', border: '1px solid #E8E4DE', borderRadius: '50%', width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, marginTop: '2px' }}>
                  <X size={15} color="#000" />
                </motion.button>
              </div>

              {/* Profile Photo Circle */}
              <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                style={{ display: 'flex', justifyContent: 'center' }}
              >
                <div
                  onClick={() => { setUploadTarget('profile_photo'); fileRef.current?.click(); triggerHaptic(); }}
                  style={{
                    width: '80px', height: '80px', borderRadius: '40px',
                    background: docs.profile_photo?.file_url ? `url(${docs.profile_photo.file_url}) center/cover` : 'rgba(0,0,0,0.06)',
                    border: docs.profile_photo ? '1.5px solid rgba(138,115,85,0.5)' : '2px dashed rgba(0,0,0,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', transition: '0.3s',
                    position: 'relative', overflow: 'hidden'
                  }}
                >
                  {!docs.profile_photo?.file_url && <Camera size={24} color="#555" />}
                  {uploading === 'profile_photo' && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} style={{ width: '24px', height: '24px', border: '2px solid transparent', borderTopColor: '#D4CFC9', borderRadius: '50%' }} />
                    </div>
                  )}
                </div>
              </motion.div>
              <p style={{ textAlign: 'center', fontSize: '0.7rem', color: '#666', marginTop: '8px' }}>{t('profilePhotoNote')}</p>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 24px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
              {/* Driver Status / ELS Plate */}
              {profile && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} style={{ marginBottom: '24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                    <div style={{ width: '3px', height: '16px', background: '#D4CFC9', borderRadius: '2px' }} />
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '2px', color: '#555', textTransform: 'uppercase' }}>Driver Status</span>
                  </div>

                  <div style={{ background: '#FFF', border: '1px solid #E8E4DE', borderRadius: '14px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Application status */}
                    {(() => {
                      const s = STATUS_STYLES[profile.status] || STATUS_STYLES.pending_review;
                      return (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.8125rem', color: '#6B6B6B' }}>Application</span>
                          <span style={{ padding: '4px 12px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>{s.label}</span>
                        </div>
                      );
                    })()}

                    {/* ELS plate */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8125rem', color: '#6B6B6B' }}>ELS Plate</span>
                      {profile.els_plate ? (
                        <span style={{ fontWeight: 600, letterSpacing: '2px', color: '#000', fontSize: '0.9375rem' }}>{profile.els_plate}</span>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: '#666' }}>Issued on approval</span>
                      )}
                    </div>

                    {/* Client rating — a new chauffeur has none yet, and that is
                        stated plainly rather than shown as a zero. */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8125rem', color: '#6B6B6B' }}>Client Rating</span>
                      {rating?.count > 0 ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ display: 'flex', gap: '1px' }}>
                            {[1, 2, 3, 4, 5].map(n => (
                              <Star key={n} size={13} strokeWidth={1.5}
                                fill={n <= Math.round(rating.average) ? '#8A7355' : 'none'}
                                color={n <= Math.round(rating.average) ? '#8A7355' : '#D8D4CE'} />
                            ))}
                          </span>
                          <span style={{ fontWeight: 700, color: '#000', fontSize: '0.9375rem' }}>
                            {Number(rating.average).toFixed(2)}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: '#999' }}>
                            ({rating.count})
                          </span>
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: '#666' }}>No ratings yet</span>
                      )}
                    </div>

                    {/* Own vehicle */}
                    {profile.owns_vehicle && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8125rem', color: '#6B6B6B' }}>My Vehicle</span>
                        <span style={{ fontSize: '0.85rem', color: '#000', fontWeight: 600, textAlign: 'right' }}>
                          {profile.vehicle_make_model || 'Own vehicle'}{profile.vehicle_reg ? ` • ${profile.vehicle_reg}` : ''}
                        </span>
                      </div>
                    )}

                    {/* Driving score — maintained by ops, drives pay */}
                    {profile.driving_score != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8125rem', color: '#6B6B6B' }}>Driving Score</span>
                        <span style={{ fontWeight: 700, color: '#8A7355', fontSize: '0.9375rem' }}>{Number(profile.driving_score).toFixed(0)}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Organization Section */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <span style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '2px', color: '#6B6B6B', textTransform: 'uppercase' }}>Organisation</span>
                </div>

                <div style={{ background: '#FFF', border: '1px solid #E8E4DE', borderRadius: '14px', padding: '18px' }}>
                  {profile?.subcontractor_id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(138,115,85,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Briefcase size={16} color="#8A7355" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.8125rem', color: '#6B6B6B' }}>Joined Fleet</div>
                          <div style={{ fontWeight: 600, color: '#000', fontSize: '0.95rem' }}>{orgName || 'Loading...'}</div>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          triggerHaptic();
                          if (!window.confirm('Are you sure you want to leave this organisation?')) return;
                          setIsLeaving(true);
                          const { data, error } = await supabase.rpc('leave_subcontractor_fleet');
                          setIsLeaving(false);
                          if (error || !data?.success) {
                            alert('Failed to leave fleet.');
                          } else {
                            // Re-fetch profile will be handled by the subscription in PlayerPortal
                          }
                        }}
                        disabled={isLeaving}
                        style={{ padding: '12px', background: 'transparent', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', opacity: isLeaving ? 0.5 : 1 }}
                      >
                        {isLeaving ? 'Leaving…' : 'Leave Organisation'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.4 }}>
                        If you work for a subcontractor, enter their invite code here.
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          placeholder="Invite Code"
                          value={joinCode}
                          onChange={e => setJoinCode(e.target.value)}
                          style={{ flex: 1, minWidth: 0, padding: '14px 14px', borderRadius: '10px', border: '1px solid #E8E4DE', outline: 'none', fontSize: '0.9375rem', letterSpacing: '1px', background: '#FAF9F7', color: '#000' }}
                        />
                        <button
                          onClick={async () => {
                            triggerHaptic();
                            if (!joinCode.trim()) return;
                            setIsJoining(true);
                            const { data, error } = await supabase.rpc('join_subcontractor_fleet', { p_code: joinCode.trim() });
                            setIsJoining(false);
                            if (error || !data?.success) {
                              alert(data?.error || 'Invalid join code.');
                            } else {
                              setJoinCode('');
                            }
                          }}
                          disabled={isJoining || !joinCode.trim()}
                          style={{ padding: '0 18px', flexShrink: 0, background: '#000', color: '#FFF', border: 'none', borderRadius: '10px', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', cursor: joinCode.trim() ? 'pointer' : 'default', opacity: (isJoining || !joinCode.trim()) ? 0.4 : 1 }}
                        >
                          {isJoining ? '...' : 'JOIN'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Documents Section */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <span style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '2px', color: '#6B6B6B', textTransform: 'uppercase' }}>{t('myDocuments')}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    ...DOC_KEYS.filter(d => d.key !== 'profile_photo'),
                    ...(profile?.owns_vehicle ? OWN_VEHICLE_DOC_KEYS : [])
                  ].map((doc, i) => {
                    const hasDoc = !!docs[doc.key]?.file_url;
                    const isUploading = uploading === doc.key;
                    const IconComp = doc.icon;
                    return (
                      <motion.button
                        key={doc.key}
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + i * 0.04 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => { setUploadTarget(doc.key); fileRef.current?.click(); triggerHaptic(); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '14px', padding: '16px',
                          background: '#FFF', border: hasDoc ? '1px solid rgba(138,115,85,0.35)' : '1px solid #E8E4DE',
                          borderRadius: '14px', textAlign: 'left', transition: '0.2s',
                          width: '100%'
                        }}
                      >
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '10px',
                          background: hasDoc ? 'rgba(138,115,85,0.08)' : 'rgba(0,0,0,0.04)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                        }}>
                          {isUploading ? (
                            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} style={{ width: '18px', height: '18px', border: '2px solid transparent', borderTopColor: '#8A7355', borderRadius: '50%' }} />
                          ) : hasDoc ? (
                            <Check size={16} color="#8A7355" />
                          ) : (
                            <IconComp size={16} color="#666" />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#000' }}>{doc.label || t(doc.tKey)}</div>
                          <div style={{ fontSize: '0.75rem', color: hasDoc ? '#8A7355' : '#6B6459', marginTop: '2px' }}>
                            {isUploading ? t('uploading') : hasDoc ? t('uploaded') : t('uploadDocument')}
                          </div>
                        </div>
                        <ChevronRight size={16} color="#C9C2B8" />
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>

              {/* Language Section */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} style={{ marginTop: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <span style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '2px', color: '#6B6B6B', textTransform: 'uppercase' }}>{t('settings')}</span>
                </div>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { setShowLangPicker(!showLangPicker); triggerHaptic(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '14px', padding: '16px', width: '100%',
                    background: '#FFF', border: '1px solid #E8E4DE',
                    borderRadius: '14px', textAlign: 'left'
                  }}
                >
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Globe size={16} color="#888" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#000' }}>{t('language')}</div>
                    <div style={{ fontSize: '0.75rem', color: '#8A7355', marginTop: '2px' }}>{LANG_LABELS[lang]}</div>
                  </div>
                  <motion.div animate={{ rotate: showLangPicker ? 90 : 0 }}><ChevronRight size={16} color="#C9C2B8" /></motion.div>
                </motion.button>

                <AnimatePresence>
                  {showLangPicker && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden', marginTop: '8px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                        {supportedLanguages.map(code => (
                          <motion.button
                            key={code}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => { setLang(code); triggerHaptic(); }}
                            style={{
                              padding: '12px', borderRadius: '12px', fontWeight: 600, fontSize: '0.85rem',
                              background: lang === code ? '#000' : '#FFF',
                              border: lang === code ? '1px solid #000' : '1px solid #E8E4DE',
                              color: lang === code ? '#FFF' : '#000', transition: '0.2s'
                            }}
                          >
                            {LANG_LABELS[code]}
                          </motion.button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Sign Out */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} style={{ marginTop: '32px' }}>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { triggerHaptic(); onSignOut(); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    padding: '16px', width: '100%',
                    background: 'transparent', border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: '14px', color: '#EF4444', fontWeight: 700, fontSize: '0.6875rem', letterSpacing: '2px', textTransform: 'uppercase'
                  }}
                >
                  <LogOut size={18} /> {t('signOut')}
                </motion.button>
              </motion.div>
            </div>

            {/* Hidden file input */}
            <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={handleUpload} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

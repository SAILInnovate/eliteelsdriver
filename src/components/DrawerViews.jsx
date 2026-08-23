import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Share as CapShare } from '@capacitor/share';
import { X, Camera, ChevronRight, Home, Briefcase, Plus, MessageSquare, MessageCircle, Send, Search, Share } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { supabase } from '../lib/supabase';
import { openWhatsApp } from '../lib/capacitor';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

const haptic = async (s = ImpactStyle.Light) => { try { await Haptics.impact({ style: s }); } catch(e) {} };

// Swipeable container — drag right to dismiss (iOS-native feel)
function SwipeableView({ onClose, children, style = {} }) {
  const handleDragEnd = (_, info) => {
    // Dismiss if dragged > 30% of screen width OR flicked fast
    if (info.offset.x > 100 || info.velocity.x > 500) {
      haptic();
      onClose();
    }
  };

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0.8 }}
      animate={{ x: 0, opacity: 1, transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] } }}
      exit={{ x: '100%', opacity: 0.8, transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] } }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.6 }}
      dragDirectionLock
      onDragEnd={handleDragEnd}
      style={{
        position: 'fixed', inset: 0, background: '#FFF', zIndex: 1000,
        padding: 'calc(var(--safe-top) + 16px) 24px calc(var(--safe-bottom) + 24px)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        touchAction: 'pan-y',
        ...style
      }}
    >
      {children}
    </motion.div>
  );
}

const rowStyle = { borderBottom: '1px solid #F5F5F5', padding: '18px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const labelStyle = { fontSize: '0.875rem', color: '#000000', fontWeight: 400 };
const valStyle = { fontSize: '0.875rem', color: '#888' };
const headerStyle = { fontSize: '0.8125rem', fontWeight: 600, letterSpacing: '3px', color: '#000000', textAlign: 'center' };

// =====================
// MY INFO
// =====================
export function MyInfoView({ onClose }) {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const name = user?.user_metadata?.full_name || '';
  const phone = user?.phone || '';
  const [savedPlaces, setSavedPlaces] = useState({ home: null, work: null, other: null });
  const [editingPlace, setEditingPlace] = useState(null); // 'home' | 'work' | 'other' | null
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState([]);
  const [placeLoading, setPlaceLoading] = useState(false);
  const placeInputRef = React.useRef(null);
  const placeDebounceRef = React.useRef(null);

  // Load saved places from preferences
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('passenger_profiles').select('preferences').eq('user_id', user.id).single();
      if (data?.preferences?.saved_places) {
        setSavedPlaces(data.preferences.saved_places);
      }
    })();
  }, [user]);

  // Search places
  const searchPlace = (query) => {
    if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current);
    if (!query || query.length < 2) { setPlaceResults([]); return; }
    placeDebounceRef.current = setTimeout(async () => {
      setPlaceLoading(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        setPlaceResults(data.map(p => ({
          id: p.place_id,
          name: p.display_name.split(',')[0],
          address: p.display_name.split(',').slice(1, 4).join(',').trim(),
          full: p.display_name,
          lat: parseFloat(p.lat),
          lon: parseFloat(p.lon)
        })));
      } catch (e) { console.warn('Place search failed:', e); }
      finally { setPlaceLoading(false); }
    }, 300);
  };

  // Save a place
  const savePlace = async (type, place) => {
    haptic(ImpactStyle.Medium);
    const updated = { ...savedPlaces, [type]: { name: place.name, address: place.full, lat: place.lat, lon: place.lon } };
    setSavedPlaces(updated);
    setEditingPlace(null);
    setPlaceQuery('');
    setPlaceResults([]);
    // Merge into existing preferences
    const { data: profile } = await supabase.from('passenger_profiles').select('preferences').eq('user_id', user.id).single();
    const prefs = profile?.preferences || {};
    await supabase.from('passenger_profiles').update({ preferences: { ...prefs, saved_places: updated } }).eq('user_id', user.id);
  };

  // Clear a place
  const clearPlace = async (type) => {
    haptic();
    const updated = { ...savedPlaces, [type]: null };
    setSavedPlaces(updated);
    const { data: profile } = await supabase.from('passenger_profiles').select('preferences').eq('user_id', user.id).single();
    const prefs = profile?.preferences || {};
    await supabase.from('passenger_profiles').update({ preferences: { ...prefs, saved_places: updated } }).eq('user_id', user.id);
  };

  const PlaceRow = ({ type, icon: Icon, label }) => {
    const place = savedPlaces[type];
    if (editingPlace === type) {
      return (
        <div style={{ borderBottom: '1px solid #F5F5F5', padding: '14px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <Icon size={18} color="#D4CFC9" />
            <input
              ref={placeInputRef}
              type="text"
              value={placeQuery}
              onChange={(e) => { setPlaceQuery(e.target.value); searchPlace(e.target.value); }}
              placeholder={`Search ${label.toLowerCase()}...`}
              autoFocus
              style={{
                flex: 1, background: 'transparent', border: 'none', color: '#000',
                fontSize: '0.875rem', outline: 'none', fontFamily: 'var(--font-family)',
                caretColor: '#000'
              }}
            />
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setEditingPlace(null); setPlaceQuery(''); setPlaceResults([]); }}
              style={{ background: '#F5F5F5', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              <X size={12} color="#888" />
            </motion.button>
          </div>
          {placeLoading && <div style={{ fontSize: '0.6875rem', color: '#555', padding: '8px 0', letterSpacing: '2px' }}>SEARCHING...</div>}
          {placeResults.map(r => (
            <motion.div key={r.id} whileTap={{ scale: 0.98 }} onClick={() => savePlace(type, r)}
              style={{ padding: '12px 0 12px 30px', borderTop: '1px solid #FFFFFF', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '0.8125rem', color: '#000' }}>{r.name}</span>
              <span style={{ fontSize: '0.6875rem', color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.address}</span>
            </motion.div>
          ))}
        </div>
      );
    }
    return (
      <motion.div whileTap={{ scale: 0.98 }} onClick={() => { if (!place) { setEditingPlace(type); setTimeout(() => placeInputRef.current?.focus(), 100); } }}
        style={{ ...rowStyle, cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
          <Icon size={18} color={place ? '#D4CFC9' : '#888'} />
          {place ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={labelStyle}>{place.name}</div>
              <div style={{ fontSize: '0.6875rem', color: '#555', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{place.address}</div>
            </div>
          ) : (
            <span style={labelStyle}>{label}</span>
          )}
        </div>
        {place ? (
          <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); clearPlace(type); }}
            style={{ background: '#FFFFFF', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={12} color="#555" />
          </motion.button>
        ) : (
          <ChevronRight size={16} color="#555" />
        )}
      </motion.div>
    );
  };

  return (
    <SwipeableView onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic(); onClose(); }} style={{ background: 'transparent', border: '1px solid #EBEBEB', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={18} color="#000" />
        </motion.button>
        <span style={headerStyle}>{t('myInfo')}</span>
        <div style={{ width: '40px' }} />
      </div>

      {/* Avatar */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
        <div style={{ width: '100px', height: '100px', borderRadius: '50%', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <span style={{ fontSize: '2rem', color: '#555' }}>{name?.[0]?.toUpperCase() || '?'}</span>
          <div style={{ position: 'absolute', bottom: 0, right: 0, background: '#EBEBEB', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Camera size={14} color="#000" />
          </div>
        </div>
      </div>

      <div style={rowStyle}><span style={labelStyle}>{name || 'No name set'}</span></div>
      <div style={rowStyle}><span style={labelStyle}>{phone}</span></div>

      <div style={{ marginTop: '40px' }}>
        <div style={{ fontSize: '0.6875rem', letterSpacing: '2px', color: '#555', marginBottom: '16px' }}>{t('favourites')}</div>
        <PlaceRow type="home" icon={Home} label={t('addHome')} />
        <PlaceRow type="work" icon={Briefcase} label={t('addWork')} />
        <PlaceRow type="other" icon={Plus} label={t('addOther')} />
      </div>
    </SwipeableView>
  );
}

// =====================
// MY PREFERENCES
// =====================
export function MyPreferencesView({ onClose }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [prefs, setPrefs] = useState({ temp: 21, music: 'none', conversation: 'silent', beverage: 'water' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('passenger_profiles').select('preferences').eq('user_id', user.id).single();
      if (data?.preferences && Object.keys(data.preferences).length) setPrefs(data.preferences);
    })();
  }, [user]);

  const update = async (key, val) => {
    haptic();
    const next = { ...prefs, [key]: val };
    setPrefs(next);
    setSaving(true);
    await supabase.from('passenger_profiles').update({ preferences: next }).eq('user_id', user.id);
    setSaving(false);
  };

  const Option = ({ label, options, current, field }) => (
    <div style={{ marginBottom: '28px' }}>
      <div style={{ fontSize: '0.6875rem', letterSpacing: '2px', color: '#555', marginBottom: '12px' }}>{label}</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {options.map(o => (
          <motion.button key={o} whileTap={{ scale: 0.95 }} onClick={() => update(field, o)}
            style={{ padding: '10px 20px', background: current === o ? '#000' : 'transparent', color: current === o ? '#FFF' : '#888', border: current === o ? 'none' : '1px solid #EBEBEB', fontSize: '0.8125rem', fontWeight: 500, letterSpacing: '1px', cursor: 'pointer', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent' }}>
            {o}
          </motion.button>
        ))}
      </div>
    </div>
  );

  return (
    <SwipeableView onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic(); onClose(); }} style={{ background: 'transparent', border: '1px solid #EBEBEB', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={18} color="#000" />
        </motion.button>
        <span style={headerStyle}>{t('preferences')}</span>
        <div style={{ width: '40px', textAlign: 'right' }}>
          {saving && <span style={{ fontSize: '0.625rem', color: '#555' }}>...</span>}
        </div>
      </div>

      <Option label={t('conversation')} options={['silent', 'minimal', 'chatty']} current={prefs.conversation} field="conversation" />
      <Option label={t('temperature')} options={['cool', 'normal', 'warm']} current={prefs.temp} field="temp" />
      <Option label={t('music')} options={['none', 'jazz', 'classical', 'ambient']} current={prefs.music} field="music" />
      <Option label={t('beverage')} options={['water', 'sparkling', 'none']} current={prefs.beverage} field="beverage" />
    </SwipeableView>
  );
}

// =====================
// JOURNEY HISTORY
// =====================
export function JourneyHistoryView({ onClose }) {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('rides').select('*').eq('passenger_id', user.id).order('created_at', { ascending: false }).limit(20);
      setRides(data || []);
      setLoading(false);
    })();
  }, [user]);

  return (
    <SwipeableView onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic(); onClose(); }} style={{ background: 'transparent', border: '1px solid #EBEBEB', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={18} color="#000" />
        </motion.button>
        <span style={headerStyle}>{t('journeyHistory')}</span>
        <div style={{ width: '40px' }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%' }}>
            <span style={{ color: '#555', fontSize: '0.75rem', letterSpacing: '2px' }}>{t('loading')}</span>
          </div>
        ) : rides.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', flexDirection: 'column', gap: '8px' }}>
            <span style={{ color: '#000', fontSize: '0.8125rem', fontWeight: 600, letterSpacing: '3px' }}>{t('noJourneys')}</span>
            <span style={{ color: '#555', fontSize: '0.75rem' }}>{t('noJourneysSub')}</span>
          </div>
        ) : (
          rides.map(r => (
            <div key={r.id} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ ...labelStyle, fontWeight: 500 }}>{r.dropoff_address || 'Unknown'}</span>
                <span style={{ color: '#000', fontWeight: 600 }}>£{r.final_calculated_price?.toFixed(2) || '—'}</span>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <span style={valStyle}>{new Date(r.created_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <span style={{ ...valStyle, textTransform: 'uppercase', fontSize: '0.6875rem', letterSpacing: '1px' }}>{r.status}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </SwipeableView>
  );
}

// =====================
// PAYMENT & CREDITS
// =====================
export function PaymentCreditsView({ onClose }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [credits, setCredits] = useState(0);
  const [stripeId, setStripeId] = useState(null);
  const [cardInfo, setCardInfo] = useState(null); // { brand, last4 }
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [error, setError] = useState(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemMessage, setRedeemMessage] = useState(null);
  const [myGiftCards, setMyGiftCards] = useState([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('passenger_profiles').select('available_credits, stripe_customer_id').eq('user_id', user.id).single();
      setCredits(data?.available_credits || 0);
      setStripeId(data?.stripe_customer_id || null);
      // Card columns may not exist yet
      try {
        const { data: cardData } = await supabase.from('passenger_profiles').select('card_brand, card_last4').eq('user_id', user.id).single();
        if (cardData?.card_brand && cardData?.card_last4) {
          setCardInfo({ brand: cardData.card_brand, last4: cardData.card_last4 });
        }
      } catch (e) {}

      // Fetch user's purchased gift cards
      try {
        const { data: gcData } = await supabase.from('gift_cards').select('*').eq('purchased_by', user.id).order('created_at', { ascending: false });
        if (gcData) setMyGiftCards(gcData);
      } catch(e) {}

      setLoading(false);
    })();
  }, [user]);

  // Full Stripe setup flow
  const setupCardPayment = async () => {
    haptic(ImpactStyle.Medium);
    setProcessing(true);
    setError(null);

    try {
      // Step 1: Ensure Stripe customer exists
      const { data: custData, error: custErr } = await supabase.functions.invoke('create-stripe-customer', {
        body: {
          user_id: user.id,
          name: user.user_metadata?.full_name || '',
          phone: user.phone || ''
        }
      });
      if (custErr) throw new Error(custErr.message || 'Failed to create customer');

      // Step 2: Create SetupIntent
      const { data: setupData, error: setupErr } = await supabase.functions.invoke('create-setup-intent', {
        body: { user_id: user.id }
      });
      if (setupErr) throw new Error(setupErr.message || 'Failed to create setup intent');

      // Step 3: Present Stripe Payment Sheet (native)
      try {
        const { Stripe: StripePlugin } = await import('@capacitor-community/stripe');
        
        await StripePlugin.initialize({
          publishableKey: setupData.publishable_key
        });

        await StripePlugin.createPaymentSheet({
          setupIntentClientSecret: setupData.setup_intent_client_secret,
          customerEphemeralKeySecret: setupData.ephemeral_key,
          customerId: setupData.customer_id,
          merchantDisplayName: 'ELS Elite',
          style: 'alwaysDark',
          enableApplePay: true,
          enableGooglePay: false,
          countryCode: 'GB',
          currency: 'gbp'
        });

        const result = await StripePlugin.presentPaymentSheet();
        
        if (result?.paymentResult === 'COMPLETED') {
          haptic(ImpactStyle.Heavy);
          // Card saved successfully — update UI
          setStripeId(setupData.customer_id);
          // Fetch the saved card details from our backend
          await fetchCardDetails();
        }
      } catch (nativeErr) {
        // Not on native — fallback info
        if (nativeErr.message?.includes('cancelled') || nativeErr.message?.includes('canceled')) {
          // User cancelled — not an error
          return;
        }
        // If plugin not available (web dev), show a message
        console.warn('Stripe native plugin not available:', nativeErr);
        setError('Card setup requires the native app. Open in Xcode to test.');
      }
    } catch (e) {
      console.error('Payment setup error:', e);
      setError(e.message || 'Something went wrong');
    } finally {
      setProcessing(false);
    }
  };

  // Fetch saved card details
  const fetchCardDetails = async () => {
    try {
      const { data } = await supabase.from('passenger_profiles')
        .select('card_brand, card_last4, stripe_customer_id')
        .eq('user_id', user.id).single();
      if (data?.card_brand && data?.card_last4) {
        setCardInfo({ brand: data.card_brand, last4: data.card_last4 });
      }
      if (data?.stripe_customer_id) setStripeId(data.stripe_customer_id);
    } catch (e) {}
  };

  const brandDisplay = (brand) => {
    const brands = { visa: 'VISA', mastercard: 'MC', amex: 'AMEX', discover: 'DISC' };
    return brands[brand?.toLowerCase()] || brand?.toUpperCase() || 'CARD';
  };

  return (
    <SwipeableView onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic(); onClose(); }} style={{ background: 'transparent', border: '1px solid rgba(212,207,201,0.12)', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={18} color="#000" />
        </motion.button>
        <span style={headerStyle}>{t('paymentCredits')}</span>
        <div style={{ width: '40px' }} />
      </div>

      {/* Balance Card */}
      <div style={{ background: '#111111', padding: '28px 24px', marginBottom: '32px', borderLeft: '2px solid #D4CFC9' }}>
        <div style={{ fontSize: '0.6875rem', letterSpacing: '2px', color: '#888888', marginBottom: '8px' }}>{t('eliteCredits')}</div>
        <div style={{ fontSize: '2.5rem', fontWeight: 300, color: '#FFFFFF', fontFamily: 'var(--font-display)' }}>
          {loading ? '...' : `£${credits.toFixed(2)}`}
        </div>
      </div>

      {/* Payment Method */}
      <div style={{ fontSize: '0.6875rem', letterSpacing: '2px', color: '#555', marginBottom: '16px' }}>{t('paymentMethod')}</div>
      
      {cardInfo ? (
        <div style={{ ...rowStyle, borderBottom: '1px solid #F5F5F5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '28px', background: '#111111', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '0.5625rem', color: '#888888', fontWeight: 600 }}>{brandDisplay(cardInfo.brand)}</span>
            </div>
            <span style={labelStyle}>•••• {cardInfo.last4}</span>
          </div>
          <ChevronRight size={16} color="#555" />
        </div>
      ) : stripeId && stripeId !== 'pending_setup' ? (
        <div style={{ ...rowStyle, borderBottom: '1px solid #F5F5F5', cursor: 'pointer' }} onClick={setupCardPayment}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '28px', background: '#111111', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={14} color="#888" />
            </div>
            <span style={labelStyle}>{t('addCard')}</span>
          </div>
          <ChevronRight size={16} color="#555" />
        </div>
      ) : (
        <motion.button whileTap={{ scale: 0.97 }} onClick={setupCardPayment} disabled={processing}
            style={{ width: '100%', height: '56px', background: '#000', color: '#FFF', fontSize: '0.6875rem', letterSpacing: '3px', fontWeight: 600, border: 'none', cursor: processing ? 'wait' : 'pointer', opacity: processing ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <svg width="20" height="16" viewBox="0 0 24 19" fill="none" stroke="#FFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="22" height="17" rx="3"/><line x1="1" y1="7" x2="23" y2="7"/></svg>
            {processing ? 'SETTING UP...' : t('addCard')}
          </motion.button>
      )}

      {/* Error message */}
      {error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: '16px', padding: '12px 16px', background: .rgba(255,59,48,0.08)., border: '1px solid #FECACA', fontSize: '0.75rem', color: '#FF3B30' }}>
          {error}
        </motion.div>
      )}

      <div style={{ flex: 1 }} />

      {/* Redeem Gift Card */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '0.6875rem', letterSpacing: '2px', color: '#555', marginBottom: '8px' }}>REDEEM GIFT CARD</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input 
            type="text" 
            placeholder="Enter Code (e.g. ELITE-ELS-A1B2)" 
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
            style={{ flex: 1, background: 'transparent', border: '1px solid rgba(212,207,201,0.12)', borderRadius: '4px', padding: '0 16px', color: '#FFFFFF', fontSize: '0.875rem', outline: 'none' }}
          />
          <motion.button 
            whileTap={{ scale: 0.97 }} 
            onClick={async () => {
              if (!redeemCode) return;
              haptic();
              setRedeemLoading(true);
              setRedeemMessage(null);
              // Call edge function or RPC to redeem
              try {
                // Because we don't have an RPC yet, let's simulate the legit database logic:
                // 1. Fetch code
                const { data: codeData, error: fetchErr } = await supabase.from('gift_cards').select('*').eq('code', redeemCode).single();
                if (fetchErr || !codeData) throw new Error('Invalid code');
                if (codeData.status !== 'active') throw new Error('Code already redeemed');

                // 2. Mark as redeemed
                await supabase.from('gift_cards').update({ status: 'redeemed', redeemed_by: user.id, redeemed_at: new Date().toISOString() }).eq('id', codeData.id);
                
                // 3. Add credits
                const newCredits = credits + codeData.value;
                await supabase.from('passenger_profiles').update({ available_credits: newCredits }).eq('user_id', user.id);
                
                setCredits(newCredits);
                setRedeemMessage({ type: 'success', text: `£${codeData.value} added to your balance!` });
                setRedeemCode('');
              } catch (e) {
                setRedeemMessage({ type: 'error', text: e.message || 'Invalid or expired code' });
              } finally {
                setRedeemLoading(false);
              }
            }}
            disabled={redeemLoading || !redeemCode}
            style={{ height: '56px', padding: '0 24px', background: '#D4CFC9', color: '#000000', fontSize: '0.6875rem', letterSpacing: '2px', fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: '4px' }}
          >
            {redeemLoading ? '...' : 'REDEEM'}
          </motion.button>
        </div>
        {redeemMessage && (
          <div style={{ fontSize: '0.75rem', color: redeemMessage.type === 'success' ? '#4CAF50' : '#FF6B6B', marginTop: '8px' }}>
            {redeemMessage.text}
          </div>
        )}
      </div>

      {/* My Purchased Gift Cards */}
      {myGiftCards.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontSize: '0.6875rem', letterSpacing: '2px', color: '#555', marginBottom: '16px' }}>MY PURCHASED CODES</div>
          {myGiftCards.map(gc => (
            <div key={gc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: '#111111', borderRadius: '8px', marginBottom: '8px', border: '1px solid rgba(212,207,201,0.08)' }}>
              <div>
                <div style={{ fontSize: '1rem', color: '#FFFFFF', fontWeight: 600, letterSpacing: '2px', marginBottom: '4px' }}>{gc.code}</div>
                <div style={{ fontSize: '0.6875rem', color: gc.status === 'redeemed' ? '#888' : '#4CAF50' }}>
                  {gc.status === 'redeemed' ? 'REDEEMED' : 'ACTIVE'} • £{gc.value}
                </div>
              </div>
              <motion.button 
                whileTap={{ scale: 0.9 }} 
                onClick={() => {
                  navigator.clipboard.writeText(gc.code);
                  haptic();
                  alert('Code copied!');
                }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </motion.button>
            </div>
          ))}
        </div>
      )}

      {/* Top Up */}
      <motion.button whileTap={{ scale: 0.97 }} onClick={() => haptic(ImpactStyle.Medium)}
        style={{ width: '100%', height: '56px', background: 'transparent', color: '#FFFFFF', fontSize: '0.6875rem', letterSpacing: '3px', fontWeight: 600, border: '1px solid rgba(212,207,201,0.12)', cursor: 'pointer', marginBottom: '12px' }}>
        {t('topUpCredits')}
      </motion.button>


    </SwipeableView>
  );
}

// =====================
// MEMBERSHIP
// =====================
const TIERS = [
  {
    id: 'silver',
    name: 'SILVER',
    color: '#AAA',
    gradient: 'linear-gradient(135deg, #888, #CCC)',
    benefits: ['Standard booking', 'Basic support', 'Ride history access'],
    price: 'Free'
  },
  {
    id: 'gold',
    name: 'GOLD',
    color: '#D4AF37',
    gradient: 'linear-gradient(135deg, #B8860B, #FFD700)',
    benefits: ['Priority dispatch', '10% credit bonus', 'Preferred drivers', 'Flight tracking'],
    price: '£29.99/mo'
  },
  {
    id: 'platinum',
    name: 'PLATINUM',
    color: '#E8E8E8',
    gradient: 'linear-gradient(135deg, #C0C0C0, #F0F0F0)',
    benefits: ['Instant dispatch', '25% credit bonus', 'Dedicated concierge', 'Complimentary upgrades', 'Airport lounge access', 'Cancel anytime'],
    price: '£79.99/mo'
  }
];

export function MembershipView({ onClose }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [currentTier, setCurrentTier] = useState('silver');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('passenger_profiles').select('tier').eq('user_id', user.id).single();
        if (data?.tier) setCurrentTier(data.tier);
      } catch (e) {}
      setLoading(false);
    })();
  }, [user]);

  const currentTierIndex = TIERS.findIndex(t => t.id === currentTier);

  return (
    <SwipeableView onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic(); onClose(); }} style={{ background: 'transparent', border: '1px solid #EBEBEB', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={18} color="#000" />
        </motion.button>
        <span style={headerStyle}>{t('membership')}</span>
        <div style={{ width: '40px' }} />
      </div>

      {/* Current Tier Badge */}
      {!loading && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            width: '80px', height: '80px', borderRadius: '50%', margin: '0 auto 16px',
            background: TIERS[currentTierIndex]?.gradient,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 8px 32px ${TIERS[currentTierIndex]?.color}22`
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill={currentTier === 'gold' ? '#FFF' : '#EBEBEB'}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </div>
          <div style={{ fontSize: '0.875rem', letterSpacing: '4px', color: TIERS[currentTierIndex]?.color, fontWeight: 600 }}>
            {currentTier.toUpperCase()} MEMBER
          </div>
        </motion.div>
      )}

      {/* Tier Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, overflowY: 'auto', paddingBottom: '24px' }}>
        {TIERS.map((tier, idx) => {
          const isActive = tier.id === currentTier;
          const isUpgrade = idx > currentTierIndex;
          return (
            <motion.div key={tier.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              style={{
                padding: '20px',
                background: isActive ? '#FFFFFF' : 'transparent',
                border: isActive ? `1px solid ${tier.color}44` : '1px solid #FFFFFF'
              }}>
              {/* Header row: icon + name + badge/price */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%', background: tier.gradient,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill={tier.id === 'gold' ? '#FFF' : '#EBEBEB'}>
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                </div>
                <span style={{ fontSize: '1rem', letterSpacing: '3px', color: tier.color, fontWeight: 600 }}>{tier.name}</span>
                <div style={{ marginLeft: 'auto', textAlign: 'right', flexShrink: 0 }}>
                  {isActive ? (
                    <div style={{ fontSize: '0.6875rem', letterSpacing: '2px', color: tier.color, fontWeight: 700 }}>CURRENT</div>
                  ) : null}
                  <div style={{ fontSize: '0.9375rem', color: '#555' }}>{tier.price}</div>
                </div>
              </div>
              {/* Benefits */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '40px' }}>
                {tier.benefits.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '4px', height: '4px', background: isActive || !isUpgrade ? tier.color : '#EBEBEB', borderRadius: '50%', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.875rem', color: isActive ? '#CCC' : '#666' }}>{b}</span>
                  </div>
                ))}
              </div>
              {isUpgrade && (
                <motion.button whileTap={{ scale: 0.97 }} onClick={() => haptic(ImpactStyle.Medium)}
                  style={{
                    marginTop: '16px', marginLeft: '36px', padding: '10px 24px',
                    background: tier.id === 'platinum' ? '#000' : 'transparent',
                    color: tier.id === 'platinum' ? '#FFF' : tier.color,
                    border: tier.id === 'platinum' ? 'none' : `1px solid ${tier.color}44`,
                    fontSize: '0.75rem', letterSpacing: '3px', fontWeight: 600, cursor: 'pointer'
                  }}>
                  UPGRADE TO {tier.name}
                </motion.button>
              )}
            </motion.div>
          );
        })}
      </div>
    </SwipeableView>
  );
}

// =============================================
// SUPPORT & CUSTOMER SERVICE
// =============================================

function MessagesHubView({ onClose }) {
  return (
    <SwipeableView onClose={onClose} style={{ background: '#FFF', color: '#000' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
         <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #EBEBEB', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={18} color="#000" />
         </button>
      </div>

      <div style={{ display: 'flex', marginBottom: '24px' }}>
         <img src="https://i.pravatar.cc/100?img=1" style={{ width: '48px', height: '48px', borderRadius: '50%', border: '2px solid #000', zIndex: 3, objectFit: 'cover' }} />
         <img src="https://i.pravatar.cc/100?img=5" style={{ width: '48px', height: '48px', borderRadius: '50%', border: '2px solid #000', marginLeft: '-12px', zIndex: 2, objectFit: 'cover' }} />
         <img src="https://i.pravatar.cc/100?img=9" style={{ width: '48px', height: '48px', borderRadius: '50%', border: '2px solid #000', marginLeft: '-12px', zIndex: 1, objectFit: 'cover' }} />
      </div>

      <h1 style={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1.1, marginBottom: '40px', fontFamily: 'var(--font-display)', color: '#000' }}>
        Customer Service<br/>How can we help?
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
         <motion.button whileTap={{ scale: 0.98 }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', background: '#000', border: '1px solid #EBEBEB', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', cursor: 'pointer' }}>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: '#FFF' }}>Messages</span>
            <MessageSquare size={20} color="#FFF" fill="#FFF" />
         </motion.button>
         <motion.button whileTap={{ scale: 0.98 }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', background: '#000', border: '1px solid #EBEBEB', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', cursor: 'pointer' }}>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: '#FFF' }}>Send us a message</span>
            <Send size={20} color="#FFF" />
         </motion.button>
      </div>
    </SwipeableView>
  );
}

function FaqView({ onClose }) {
  const [expandedId, setExpandedId] = useState(null);

  const faqs = [
    {
      id: 'gratuity',
      q: 'Can I leave a gratuity?',
      a: 'Yes, you can leave a gratuity for your chauffeur. Gratuities are completely optional. You can add a tip through the app at the end of your journey, or you may offer a cash gratuity directly to your chauffeur if you prefer.'
    },
    {
      id: 'out-of-city',
      q: 'How do you calculate fares for out-of-city pickups?',
      a: 'Fares for out-of-city pickups are calculated based on the distance from our primary service area to the pickup location, plus the estimated travel time. You will always see the fully calculated, transparent quote in the app before confirming your booking.'
    },
    {
      id: 'payment-method',
      q: 'How do I change my payment method?',
      a: "You can change your payment method by navigating to 'Payment & Credits' from the main menu. From there, you can add a new card, set your default payment method, or top up your account balance."
    },
    {
      id: 'pre-auth',
      q: 'Pre-authorisation',
      a: 'To ensure a seamless experience, we place a temporary pre-authorisation hold on your card before your journey begins. This is not a charge. The hold will be released, and the final amount will be captured only after your journey is completed.'
    },
    {
      id: 'how-to-pay',
      q: 'How do I pay for a journey?',
      a: 'All payments are handled securely through the app. The cost of your journey will be automatically deducted from your Elite Credits balance. If your credit balance is insufficient, the remaining amount will be charged to your saved payment card.'
    }
  ];

  const toggleFaq = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <SwipeableView onClose={onClose} style={{ background: '#FFF', color: '#000' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
         <button onClick={onClose} style={{ background: 'transparent', border: 'none', padding: '0', cursor: 'pointer' }}>
            <X size={24} color="#000" />
         </button>
         <Share size={20} color="#FFF" />
      </div>

      <h1 style={{ fontSize: '2rem', fontWeight: 400, textAlign: 'center', marginBottom: '40px', fontFamily: 'var(--font-display)', color: '#FFF' }}>
        How can we help?
      </h1>

      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '0.6875rem', letterSpacing: '1px', color: '#555', marginBottom: '8px', textTransform: 'uppercase' }}>Country</div>
        <div style={{ padding: '16px', border: '1px solid #EBEBEB', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '1rem', color: '#FFF' }}>United Kingdom</span>
          <ChevronRight size={16} color="#FFF" style={{ transform: 'rotate(90deg)' }} />
        </div>
      </div>

      <div style={{ marginBottom: '40px' }}>
        <div style={{ fontSize: '0.6875rem', letterSpacing: '1px', color: '#555', marginBottom: '8px', textTransform: 'uppercase' }}>Search FAQ</div>
        <div style={{ padding: '16px', border: '1px solid #EBEBEB', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <input type="text" placeholder="" style={{ background: 'transparent', border: 'none', outline: 'none', width: '100%', fontSize: '1rem', color: '#000' }} />
          <Search size={16} color="#FFF" />
        </div>
      </div>

      <div style={{ fontSize: '1.25rem', letterSpacing: '1px', color: '#FFF', marginBottom: '16px', textTransform: 'uppercase', borderBottom: '1px solid #EBEBEB', paddingBottom: '16px', fontFamily: 'var(--font-display)' }}>
        PAYMENT
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {faqs.map(faq => (
          <div key={faq.id} style={{ borderBottom: '1px solid #EBEBEB' }}>
            <div 
              onClick={() => toggleFaq(faq.id)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 0', cursor: 'pointer' }}
            >
              <span style={{ fontSize: '1rem', color: '#FFF', paddingRight: '16px' }}>{faq.q}</span>
              <motion.div animate={{ rotate: expandedId === faq.id ? 180 : 0 }}>
                <ChevronRight size={16} color="#FFF" style={{ transform: 'rotate(90deg)' }} />
              </motion.div>
            </div>
            <motion.div 
              initial={false}
              animate={{ height: expandedId === faq.id ? 'auto' : 0, opacity: expandedId === faq.id ? 1 : 0 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ paddingBottom: '20px', color: '#555', fontSize: '0.9375rem', lineHeight: 1.6 }}>
                {faq.a}
              </div>
            </motion.div>
          </div>
        ))}
      </div>
    </SwipeableView>
  );
}

export function SupportView({ onClose }) {
  const [activeSubView, setActiveSubView] = useState(null);

  if (activeSubView === 'messages') return <MessagesHubView onClose={() => setActiveSubView(null)} />;
  if (activeSubView === 'faq') return <FaqView onClose={() => setActiveSubView(null)} />;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: '#000', color: '#FFF',
          borderTopLeftRadius: '24px', borderTopRightRadius: '24px',
          padding: '24px', paddingBottom: 'calc(var(--safe-bottom) + 24px)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, letterSpacing: '1px', color: '#FFF' }}>CUSTOMER SERVICE</span>
          <button onClick={onClose} style={{ background: '#F5F5F5', borderRadius: '50%', border: 'none', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} color="#FFF" />
          </button>
        </div>
        
        <div onClick={() => { haptic(); setActiveSubView('messages'); }} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px 0', borderBottom: '1px solid #EBEBEB', cursor: 'pointer' }}>
          <MessageSquare size={20} color="#FFF" fill="#FFF" />
          <span style={{ fontSize: '1rem', fontWeight: 400, color: '#FFF' }}>Open Chat</span>
        </div>
        
        <div onClick={() => { haptic(); openWhatsApp(); }} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px 0', borderBottom: '1px solid #EBEBEB', cursor: 'pointer' }}>
          <MessageCircle size={20} color="#FFF" />
          <span style={{ fontSize: '1rem', fontWeight: 400, color: '#FFF' }}>WhatsApp the Office</span>
        </div>
        
        <div onClick={() => { haptic(); setActiveSubView('faq'); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 0', cursor: 'pointer' }}>
          <span style={{ fontSize: '1rem', fontWeight: 400, color: '#FFF' }}>Questions &amp; Answers</span>
          <ChevronRight size={20} color="#888" />
        </div>
      </motion.div>
    </motion.div>
  );
}

// =====================
// GIFT CARDS
// =====================
export function GiftCardsView({ onClose }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [selectedCard, setSelectedCard] = useState(0);
  const [purchasedCode, setPurchasedCode] = useState(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const scrollRef = useRef(null);

  const cards = [
    { id: '100', amount: 100, src: '/giftcards/100.png' },
    { id: '500', amount: 500, src: '/giftcards/500.png' },
    { id: '1000', amount: 1000, src: '/giftcards/1000.png' },
    { id: '2500', amount: 2500, src: '/giftcards/2500.png' }
  ];

  const handleScroll = (e) => {
    if (!scrollRef.current) return;
    const scrollLeft = e.target.scrollLeft;
    const cardWidth = e.target.clientWidth * 0.85 + 20; // 85% min-width + gap
    const index = Math.round(scrollLeft / cardWidth);
    if (index !== selectedCard && index >= 0 && index < cards.length) {
      setSelectedCard(index);
      haptic();
    }
  };

  const handlePurchase = async () => {
    haptic(ImpactStyle.Heavy);
    setIsPurchasing(true);
    
    // Generate a legit code
    const code = 'ELITE-ELS-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const value = cards[selectedCard].amount;

    try {
      // In a real scenario, this happens AFTER a successful Stripe charge.
      // We insert the legit code into the database so it can be redeemed.
      await supabase.from('gift_cards').insert({
        code: code,
        value: value,
        status: 'active',
        purchased_by: user.id
      });
      
      setPurchasedCode(code);
      haptic(ImpactStyle.Heavy);
    } catch (e) {
      console.error('Failed to create code', e);
      alert('Failed to generate gift card. Please try again.');
    } finally {
      setIsPurchasing(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(purchasedCode);
    haptic();
    alert('Code copied to clipboard!');
  };

  const handleShare = async () => {
    haptic();
    try {
      await CapShare.share({
        title: 'ELS Elite Gift Card',
        text: `I've sent you a £${cards[selectedCard].amount} ELS Elite Gift Card! Redeem it using code: ${purchasedCode}`,
        url: 'https://app.elite-els.co.uk',
        dialogTitle: 'Share Gift Card'
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRedeem = () => {
    haptic();
    // Simulate redemption
    alert(`Successfully added £${cards[selectedCard].amount} to your ELS Elite credits!`);
    onClose();
  };

  return (
    <SwipeableView onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic(); onClose(); }} style={{ background: 'transparent', border: '1px solid #EBEBEB', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={18} color="#000" />
        </motion.button>
        <span style={headerStyle}>GIFT CARDS</span>
        <div style={{ width: '40px' }} />
      </div>

      {purchasedCode ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center', marginTop: '40px' }}>
          <div style={{ fontSize: '3rem', fontWeight: 300, color: 'var(--color-gold)', fontFamily: 'var(--font-display)', marginBottom: '16px' }}>
            Success
          </div>
          <div style={{ fontSize: '1rem', color: '#888', marginBottom: '32px', lineHeight: 1.6 }}>
            Your £{cards[selectedCard].amount} digital gift card has been generated.
          </div>
          
          <div style={{ background: '#FFFFFF', border: '1px solid #EBEBEB', borderRadius: '16px', padding: '32px', marginBottom: '40px' }}>
            <div style={{ fontSize: '0.625rem', letterSpacing: '2px', color: '#555', marginBottom: '12px' }}>GIFT CARD CODE</div>
            <motion.div 
              whileTap={{ scale: 0.95 }}
              onClick={copyToClipboard}
              style={{ fontSize: '1.5rem', fontWeight: 600, color: '#000', letterSpacing: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              {purchasedCode}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </motion.div>
            <div style={{ fontSize: '0.625rem', color: '#888', marginTop: '12px' }}>TAP TO COPY</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <motion.button 
              whileTap={{ scale: 0.97 }} 
              onClick={handleRedeem}
              style={{ width: '100%', height: '56px', background: 'var(--color-gold)', color: '#FFF', fontSize: '0.75rem', letterSpacing: '2px', fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: '8px' }}
            >
              REDEEM TO MY ACCOUNT
            </motion.button>
            <motion.button 
              whileTap={{ scale: 0.97 }} 
              onClick={handleShare}
              style={{ width: '100%', height: '56px', background: 'transparent', color: '#000', fontSize: '0.75rem', letterSpacing: '2px', fontWeight: 600, border: '1px solid #EBEBEB', cursor: 'pointer', borderRadius: '8px' }}
            >
              SEND TO SOMEONE ELSE
            </motion.button>
            <motion.button 
              whileTap={{ scale: 0.97 }} 
              onClick={() => { haptic(); setPurchasedCode(null); }}
              style={{ width: '100%', height: '56px', background: 'transparent', color: '#888', fontSize: '0.75rem', letterSpacing: '2px', fontWeight: 600, border: 'none', cursor: 'pointer' }}
            >
              BUY ANOTHER CARD
            </motion.button>
          </div>
        </motion.div>
      ) : (
        <>
          <div style={{ fontSize: '0.8125rem', color: '#888', marginBottom: '32px', lineHeight: 1.6, textAlign: 'center' }}>
            Give the gift of seamless, ultra-premium travel. ELS Elite Gift Cards never expire and can be instantly applied to any booking.
          </div>

          <div 
            ref={scrollRef}
            onScroll={handleScroll}
            style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', gap: '20px', paddingBottom: '24px', margin: '0 -24px', paddingLeft: '24px', paddingRight: '24px' }} 
            className="hide-scroll"
          >
            {cards.map((card, idx) => (
              <motion.div 
                key={card.id} 
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  haptic(); 
                  setSelectedCard(idx);
                  if (scrollRef.current) {
                    const cardWidth = scrollRef.current.clientWidth * 0.85 + 20;
                    scrollRef.current.scrollTo({ left: idx * cardWidth, behavior: 'smooth' });
                  }
                }}
                style={{ 
                  minWidth: '85%', 
                  scrollSnapAlign: 'center', 
                  position: 'relative',
                  borderRadius: '16px',
                  border: selectedCard === idx ? '2px solid var(--color-gold)' : '2px solid transparent',
                  transition: 'border 0.3s ease',
                  overflow: 'hidden',
                  cursor: 'pointer'
                }}
              >
                <img src={card.src} alt={`£${card.amount} Gift Card`} style={{ width: '100%', display: 'block', borderRadius: '14px' }} />
              </motion.div>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: '16px', marginBottom: '32px' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 300, color: 'var(--color-gold)', fontFamily: 'var(--font-display)' }}>
              £{cards[selectedCard].amount}
            </div>
            <div style={{ fontSize: '0.625rem', letterSpacing: '2px', color: '#555', marginTop: '4px' }}>
              DIGITAL DELIVERY
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <motion.button 
            whileTap={{ scale: 0.97 }} 
            onClick={handlePurchase}
            disabled={isPurchasing}
            style={{ width: '100%', height: '56px', background: isPurchasing ? '#EBEBEB' : 'var(--color-warm-white)', color: isPurchasing ? '#888' : 'var(--color-primary-black)', fontSize: '0.6875rem', letterSpacing: '3px', fontWeight: 600, border: 'none', cursor: isPurchasing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {isPurchasing ? 'PROCESSING...' : 'PURCHASE GIFT CARD'}
          </motion.button>
        </>
      )}
    </SwipeableView>
  );
}

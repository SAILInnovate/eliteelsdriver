import React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { formatCallDuration } from '../lib/rideCall';

const SOFT_SPRING = { type: 'spring', stiffness: 480, damping: 38 };

const haptic = async (s = ImpactStyle.Light) => { try { await Haptics.impact({ style: s }); } catch { /* non-fatal */ } };

const initialsOf = (name) => (name || '')
  .split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();

const CircleButton = ({ onClick, background, border, children, label }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      aria-label={label}
      style={{
        width: '68px', height: '68px', borderRadius: '50%',
        background, border: border || 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      {children}
    </motion.button>
    <span style={{ fontSize: '0.6875rem', letterSpacing: '1px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>
      {label}
    </span>
  </div>
);

/**
 * Full-screen call surface. Purely presentational — every bit of call state
 * comes from useRideCall.
 */
export default function CallOverlay({
  status, peerName, peerPhoto, subtitle, muted, duration, note,
  onAccept, onDecline, onEnd, onToggleMute, onCallByPhone, onDismiss
}) {
  if (status === 'idle') return null;

  const statusLine = {
    outgoing: 'Calling…',
    incoming: 'Incoming call',
    connecting: 'Connecting…',
    active: formatCallDuration(duration),
    ended: note || 'Call ended',
    failed: note || 'Could not connect'
  }[status];

  const ringing = status === 'incoming';

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'linear-gradient(180deg, #1A1A1C 0%, #101011 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: 'calc(var(--safe-top, 0px) + 72px) 24px calc(var(--safe-bottom, 0px) + 48px)'
      }}
    >
      {/* Who's on the line */}
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={SOFT_SPRING}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}
      >
        <motion.div
          animate={ringing ? { scale: [1, 1.04, 1] } : { scale: 1 }}
          transition={ringing ? { repeat: Infinity, duration: 2.2, ease: 'easeInOut' } : { duration: 0.2 }}
          style={{
            width: '112px', height: '112px', borderRadius: '50%',
            background: peerPhoto ? `url(${peerPhoto}) center/cover` : 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.14)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FFF', fontSize: '2rem', fontWeight: 300, letterSpacing: '2px',
            fontFamily: 'var(--font-display), serif'
          }}
        >
          {!peerPhoto && (initialsOf(peerName) || '·')}
        </motion.div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '1.5rem', fontWeight: 400, color: '#FFF', letterSpacing: '1px',
            fontFamily: 'var(--font-display), serif'
          }}>
            {(peerName || 'Passenger').toUpperCase()}
          </div>
          {subtitle && (
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', letterSpacing: '1px', marginTop: '6px' }}>
              {subtitle}
            </div>
          )}
          <div style={{
            fontSize: '0.875rem', color: 'rgba(255,255,255,0.7)', letterSpacing: '1.5px',
            marginTop: '14px', fontVariantNumeric: 'tabular-nums'
          }}>
            {statusLine}
          </div>
        </div>
      </motion.div>

      <div style={{ flex: 1 }} />

      {/* Controls */}
      {ringing ? (
        <div style={{ display: 'flex', gap: '64px' }}>
          <CircleButton
            label="Decline"
            background="#E5484D"
            onClick={() => { haptic(ImpactStyle.Medium); onDecline(); }}
          >
            <PhoneOff size={26} color="#FFF" />
          </CircleButton>
          <CircleButton
            label="Accept"
            background="#30A46C"
            onClick={() => { haptic(ImpactStyle.Medium); onAccept(); }}
          >
            <Phone size={26} color="#FFF" />
          </CircleButton>
        </div>
      ) : status === 'failed' ? (
        // No relay could carry this one — hand them the carrier line rather
        // than leaving them staring at a dead call screen.
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px', width: '100%', maxWidth: '320px' }}>
          {onCallByPhone && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => { haptic(ImpactStyle.Medium); onCallByPhone(); }}
              style={{
                width: '100%', height: '56px', borderRadius: '14px', border: 'none',
                background: '#FFF', color: '#111', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                fontSize: '0.8125rem', fontWeight: 600, letterSpacing: '1px'
              }}
            >
              <Phone size={18} color="#111" />
              CALL BY PHONE INSTEAD
            </motion.button>
          )}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => { haptic(); onDismiss && onDismiss(); }}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.55)', fontSize: '0.75rem', letterSpacing: '1px', padding: '8px 16px'
            }}
          >
            CLOSE
          </motion.button>
        </div>
      ) : status === 'ended' ? (
        <div style={{ height: '104px' }} />
      ) : (
        <div style={{ display: 'flex', gap: '48px', alignItems: 'flex-start' }}>
          <CircleButton
            label={muted ? 'Unmute' : 'Mute'}
            background={muted ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.10)'}
            border="1px solid rgba(255,255,255,0.14)"
            onClick={onToggleMute}
          >
            {muted ? <MicOff size={24} color="#111" /> : <Mic size={24} color="#FFF" />}
          </CircleButton>
          <CircleButton
            label="End"
            background="#E5484D"
            onClick={() => { haptic(ImpactStyle.Medium); onEnd(); }}
          >
            <PhoneOff size={26} color="#FFF" />
          </CircleButton>
        </div>
      )}
    </motion.div>,
    document.body
  );
}

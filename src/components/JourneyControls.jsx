import React, { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronRight, ChevronLeft, Undo2, LogOut } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

/**
 * A swipe that can be armed in either direction. Reversing a step and logging
 * an unplanned stop are both deliberate gestures rather than taps — a driver
 * shouldn't be able to rewrite a job's timeline with a stray thumb.
 */
function SwipeAction({ label, onComplete, direction = 'right', size = 'lg', variant = 'primary', icon }) {
  // Remembering *which* action was confirmed re-arms the control for free when
  // the next step arrives, with no reset effect.
  const [confirmedLabel, setConfirmedLabel] = useState(null);
  const done = confirmedLabel === label;
  const containerRef = useRef(null);

  const tall = size === 'lg';
  const height = tall ? 72 : 52;
  const knob = tall ? 64 : 44;
  const rightward = direction === 'right';

  const handleDragEnd = (_, info) => {
    if (!containerRef.current || done) return;
    const width = containerRef.current.offsetWidth;
    const travelled = rightward ? info.offset.x : -info.offset.x;
    if (travelled > width * 0.6) {
      setConfirmedLabel(label);
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => { /* non-fatal */ });
      onComplete();
    }
  };

  const accent = variant === 'accent';
  const Arrow = rightward ? ChevronRight : ChevronLeft;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height, position: 'relative', overflow: 'hidden',
        borderRadius: tall ? '16px' : '12px',
        background: accent ? '#111' : '#F8F8F8',
        border: `1px solid ${accent ? '#111' : '#E0E0E0'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <span style={{
        color: accent ? '#FFF' : '#000',
        fontSize: tall ? '0.9rem' : '0.7rem',
        fontWeight: 600, letterSpacing: tall ? '1.5px' : '1px',
        textTransform: 'uppercase', zIndex: 1, pointerEvents: 'none',
        textAlign: 'center',
        paddingLeft: rightward ? knob + 12 : 16,
        paddingRight: rightward ? 16 : knob + 12
      }}>
        {done ? 'Confirmed' : label}
      </span>
      <motion.div
        drag={done ? false : 'x'}
        dragConstraints={containerRef}
        dragElastic={0.05}
        dragSnapToOrigin
        onDragEnd={handleDragEnd}
        style={{
          position: 'absolute', top: 4, bottom: 4, width: knob,
          ...(rightward ? { left: 4 } : { right: 4 }),
          background: accent ? '#FFF' : '#000',
          borderRadius: tall ? '12px' : '9px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'grab', zIndex: 2
        }}
        whileTap={{ cursor: 'grabbing' }}
      >
        {done
          ? <Check color={accent ? '#111' : '#D4CFC9'} size={tall ? 28 : 20} />
          : (icon || <Arrow color={accent ? '#111' : '#D4CFC9'} size={tall ? 30 : 22} />)}
      </motion.div>
    </div>
  );
}

/**
 * The journey controls: the required next step, plus the two escape hatches
 * that let the driver follow what the passenger actually does — go back a
 * step, or log an unplanned stop.
 */
export default function JourneyControls({ forward, back, stepOut, waitingSince, onAction }) {
  // Live wait clock while the passenger is out of the vehicle. Only the tick is
  // state; the label itself is derived, so there's nothing to keep in sync.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!waitingSince) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waitingSince]);

  const waitLabel = (() => {
    if (!waitingSince) return '';
    const secs = Math.max(0, Math.floor((now - new Date(waitingSince).getTime()) / 1000));
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  })();

  if (!forward && !back) return null;

  return (
    <div style={{
      marginTop: '16px', position: 'relative', padding: '20px', borderRadius: '20px',
      background: '#FFFFFF', border: '1px solid var(--color-gold, #D4CFC9)',
      boxShadow: '0 8px 24px rgba(212,207,201,0.2)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '16px' }}>
        <span style={{
          width: '10px', height: '10px', borderRadius: '50%',
          background: waitingSince ? '#C2410C' : '#8A7355',
          animation: 'elsPulse 1.8s ease-in-out infinite'
        }} />
        <span style={{ fontSize: '0.85rem', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: waitingSince ? '#C2410C' : '#8A7355' }}>
          {waitingSince ? `Waiting — ${waitLabel}` : 'Required next step'}
        </span>
      </div>

      {forward && (
        <SwipeAction
          label={forward.label}
          variant={forward.variant}
          onComplete={() => onAction(forward.key)}
        />
      )}

      {(back || stepOut) && (
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ textAlign: 'center', fontSize: '0.625rem', fontWeight: 600, letterSpacing: '1.5px', color: '#999', textTransform: 'uppercase' }}>
            Plans changed?
          </div>
          {stepOut && (
            <SwipeAction
              size="sm"
              label={stepOut.label}
              icon={<LogOut color="#D4CFC9" size={20} />}
              onComplete={() => onAction(stepOut.key)}
            />
          )}
          {back && (
            <SwipeAction
              size="sm"
              direction="left"
              label={back.label}
              icon={<Undo2 color="#D4CFC9" size={20} />}
              onComplete={() => onAction(back.key)}
            />
          )}
        </div>
      )}
    </div>
  );
}

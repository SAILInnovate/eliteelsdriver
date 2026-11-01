import React, { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronRight, ChevronLeft, Undo2, LogOut, Navigation, Clock, UserCheck, Pause } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

/**
 * A swipe that can be armed in either direction. Reversing a step and logging
 * an unplanned stop are both deliberate gestures rather than taps — a driver
 * shouldn't be able to rewrite a job's timeline with a stray thumb.
 */
function SwipeAction({ label, onComplete, direction = 'right', size = 'lg', variant = 'primary', icon }) {
  // Remembering *which* action was confirmed re-arms the control for free when
  // the next step arrives, with no reset effect. But this state only reset
  // correctly when the action's label changed — if the SAME label came back
  // (e.g. "Arrived at Pickup" after the driver undid an arrival), the stale
  // confirmed flag would lock the swipe and stop the driver going forward.
  // The `key={...}` on each use (the action's identity) remounts this component
  // whenever a step appears, clearing the confirmed flag so every occurrence is
  // swipeable again.
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

// One colour per stage, strong enough to read at arm's length in sunlight. The
// words and the icon say the same thing, so the colour is never the only cue.
const STAGE_TONES = {
  gold:   { bg: '#8A6D3B', Icon: Navigation },
  blue:   { bg: '#1D4ED8', Icon: Clock },
  green:  { bg: '#15803D', Icon: UserCheck },
  orange: { bg: '#C2410C', Icon: Pause }
};

const elapsed = (since, now) => {
  if (!since) return '';
  const secs = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}:${String(secs % 60).padStart(2, '0')}`;
};

/**
 * Where the job is, across the full width in its own colour, with a clock.
 * Drivers asked for this: after swiping Passenger On Board nothing on screen
 * changed enough to be sure it had taken, or that the time had started.
 */
export function StageBand({ stage }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!stage?.since) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stage?.since]);
  if (!stage) return null;
  const tone = STAGE_TONES[stage.tone] || STAGE_TONES.gold;
  return (
    <div role="status" style={{
      marginTop: '16px', padding: '16px 18px', borderRadius: '16px', background: tone.bg, color: '#FFF',
      display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 6px 18px rgba(0,0,0,0.15)'
    }}>
      <tone.Icon aria-hidden="true" size={28} color="#FFF" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', lineHeight: 1.2 }}>{stage.label}</div>
        {stage.next && <div style={{ fontSize: '0.85rem', fontWeight: 600, opacity: 0.9, marginTop: '4px' }}>{stage.next}</div>}
      </div>
      {stage.since && (
        <span style={{ fontSize: '1.25rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{elapsed(stage.since, now)}</span>
      )}
    </div>
  );
}

/**
 * The journey controls: the required next step, plus the two escape hatches
 * that let the driver follow what the passenger actually does — go back a
 * step, or log an unplanned stop.
 */
export default function JourneyControls({ forward, back, stepOut, choices = [], waitingSince, onAction, rearm = 0 }) {
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
          // `rearm` remounts the swipe when a step was held back (the car check
          // at Start Journey) and nothing else moved.
          key={`${forward.key}-${rearm}`}
          label={forward.label}
          variant={forward.variant}
          onComplete={() => onAction(forward.key)}
        />
      )}

      {/* At a stop: Clear is the swipe above; someone getting in, or the
          passenger getting out to come back, are the other two. Each is its
          own full swipe — what happened at a stop is never a stray tap. */}
      {choices.length > 0 && (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ textAlign: 'center', fontSize: '0.625rem', fontWeight: 600, letterSpacing: '1.5px', color: '#666', textTransform: 'uppercase' }}>
            Or, at this stop
          </div>
          {choices.map(c => (
            <SwipeAction key={c.key} label={c.label} onComplete={() => onAction(c.key)} />
          ))}
        </div>
      )}

      {(back || stepOut) && (
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ textAlign: 'center', fontSize: '0.625rem', fontWeight: 600, letterSpacing: '1.5px', color: '#666', textTransform: 'uppercase' }}>
            Plans changed?
          </div>
          {stepOut && (
            <SwipeAction
              key={stepOut.key}
              size="sm"
              label={stepOut.label}
              icon={<LogOut color="#D4CFC9" size={20} />}
              onComplete={() => onAction(stepOut.key)}
            />
          )}
          {back && (
            <SwipeAction
              key={back.key}
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

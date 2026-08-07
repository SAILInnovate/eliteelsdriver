import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { DoorOpen, Thermometer, Snowflake, Sun, Music, MessageSquare, VolumeX, Users, Briefcase } from 'lucide-react';

/**
 * The Cabin Brief — the guest's saved preferences, presented to the chauffeur
 * the way a butler is handed a card before the door opens.
 *
 * The only dark surface in the job sheet: black leather against the white
 * paper of the manifest, champagne hairlines, serif values. It reads as the
 * cabin the guest is about to step into, not as a settings list.
 *
 * Preferences arrive from two places and are merged by the caller:
 *   - rides.metadata.preferences  (booked with the journey, live-editable)
 *   - passenger_profiles.preferences (the guest's standing choices)
 */

const ASK = 'ask';

const DOOR = {
  always: { value: 'Open every time', hint: 'Pickup and drop-off' },
  pickup: { value: 'At pickup only', hint: 'Leave closed on arrival' },
  dropoff: { value: 'At drop-off only', hint: 'Leave closed at pickup' },
  never: { value: 'Never open', hint: 'The guest prefers their own door' },
  [ASK]: { value: 'Ask in vehicle', hint: 'Confirm discreetly on board' }
};

const TEMPERATURE = {
  cool: { value: 'Cool', hint: 'Set the cabin to 18°', Icon: Snowflake },
  neutral: { value: 'Neutral', hint: 'Set the cabin to 21°', Icon: Thermometer },
  warm: { value: 'Warm', hint: 'Set the cabin to 24°', Icon: Sun },
  [ASK]: { value: 'Ask in vehicle', hint: 'Confirm discreetly on board', Icon: Thermometer }
};

const MUSIC = {
  quiet: { value: 'Silence', hint: 'No audio unless asked' },
  bluetooth: { value: 'Guest device', hint: 'Offer the Bluetooth pairing' },
  classical: { value: 'Classical', hint: 'Low volume, front-faded' },
  contemporary: { value: 'Contemporary', hint: 'Low volume, front-faded' },
  chillout: { value: 'Chillout', hint: 'Low volume, front-faded' },
  business: { value: 'Business', hint: 'News and talk radio' },
  childrens: { value: "Children's", hint: 'Rear speakers, gentle volume' },
  [ASK]: { value: 'Ask in vehicle', hint: 'Confirm discreetly on board' }
};

const CONVERSATION = {
  quiet: { value: 'Quiet journey', hint: 'Greet, then let the cabin settle', Icon: VolumeX },
  chatty: { value: 'Happy to talk', hint: 'Conversation is welcome', Icon: MessageSquare },
  [ASK]: { value: 'Ask in vehicle', hint: 'Take the lead from the guest', Icon: MessageSquare }
};

const GOLD = '#D4CFC9';
const GOLD_DIM = 'rgba(212,207,201,0.14)';
const INK = '#0A0908';

function firstName(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  return clean.split(/\s+/)[0];
}

function Tile({ Icon, label, value, hint, needsAsking, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.08 + index * 0.06, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        position: 'relative',
        padding: '14px 13px',
        borderRadius: '14px',
        background: 'rgba(255,255,255,0.025)',
        border: `1px solid ${needsAsking ? 'rgba(212,207,201,0.34)' : GOLD_DIM}`,
        overflow: 'hidden'
      }}
    >
      <Icon size={15} color={GOLD} strokeWidth={1.4} style={{ display: 'block', marginBottom: '9px' }} />
      <div style={{ fontSize: '0.625rem', fontWeight: 600, letterSpacing: '1.4px', textTransform: 'uppercase', color: '#8B837A', marginBottom: '8px' }}>
        {label}
      </div>

      <div style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.1875rem', fontWeight: 500, color: '#F7F4F0', lineHeight: 1.15, letterSpacing: '0.2px' }}>
        {value}
      </div>

      {hint && (
        <div style={{ fontSize: '0.6875rem', color: '#7C756C', marginTop: '6px', lineHeight: 1.45 }}>
          {hint}
        </div>
      )}
    </motion.div>
  );
}

export default function GuestBrief({
  guestName,
  preferences,
  note,
  passengers,
  suitcases,
  updatedAt
}) {
  const prefs = preferences || {};

  const tiles = useMemo(() => {
    const door = DOOR[prefs.door] || DOOR.always;
    const temperature = TEMPERATURE[prefs.temperature] || TEMPERATURE.cool;
    const music = MUSIC[prefs.music] || MUSIC[ASK];
    const conversation = CONVERSATION[prefs.conversation] || CONVERSATION.quiet;

    return [
      { key: 'door', label: 'The Door', Icon: DoorOpen, ...door, needsAsking: prefs.door === ASK },
      { key: 'temperature', label: 'Climate', ...temperature, needsAsking: prefs.temperature === ASK },
      { key: 'music', label: 'Audio', Icon: Music, ...music, needsAsking: !prefs.music || prefs.music === ASK },
      { key: 'conversation', label: 'Conversation', ...conversation, needsAsking: prefs.conversation === ASK }
    ];
  }, [prefs.door, prefs.temperature, prefs.music, prefs.conversation]);

  // A change made by the guest in the last two minutes is worth flagging —
  // they may have adjusted the cabin while the chauffeur is already driving.
  const recentlyUpdated = useMemo(() => {
    if (!updatedAt) return false;
    const at = new Date(updatedAt).getTime();
    return Number.isFinite(at) && Date.now() - at < 2 * 60 * 1000;
  }, [updatedAt]);

  const name = firstName(guestName);
  const partyLine = [
    passengers > 0 ? `${passengers} ${passengers === 1 ? 'guest' : 'guests'}` : null,
    suitcases > 0 ? `${suitcases} ${suitcases === 1 ? 'case' : 'cases'}` : null
  ].filter(Boolean);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        position: 'relative',
        marginTop: '4px',
        padding: '20px 18px 18px',
        borderRadius: '20px',
        background: INK,
        border: '1px solid rgba(212,207,201,0.22)',
        overflow: 'hidden',
        willChange: 'transform'
      }}
    >
      {/* One slow sheen across the leather as the brief is handed over */}
      <motion.div
        initial={{ x: '-120%', opacity: 0 }}
        animate={{ x: '140%', opacity: [0, 0.5, 0] }}
        transition={{ duration: 1.6, delay: 0.25, ease: 'easeOut' }}
        style={{
          position: 'absolute', top: 0, bottom: 0, width: '55%',
          background: 'linear-gradient(100deg, transparent, rgba(212,207,201,0.10), transparent)',
          pointerEvents: 'none', zIndex: 1
        }}
      />

      <div style={{ position: 'relative', zIndex: 2 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
          <div style={{ fontSize: '0.625rem', fontWeight: 600, letterSpacing: '2.5px', textTransform: 'uppercase', color: GOLD }}>
            Cabin Brief
          </div>

          {recentlyUpdated && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 10px', borderRadius: '999px', border: '1px solid rgba(212,207,201,0.28)', flexShrink: 0 }}>
              <motion.span
                animate={{ opacity: [1, 0.25, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                style={{ width: '5px', height: '5px', borderRadius: '50%', background: GOLD, display: 'block' }}
              />
              <span style={{ fontSize: '0.5625rem', fontWeight: 600, letterSpacing: '1.6px', textTransform: 'uppercase', color: GOLD }}>
                Just changed
              </span>
            </div>
          )}
        </div>

        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.75rem', fontWeight: 400, color: '#FFFFFF', lineHeight: 1.15, letterSpacing: '0.2px' }}>
          {name ? `How ${name} travels` : 'How your guest travels'}
        </div>

        {/* Hairline */}
        <div style={{ height: '1px', margin: '18px 0', background: 'linear-gradient(90deg, transparent, rgba(212,207,201,0.35), transparent)' }} />

        {/* Preference tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          {tiles.map((tile, index) => (
            <Tile
              key={tile.key}
              Icon={tile.Icon}
              label={tile.label}
              value={tile.value}
              hint={tile.hint}
              needsAsking={tile.needsAsking}
              index={index}
            />
          ))}
        </div>

        {/* The guest's own words */}
        {note && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.34, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{ marginTop: '14px', padding: '16px 16px 16px 18px', borderRadius: '14px', background: 'rgba(212,207,201,0.05)', borderLeft: `2px solid ${GOLD}` }}
          >
            <div style={{ fontSize: '0.5625rem', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: '#8B837A', marginBottom: '8px' }}>
              A note from the guest
            </div>
            <div style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.0625rem', fontWeight: 400, color: '#F7F4F0', lineHeight: 1.5, fontStyle: 'italic' }}>
              “{note}”
            </div>
          </motion.div>
        )}

        {/* Party */}
        {partyLine.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginTop: '16px', paddingTop: '14px', borderTop: `1px solid ${GOLD_DIM}` }}>
            {passengers > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={14} color="#8B837A" strokeWidth={1.4} />
                <span style={{ fontSize: '0.75rem', color: '#B8B0A6', letterSpacing: '0.3px' }}>
                  {passengers} {passengers === 1 ? 'guest' : 'guests'}
                </span>
              </div>
            )}
            {suitcases > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Briefcase size={14} color="#8B837A" strokeWidth={1.4} />
                <span style={{ fontSize: '0.75rem', color: '#B8B0A6', letterSpacing: '0.3px' }}>
                  {suitcases} {suitcases === 1 ? 'case' : 'cases'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

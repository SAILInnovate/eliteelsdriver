import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Car, Droplets, Fuel, Building2, KeyRound, Coffee, PenLine, Repeat } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * What the chauffeur did on the shift that was not a job.
 *
 * The office asked for all of it on the record: swapping VK11 ELS for VL11 ELS
 * because one was going to the car wash, an hour at the wash, fuelling, taking
 * a player's car back to the training ground. Each is one tap, written to
 * `driver_shift_log` with the time and where the phone was.
 *
 * Change car also moves the shift itself onto the new car, so the crew board
 * and the next job's completion carry the right registration.
 */

export const CAR_CHANGE_REASONS = [
  { key: 'car_wash', label: 'Car wash' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'office_swap', label: 'Office swap' },
  { key: 'fault', label: 'Fault' },
  { key: 'other', label: 'Other' },
];

export const SHIFT_ACTIVITIES = [
  { key: 'car_wash', label: 'At car wash', Icon: Droplets },
  { key: 'fuel', label: 'Fuelling', Icon: Fuel },
  { key: 'office', label: 'Back at office', Icon: Building2 },
  { key: 'collecting_car', label: 'Collecting a car', Icon: KeyRound },
  { key: 'break', label: 'On a break', Icon: Coffee },
];

const reasonLabel = (key) => CAR_CHANGE_REASONS.find(r => r.key === key)?.label || key;
const activityLabel = (key) => SHIFT_ACTIVITIES.find(a => a.key === key)?.label || key;

/** One line of the log, as the driver and the office both read it. */
export function describeShiftLog(entry) {
  switch (entry.kind) {
    case 'car_change':
      return `Changed car${entry.previous_car_reg ? ` from ${entry.previous_car_reg}` : ''} to ${entry.car_reg}`
        + (entry.reason ? ` — ${reasonLabel(entry.reason)}` : '')
        + (entry.note ? `: ${entry.note}` : '');
    case 'activity':
      return activityLabel(entry.label) + (entry.note ? ` — ${entry.note}` : '');
    default:
      return entry.note || '';
  }
}

const clock = (ts) => new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });

const label = { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: '#555' };
const chip = (on) => ({
  padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem',
  background: on ? '#000' : 'transparent', color: on ? '#FFF' : '#333',
  border: on ? '1px solid #000' : '1px solid rgba(0,0,0,0.12)',
});
const input = { width: '100%', boxSizing: 'border-box', padding: '14px', background: '#FFF', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', color: '#000', fontSize: '0.9375rem', outline: 'none' };
const primary = (on) => ({ width: '100%', padding: '14px', background: on ? '#000' : 'rgba(0,0,0,0.15)', border: 'none', borderRadius: '8px', color: '#FFF', fontWeight: 600, fontSize: '0.6875rem', letterSpacing: '1px', textTransform: 'uppercase', cursor: on ? 'pointer' : 'not-allowed' });

export default function ShiftLog({ shiftId, driverId, carReg, coords, onCarChanged, haptic = () => {} }) {
  const [entries, setEntries] = useState([]);
  const [mode, setMode] = useState(null); // 'car' | 'note' | null
  const [newReg, setNewReg] = useState('');
  const [reason, setReason] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!shiftId) return;
    const { data } = await supabase.from('driver_shift_log')
      .select('*').eq('shift_id', shiftId).order('at', { ascending: false }).limit(50);
    if (data) setEntries(data);
  }, [shiftId]);

  useEffect(() => { load(); }, [load]);

  const write = async (row) => {
    if (!shiftId) { setError('Your shift has not saved yet — try again in a moment.'); return false; }
    setBusy(true);
    setError(null);
    const entry = {
      id: crypto.randomUUID(),
      shift_id: shiftId,
      driver_id: driverId,
      at: new Date().toISOString(),
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      ...row,
    };
    const { error: e } = await supabase.from('driver_shift_log').insert(entry);
    setBusy(false);
    // A duplicate id means an earlier attempt landed after all.
    if (e && e.code !== '23505') {
      setError('Could not save — check your signal and try again.');
      return false;
    }
    setEntries(prev => [entry, ...prev.filter(p => p.id !== entry.id)]);
    return true;
  };

  const changeCar = async () => {
    const reg = newReg.trim().toUpperCase();
    if (!reg || !reason) return;
    if (reg === (carReg || '').trim().toUpperCase()) { setError(`You are already in ${reg}.`); return; }
    setBusy(true);
    const { error: e } = await supabase.from('driver_shifts').update({ car_reg: reg }).eq('id', shiftId);
    setBusy(false);
    if (e) { setError('Could not change the car — check your signal and try again.'); return; }
    onCarChanged?.(reg);
    await write({ kind: 'car_change', car_reg: reg, previous_car_reg: carReg?.trim().toUpperCase() || null, reason, note: text.trim() || null });
    setMode(null); setNewReg(''); setReason(null); setText('');
  };

  const addNote = async () => {
    if (!text.trim()) return;
    if (await write({ kind: 'note', note: text.trim() })) { setMode(null); setText(''); }
  };

  return (
    <div style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* The car, and changing it */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Car size={18} color="#8A7355" />
        <div style={{ flex: 1 }}>
          <div style={label}>Your car</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '2px' }}>{carReg || '—'}</div>
        </div>
        <motion.button whileTap={{ scale: 0.96 }}
          onClick={() => { haptic(); setError(null); setMode(mode === 'car' ? null : 'car'); }}
          style={{ ...chip(mode === 'car'), display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Repeat size={14} /> Change car
        </motion.button>
      </div>

      <AnimatePresence>
        {mode === 'car' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' }}>
            <input value={newReg} placeholder="New registration, e.g. VL11 ELS"
              onChange={e => setNewReg(e.target.value.toUpperCase())}
              style={{ ...input, fontSize: '1.1rem', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase' }} />
            <div style={label}>Why?</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {CAR_CHANGE_REASONS.map(r => (
                <button key={r.key} onClick={() => { haptic(); setReason(r.key); }} style={chip(reason === r.key)}>{r.label}</button>
              ))}
            </div>
            <input value={text} placeholder="Anything to add (optional)" onChange={e => setText(e.target.value)} style={input} />
            <button disabled={busy || !newReg.trim() || !reason} onClick={() => { haptic(); changeCar(); }}
              style={primary(!busy && newReg.trim() && reason)}>
              {busy ? '…' : `Switch to ${newReg.trim() || 'new car'}`}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* What you are doing — one tap each */}
      <div style={label}>Log what you are doing</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {SHIFT_ACTIVITIES.map(({ key, label: l, Icon }) => (
          <motion.button key={key} whileTap={{ scale: 0.96 }} disabled={busy}
            onClick={() => { haptic(); write({ kind: 'activity', label: key }); }}
            style={{ ...chip(false), display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon size={14} /> {l}
          </motion.button>
        ))}
        <motion.button whileTap={{ scale: 0.96 }}
          onClick={() => { haptic(); setError(null); setText(''); setMode(mode === 'note' ? null : 'note'); }}
          style={{ ...chip(mode === 'note'), display: 'flex', alignItems: 'center', gap: '6px' }}>
          <PenLine size={14} /> Note
        </motion.button>
      </div>

      {mode === 'note' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <textarea value={text} rows={3} placeholder="e.g. Took the player's car back to Carrington"
            onChange={e => setText(e.target.value)} style={{ ...input, resize: 'none', fontFamily: 'inherit' }} />
          <button disabled={busy || !text.trim()} onClick={() => { haptic(); addNote(); }} style={primary(!busy && text.trim())}>
            {busy ? '…' : 'Add to shift log'}
          </button>
        </div>
      )}

      {error && <div style={{ fontSize: '0.75rem', color: '#B91C1C' }}>{error}</div>}

      {entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '10px' }}>
          {entries.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: '10px', fontSize: '0.75rem', lineHeight: 1.4 }}>
              <span style={{ color: '#8A7355', fontWeight: 600, minWidth: '38px' }}>{clock(e.at)}</span>
              <span style={{ color: '#333' }}>{describeShiftLog(e)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

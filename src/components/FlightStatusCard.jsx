import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plane } from 'lucide-react';
import { supabase } from '../lib/supabase';

const STATUS_META = {
  scheduled: { label: 'Scheduled', color: '#8A7355' },
  active: { label: 'In the Air', color: '#4CAF50' },
  landed: { label: 'Landed', color: '#4CAF50' },
  cancelled: { label: 'Cancelled', color: '#EF4444' },
  incident: { label: 'Incident', color: '#EF4444' },
  diverted: { label: 'Diverted', color: '#EF4444' },
};

// AviationStack timestamps are local airport time with a spurious +00:00
// offset, so we read HH:mm straight off the string instead of new Date()
const localTime = (iso) => (iso && iso.length >= 16 ? iso.slice(11, 16) : null);

// Route progress is driven by status, not clock math — dep/arr timestamps
// are in different (mislabelled) timezones so elapsed-time maths would lie
const PROGRESS = { scheduled: 0.06, active: 0.55, landed: 1, cancelled: 0, incident: 0.55, diverted: 0.55 };

export default function FlightStatusCard({ flightNumber, pickupTime, accent = '#8A7355', border = '#E8E4DE' }) {
  const [flight, setFlight] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!flightNumber) return;
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('flight-tracker', {
          body: { flight_number: flightNumber, pickup_time: pickupTime || null }
        });
        if (cancelled) return;
        if (!error && data?.status === 'success') { setFlight(data); setFailed(false); }
        else setFailed(true);
      } catch (e) {
        if (!cancelled) setFailed(true);
      }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [flightNumber, pickupTime]);

  if (!flightNumber) return null;

  const meta = STATUS_META[flight?.flight_status] || { label: 'Tracking', color: '#9A938A' };
  const progress = PROGRESS[flight?.flight_status] ?? 0.06;
  const delay = Number(flight?.arrival?.delay) || 0;
  const arrTime = localTime(flight?.arrival?.estimated) || localTime(flight?.arrival?.scheduled);
  const depTime = localTime(flight?.departure?.actual) || localTime(flight?.departure?.estimated) || localTime(flight?.departure?.scheduled);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      style={{ background: '#FFF', border: `1px solid ${border}`, borderRadius: '14px', padding: '18px', overflow: 'hidden' }}>

      {/* Header — flight code, airline, live status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: flight ? '18px' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <Plane size={14} color={accent} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: accent, whiteSpace: 'nowrap' }}>
            Flight {String(flightNumber).toUpperCase()}
          </span>
          {flight?.airline?.name && (
            <span style={{ fontSize: '0.625rem', color: '#9A938A', letterSpacing: '0.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {flight.airline.name}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: meta.color, animation: flight?.flight_status === 'active' ? 'elsPulse 2s ease-in-out infinite' : 'none' }} />
          <span style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: meta.color }}>
            {failed && !flight ? 'Unavailable' : meta.label}
          </span>
        </div>
      </div>

      {flight && (
        <>
          {/* Route visual — IATA codes joined by a progress line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.625rem', fontWeight: 500, color: '#000', lineHeight: 1 }}>
                {flight.departure?.iata || '—'}
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#9A938A', marginTop: '5px', letterSpacing: '0.3px' }}>{depTime || '—'}</div>
            </div>

            <div style={{ flex: 1, position: 'relative', height: '16px', display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, height: '1px', background: border }} />
              <div style={{ position: 'absolute', left: 0, width: `${progress * 100}%`, height: '1px', background: accent, transition: 'width 0.6s ease' }} />
              <div style={{ position: 'absolute', left: `${progress * 100}%`, transform: 'translateX(-50%)', background: '#FFF', padding: '0 3px', display: 'flex' }}>
                <Plane size={13} color={progress > 0 ? accent : '#C9C2B8'} style={{ transform: 'rotate(45deg)' }} />
              </div>
            </div>

            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.625rem', fontWeight: 500, color: '#000', lineHeight: 1 }}>
                {flight.arrival?.iata || '—'}
              </div>
              <div style={{ fontSize: '0.6875rem', color: delay > 0 ? '#EF4444' : '#9A938A', marginTop: '5px', letterSpacing: '0.3px', fontWeight: delay > 0 ? 600 : 400 }}>
                {arrTime || '—'}{delay > 0 ? ` · +${delay} min` : ''}
              </div>
            </div>
          </div>

          {/* Arrival details the chauffeur actually needs */}
          <div style={{ display: 'flex', gap: '20px', marginTop: '16px', paddingTop: '14px', borderTop: `1px solid ${border}` }}>
            <div>
              <div style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#9A938A', marginBottom: '3px' }}>Arrives</div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#000' }}>{flight.arrival?.airport || '—'}</div>
            </div>
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#9A938A', marginBottom: '3px' }}>Terminal</div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#000' }}>{flight.arrival?.terminal || 'TBA'}</div>
            </div>
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#9A938A', marginBottom: '3px' }}>Gate</div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#000' }}>{flight.arrival?.gate || 'TBA'}</div>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}

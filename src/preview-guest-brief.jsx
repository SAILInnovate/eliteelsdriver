// Throwaway harness: renders the real GuestBrief inside a mock job sheet so the
// card can be reviewed without a dispatched job. Delete once signed off.
import React from 'react';
import { MotionConfig } from 'framer-motion';
import { createRoot } from 'react-dom/client';
import './index.css';
import GuestBrief from './components/GuestBrief';

function Sheet({ title, children }) {
  return (
    <div style={{ background: '#FFFFFF', borderRadius: '24px', padding: '20px 24px 28px', marginBottom: '28px', border: '1px solid rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: '0.6875rem', fontWeight: 500, letterSpacing: '2px', color: '#666', textTransform: 'uppercase', marginBottom: '18px' }}>{title}</div>
      {children}
    </div>
  );
}

function App() {
  const variant = new URLSearchParams(window.location.search).get('v');
  return (
    // Screenshots are taken with the tab backgrounded, which freezes rAF and
    // therefore framer's entrance animations. Instant transitions show the
    // settled state.
    <MotionConfig transition={{ duration: 0 }}>
    <div style={{ fontFamily: 'var(--font-family)', background: '#E9E7E3', minHeight: '100vh', padding: '24px 16px 60px' }}>
      <div style={{ maxWidth: '430px', margin: '0 auto' }}>
        {variant !== '2' && (
        <Sheet title="Journey in progress">
          <GuestBrief
            guestName="Marcus Adeyemi"
            preferences={{ door: 'always', temperature: 'cool', music: 'classical', conversation: 'quiet' }}
            note="Gate code 4471 at the rear entrance. Two matchday bags in the boot, please."
            passengers={2}
            suitcases={3}
            updatedAt={new Date().toISOString()}
          />
        </Sheet>
        )}

        {variant === '2' && (
        <Sheet title="Job assigned — nothing saved yet">
          <GuestBrief
            guestName="Eleanor Whitcombe"
            preferences={{ door: 'pickup', temperature: 'ask', music: 'ask', conversation: 'ask' }}
            passengers={1}
            suitcases={0}
          />
        </Sheet>
        )}
      </div>
    </div>
    </MotionConfig>
  );
}

createRoot(document.getElementById('preview-root')).render(<App />);

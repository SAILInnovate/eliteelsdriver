import { Component, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import translations from '../i18n/translations';

// Lightweight translation outside React context — reads localStorage
function getT() {
  const lang = localStorage.getItem('els_lang') || 'en';
  return (key) => translations[lang]?.[key] || translations.en?.[key] || key;
}
// ERROR BOUNDARY — Prevents white screen crashes
// =============================================
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Elite ELS crash caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const t = getT();
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#FFF',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 40px', fontFamily: "var(--font-family)"
        }}>
          <img src="/elitels.png" alt="Elite" style={{ height: '48px', marginBottom: '40px', opacity: 0.4 }} />
          
          <div style={{
            fontSize: '0.625rem', letterSpacing: '3px', color: '#EBEBEB',
            marginBottom: '16px', fontWeight: 600
          }}>
            {t('somethingWrong')}
          </div>
          
          <p style={{
            fontSize: '0.875rem', color: '#555', textAlign: 'center',
            lineHeight: 1.6, marginBottom: '40px', maxWidth: '280px'
          }}>
            {t('errorMsg')}
          </p>

          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              padding: '14px 40px', background: '#000', color: '#FFF',
              fontSize: '0.625rem', fontWeight: 600, letterSpacing: '3px',
              border: 'none', cursor: 'pointer',
              fontFamily: "var(--font-family)"
            }}
          >
            {t('restart')}
          </button>

          <div style={{
            position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
            fontSize: '0.5625rem', color: '#F5F5F5', letterSpacing: '2px'
          }}>
            ELITE ELS
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// =============================================
// OFFLINE SCREEN — Shows when network drops
// =============================================
export function OfflineScreen() {
  const t = getT();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        position: 'fixed', inset: 0, background: '#FFF',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '0 40px', zIndex: 10000,
        fontFamily: "var(--font-family)"
      }}
    >
      {/* Pulsing connection indicator */}
      <div style={{ position: 'relative', width: '48px', height: '48px', marginBottom: '32px' }}>
        <motion.div
          animate={{ scale: [1, 2, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '1px solid #EBEBEB'
          }}
        />
        <motion.div
          animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
          style={{
            position: 'absolute', inset: '8px', borderRadius: '50%',
            border: '1px solid #EBEBEB'
          }}
        />
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '8px', height: '8px', borderRadius: '50%',
          background: '#EBEBEB'
        }} />
      </div>

      <div style={{
        fontSize: '0.625rem', letterSpacing: '3px', color: '#444',
        marginBottom: '12px', fontWeight: 600
      }}>
        {t('offline')}
      </div>
      
      <p style={{
        fontSize: '0.8125rem', color: '#555', textAlign: 'center',
        lineHeight: 1.6, maxWidth: '260px', marginBottom: '40px'
      }}>
        {t('offlineMsg')}
      </p>

      {/* Subtle scanning line */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: '2px', overflow: 'hidden'
      }}>
        <motion.div
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          style={{
            width: '30%', height: '100%',
            background: 'linear-gradient(90deg, transparent, #F5F5F5, transparent)'
          }}
        />
      </div>

      <div style={{
        position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        fontSize: '0.5625rem', color: '#FFFFFF', letterSpacing: '2px'
      }}>
        ELITE ELS
      </div>
    </motion.div>
  );
}

// =============================================
// HOOK — Online/offline detection
// =============================================
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

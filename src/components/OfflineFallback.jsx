import { useState, useEffect } from 'react';

export default function OfflineFallback({ onRetry }) {
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

    const handleRetry = () => {
        if (navigator.onLine) {
            setIsOnline(true);
            if (onRetry) onRetry();
            window.location.reload();
        } else {
            // Optional: Show a subtle shake or toast here if still offline
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100dvh',
            padding: '24px',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            textAlign: 'center',
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999
        }}>
            <div style={{ fontSize: '64px', marginBottom: '24px', opacity: 0.8 }}>
                📡
            </div>

            <h1 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '12px', color: 'var(--color-teal)' }}>
                Connection Lost
            </h1>

            <p style={{ fontSize: '15px', color: 'var(--color-text-secondary)', marginBottom: '32px', maxWidth: '300px', lineHeight: '1.5' }}>
                Clinch needs an active internet connection to securely verify your digital handshakes.
            </p>

            <button
                className="btn-primary"
                onClick={handleRetry}
                style={{ width: '100%', maxWidth: '280px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
            >
                {isOnline ? 'Resume Connection' : 'Try Reconnecting'}
            </button>

            <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '24px', opacity: 0.6 }}>
                Your pending agreements are safe.
            </p>
        </div>
    );
}

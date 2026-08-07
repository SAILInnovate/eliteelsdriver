import { useState } from 'react';

export default function SentConfirmation({ phone, shareUrl, onNewClinch }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleShare = async () => {
        if (navigator.share) {
            await navigator.share({
                title: 'Clinch Handshake',
                text: `I've sent you a Digital Handshake via Clinch: ${shareUrl}`,
                url: shareUrl,
            });
        }
    };

    return (
        <div className="sent-confirmation" id="sent-confirmation">
            <div className="sent-confirmation__icon">🚀</div>
            <h2 className="sent-confirmation__title">Link Ready!</h2>
            <p className="sent-confirmation__subtitle">
                Your Clinch is live. If the share sheet didn't open, use the buttons below.
            </p>

            <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button className="btn-primary" onClick={handleShare}>
                    📱 Share via SMS/WhatsApp
                </button>

                <button className="btn-secondary" onClick={handleCopy}>
                    {copied ? '✅ Link Copied!' : '🔗 Copy Agreement Link'}
                </button>

                <div style={{ height: '1px', background: '#E0E0E0', margin: '12px 0' }} />

                <button
                    className="btn-text"
                    onClick={onNewClinch}
                    id="btn-new-clinch"
                >
                    🤝 Create Another Promise
                </button>
            </div>
        </div>
    );
}

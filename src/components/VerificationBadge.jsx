import { useRef } from 'react';
import html2canvas from 'html2canvas';
import { isNativePlatform } from '../lib/capacitor';

export default function VerificationBadge({ count = 5, user }) {
    const badgeRef = useRef(null);

    const downloadBadge = async () => {
        if (!badgeRef.current) return;
        const canvas = await html2canvas(badgeRef.current, {
            backgroundColor: null,
            scale: 2,
        });
        const dataUrl = canvas.toDataURL('image/png');

        if (isNativePlatform()) {
            try {
                const { Filesystem, Directory } = await import('@capacitor/filesystem');
                const { Share } = await import('@capacitor/share');

                const base64Data = dataUrl.split(',')[1];
                const fileName = `clinch-verified-${count}-${Date.now()}.png`;

                const result = await Filesystem.writeFile({
                    path: fileName,
                    data: base64Data,
                    directory: Directory.Cache
                });

                await Share.share({
                    title: 'Clinch Verified Badge',
                    files: [result.uri]
                });
            } catch (err) {
                console.error('Share to phone failed:', err);
                alert('Could not save image to phone. ' + err.message);
            }
        } else {
            const link = document.createElement('a');
            link.download = `clinch-verified-${count}.png`;
            link.href = dataUrl;
            link.click();
        }
    };

    const userName = user?.user_metadata?.full_name?.toUpperCase() || 'MEMBER';

    return (
        <div style={{ padding: '24px', textAlign: 'center' }}>
            <div
                ref={badgeRef}
                style={{
                    width: '320px',
                    height: '420px',
                    background: 'linear-gradient(135deg, #013A3A 0%, #001A1A 100%)',
                    borderRadius: '24px',
                    padding: '32px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontFamily: 'var(--font-family)',
                    boxShadow: '0 10px 30px rgba(0, 128, 128, 0.4)',
                    position: 'relative',
                    overflow: 'hidden',
                    margin: '0 auto',
                    border: '1px solid rgba(0,0,0, 0.1)'
                }}
            >
                {/* Diagonal Watermark */}
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%) rotate(-35deg)',
                    fontSize: '64px',
                    fontWeight: '900',
                    color: 'rgba(0,0,0, 0.04)',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    letterSpacing: '4px',
                    lineHeight: 1
                }}>
                    <div>{userName}</div>
                    <div>{userName}</div>
                    <div>{userName}</div>
                </div>

                {/* Geometric Handshake Image */}
                <div style={{
                    width: '80px',
                    height: '80px',
                    marginBottom: '20px',
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <img
                        src="/assets/geometric-handshake.png"
                        alt="Clinch Handshake"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                </div>

                <h2 style={{
                    margin: '0 0 4px 0',
                    fontSize: '32px',
                    fontWeight: '900',
                    letterSpacing: '-1px',
                    textTransform: 'uppercase',
                    color: '#000',
                    zIndex: 1
                }}>
                    Clinch<span style={{ color: '#98FF98' }}>.</span>
                </h2>

                <p style={{
                    margin: '0 0 16px 0',
                    fontSize: '16px',
                    fontWeight: '800',
                    color: '#98FF98',
                    letterSpacing: '3px',
                    zIndex: 1
                }}>
                    VERIFIED
                </p>

                <div style={{
                    marginTop: '8px',
                    paddingTop: '20px',
                    borderTop: '1px solid rgba(0,0,0,0.15)',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    zIndex: 1
                }}>
                    <div style={{
                        fontSize: '22px',
                        fontWeight: '800',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: '#FFE066'
                    }}>
                        {Array(5).fill('★').join('')}
                    </div>

                    <div style={{
                        marginTop: '8px',
                        fontSize: '14px',
                        opacity: 0.9,
                        fontWeight: '700',
                        letterSpacing: '0.5px'
                    }}>
                        FULL HANDSHAKE SCORE
                    </div>

                    <div style={{
                        marginTop: '20px',
                        display: 'inline-block',
                        background: 'rgba(0,0,0,0.1)',
                        padding: '6px 16px',
                        borderRadius: '100px',
                        fontSize: '13px',
                        fontWeight: '800',
                        letterSpacing: '1px'
                    }}>
                        ISSUED TO: {userName}
                    </div>
                </div>

                <div style={{
                    position: 'absolute',
                    bottom: '16px',
                    fontSize: '11px',
                    fontWeight: '600',
                    opacity: 0.4,
                    letterSpacing: '3px',
                    zIndex: 1
                }}>
                    CLINCH.TO
                </div>
            </div>

            <button
                onClick={downloadBadge}
                className="btn-primary"
                style={{ marginTop: '32px', maxWidth: '240px', margin: '32px auto 0' }}
            >
                📥 Save to Device
            </button>

            <p style={{ marginTop: '16px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                Post this on your profile or socials to prove you're reliable.
            </p>
        </div>
    );
}

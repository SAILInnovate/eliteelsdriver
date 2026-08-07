import { useNavigate } from 'react-router-dom';

export default function PrivacyPage() {
    const navigate = useNavigate();

    return (
        <div className="app-wrapper">
            <div className="nav-bar" style={{ justifyContent: 'flex-start', padding: '0 20px', gap: '16px' }}>
                <button
                    onClick={() => navigate(-1)}
                    style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#FFFFFF' }}
                >
                    ←
                </button>
                <div style={{ fontWeight: 'bold', fontSize: '18px' }}>Privacy Policy</div>
            </div>

            <div className="scroll-content">
                <div className="app-content" style={{ padding: '24px', lineHeight: '1.6', color: '#EBEBEB' }}>
                    <h1 style={{ color: '#008080', marginBottom: '16px' }}>Privacy Policy</h1>
                    <p>Last updated: March 1, 2026</p>

                    <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#FFFFFF' }}>1. What Information We Collect</h3>
                    <p style={{ color: '#666' }}>We collect your phone number during SMS authentication. When you choose to sync your contacts, we only index phone numbers locally and map them cryptographically to nodes in your Trust Graph. We do not harvest or store full names or contact databases on our primary servers.</p>

                    <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#FFFFFF' }}>2. How We Use Information</h3>
                    <p style={{ color: '#666' }}>Your phone number is strictly used for one-time passwords, SMS alerts, and verifying your identity as a real-world participant on your agreements. Your name is only kept minimally to display on the digital handshakes you initiate.</p>

                    <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#FFFFFF' }}>3. IP and Device Logging</h3>
                    <p style={{ color: '#666' }}>Upon the moment an agreement is successfully "Clinched" by both parties, we securely log the consenting timestamp, your authenticated session ID, and your current IP address. This data is physically appended to the digital handshake as legally irrefutable evidence for your protection.</p>

                    <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#FFFFFF' }}>4. Data Security</h3>
                    <p style={{ color: '#666' }}>All database entries are protected by strict Row Level Security (RLS) via Supabase PostgreSQL architecture. We only transmit data via encrypted TLS/SSL web connections, ensuring physical tampering of agreed terms is structurally impossible.</p>

                    <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#FFFFFF' }}>5. Third Party Analytics</h3>
                    <p style={{ color: '#666' }}>We do not sell our database logs to ad-networks. We process our payments strictly through PCI-compliant Stripe API gateways and our messaging strictly through Twilio.</p>
                </div>
            </div>
        </div>
    );
}

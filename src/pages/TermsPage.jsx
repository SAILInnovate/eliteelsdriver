import { useNavigate } from 'react-router-dom';

export default function TermsPage() {
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
                <div style={{ fontWeight: 'bold', fontSize: '18px' }}>Terms of Service</div>
            </div>

            <div className="scroll-content">
                <div className="app-content" style={{ padding: '24px', lineHeight: '1.6', color: '#EBEBEB' }}>
                    <h1 style={{ color: '#008080', marginBottom: '16px' }}>Terms of Service</h1>
                    <p>Last updated: March 1, 2026</p>

                    <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#FFFFFF' }}>1. Acceptance of Terms</h3>
                    <p style={{ color: '#666' }}>By accessing and using Clinch, you agree to be bound by these Terms of Service over the usage of the application. If you do not agree to these terms, please do not use our service.</p>

                    <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#FFFFFF' }}>2. Description of Service</h3>
                    <p style={{ color: '#666' }}>Clinch provides a platform for generating, sending, and digitally verifying micro-agreements. We do not provide legal counsel, and our software is strictly a digital logging and verification utility, not a law firm.</p>

                    <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#FFFFFF' }}>3. User Conduct</h3>
                    <p style={{ color: '#666' }}>You agree to use Clinch only for lawful purposes. You are strictly forbidden from using the service to facilitate fraud, harass individuals, or engage in non-consensual malicious agreements.</p>

                    <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#FFFFFF' }}>4. Trust Graph & Identity</h3>
                    <p style={{ color: '#666' }}>By using Clinch, your completed agreements will contribute to your Trust Graph score and public profile reputation index. Other platform users may interact with or see your verified node metrics if they have completed an agreement with you.</p>

                    <h3 style={{ marginTop: '24px', marginBottom: '8px', color: '#FFFFFF' }}>5. Limitation of Liability</h3>
                    <p style={{ color: '#666' }}>Clinch is provided "as is". We are not responsible for any real-world disputes, financial loss, or physical damages arising from agreements made on our platform. The enforcement of any Clinch handshake is the sole responsibility of the agreeing parties.</p>
                </div>
            </div>
        </div>
    );
}

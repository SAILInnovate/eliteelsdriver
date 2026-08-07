import NavBar from '../components/NavBar';
import { useState } from 'react';
import MenuDrawer from '../components/MenuDrawer';
import BottomNav from '../components/BottomNav';
import { useNavigate } from 'react-router-dom';

export default function HelpPage() {
    const [menuOpen, setMenuOpen] = useState(false);
    const navigate = useNavigate();

    return (
        <div className="app-wrapper">
            <NavBar onMenuClick={() => setMenuOpen(true)} />

            <div className="scroll-content">
                <div className="app-content" style={{ padding: '24px' }}>
                    <h1 style={{ color: '#008080', marginBottom: '8px' }}>Help & Support</h1>
                    <p style={{ color: '#666', marginBottom: '24px' }}>We're here to help you clinch your deals.</p>

                    <div style={{ background: 'var(--color-white)', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', marginBottom: '16px' }}>
                        <h3 style={{ marginBottom: '12px', fontSize: '18px' }}>Frequently Asked Questions</h3>
                        <details style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #eee' }}>
                            <summary style={{ fontWeight: 600, cursor: 'pointer', outline: 'none' }}>Are digital handshakes secure and enforceable?</summary>
                            <p style={{ marginTop: '8px', color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
                                Yes! Our secure audit trail captures IP addresses, server-side timestamps, and verified phone numbers, making Clinch agreements robust, secure, and easily verifiable.
                            </p>
                        </details>
                        <details style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #eee' }}>
                            <summary style={{ fontWeight: 600, cursor: 'pointer', outline: 'none' }}>Is SMS messaging free?</summary>
                            <p style={{ marginTop: '8px', color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
                                Receiving OTPs to verify your identity is 100% free for users. We handle the carrier costs so your agreements remain instantly verifiable anywhere in the world.
                            </p>
                        </details>
                        <details style={{ marginBottom: '12px' }}>
                            <summary style={{ fontWeight: 600, cursor: 'pointer', outline: 'none' }}>Can I edit an agreement after it's clicked?</summary>
                            <p style={{ marginTop: '8px', color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
                                Once a digital handshake is sealed, it cannot be edited to maintain the integrity of the audit trail. If you need to make changes, simply send a new clinch link!
                            </p>
                        </details>
                    </div>

                    <div style={{ background: 'var(--color-white)', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                        <h3 style={{ marginBottom: '12px', fontSize: '18px' }}>Contact Support</h3>
                        <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                            Experiencing an issue? Reach out to our direct support team.
                        </p>
                        <a href="mailto:support@clinch.to" className="btn-primary" style={{ textDecoration: 'none' }}>
                            Email support@clinch.to
                        </a>
                    </div>
                </div>
            </div>

            <BottomNav currentTab={null} onChangeTab={(tab) => navigate(`/?tab=${tab}`)} />

            {menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} />}
        </div>
    );
}

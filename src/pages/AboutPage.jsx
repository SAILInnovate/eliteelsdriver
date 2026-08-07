import NavBar from '../components/NavBar';
import { useState } from 'react';
import MenuDrawer from '../components/MenuDrawer';
import BottomNav from '../components/BottomNav';
import { useNavigate } from 'react-router-dom';

export default function AboutPage() {
    const [menuOpen, setMenuOpen] = useState(false);
    const navigate = useNavigate();

    return (
        <div className="app-wrapper">
            <NavBar onMenuClick={() => setMenuOpen(true)} />

            <div className="scroll-content">
                <div className="app-content" style={{ padding: '24px', textAlign: 'center' }}>
                    <img src="/assets/clinch-logo.png" alt="Clinch" style={{ width: '120px', marginBottom: '16px' }} />

                    <h1 style={{ color: '#008080', marginBottom: '24px' }}>About Clinch</h1>

                    <div style={{ background: 'var(--color-white)', padding: '24px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', textAlign: 'left', marginBottom: '24px' }}>
                        <p style={{ fontSize: '15px', color: 'var(--color-text)', lineHeight: '1.6', marginBottom: '16px' }}>
                            Clinch was designed to solve one simple problem: how to make quick, informal agreements secure and verifiable without the bloat of traditional corporate platforms.
                        </p>
                        <p style={{ fontSize: '15px', color: 'var(--color-text)', lineHeight: '1.6', marginBottom: '16px' }}>
                            By leveraging SMS OTPs, server-side tamper-evidence recording, and a frictionless swipe-to-agree protocol, we are digitizing the handshake for the modern era.
                        </p>
                        <p style={{ fontSize: '15px', color: 'var(--color-text)', lineHeight: '1.6' }}>
                            When you see a Clinch link, you know it's a promise kept.
                        </p>
                    </div>

                    <div style={{ color: '#888', fontSize: '12px' }}>
                        Version 1.0.0
                        <br />
                        © {new Date().getFullYear()} Clinch
                    </div>
                </div>
            </div>

            <BottomNav currentTab={null} onChangeTab={(tab) => navigate(`/?tab=${tab}`)} />

            {menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} />}
        </div>
    );
}

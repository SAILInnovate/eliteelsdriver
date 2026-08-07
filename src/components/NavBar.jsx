import { useAuth } from '../context/AuthContext';
import { triggerHaptic } from '../lib/capacitor';
import { useNavigate } from 'react-router-dom';

export default function NavBar({ onMenuClick }) {
    const { user } = useAuth();
    const navigate = useNavigate();

    const initials = user?.user_metadata?.full_name
        ? user.user_metadata.full_name.split(' ').map(n => n[0]).join('').toUpperCase()
        : user?.email?.[0]?.toUpperCase() || 'U';

    return (
        <nav className="nav-bar" id="nav-bar">
            {/* Profile avatar on the left */}
            <div
                className="nav-bar__profile"
                onClick={() => {
                    triggerHaptic('light');
                    navigate('/settings');
                }}
                style={{ cursor: 'pointer' }}
            >
                <div className="nav-bar__avatar" id="nav-avatar">
                    {initials}
                </div>
            </div>

            {/* Centered logo */}
            <img
                src="/assets/clinch-logo.png"
                alt="Clinch"
                className="nav-bar__logo"
                id="nav-logo"
            />

            {/* Hamburger menu on the right */}
            <button
                className="nav-bar__menu-btn"
                onClick={() => {
                    triggerHaptic('light');
                    onMenuClick();
                }}
                aria-label="Open menu"
                id="nav-menu-btn"
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
            </button>
        </nav>
    );
}

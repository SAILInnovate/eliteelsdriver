import { motion, AnimatePresence } from 'framer-motion';
import { triggerSelectionHaptic } from '../lib/capacitor';

// Custom, ultra-premium purely geometric SVGs built exclusively for Clinch.
// No rounded cute caps (Lucide), only sharp professional architecture lines.

const RideIcon = ({ active }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "1.8"} strokeLinecap="square" strokeLinejoin="miter" style={{ transform: active ? 'scale(1.1)' : 'scale(1)', transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        <path d="M3 11L5 5H19L21 11" />
        <rect x="2" y="11" width="20" height="8" />
        <rect x="5" y="19" width="3" height="3" />
        <rect x="16" y="19" width="3" height="3" />
        {active && <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} d="M7 15h10" stroke="currentColor" strokeWidth="2.5" />}
    </svg>
);

const HomeIcon = ({ active }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "1.8"} strokeLinecap="square" strokeLinejoin="miter" style={{ transform: active ? 'scale(1.1)' : 'scale(1)', transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        <path d="M14 2H6V22H18V6L14 2Z" />
        <path d="M14 2V6H18" />
        <path d="M9 13H15" />
        <path d="M9 17H12" />
        {active && <motion.path initial={{ scale: 0 }} animate={{ scale: 1 }} d="M9 9H10" />}
    </svg>
);

const VaultIcon = ({ active }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "1.8"} strokeLinecap="square" strokeLinejoin="miter" style={{ transform: active ? 'scale(1.1)' : 'scale(1)', transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        <rect x="3" y="10" width="18" height="12" />
        <path d="M7 10V6A5 5 0 0117 6V10" />
        <circle cx="12" cy="16" r="2" />
        {active && <motion.path initial={{ y: -5, opacity: 0 }} animate={{ y: 0, opacity: 1 }} d="M12 18v3" />}
    </svg>
);

const TabsIcon = ({ active }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "1.8"} strokeLinecap="square" strokeLinejoin="miter" style={{ transform: active ? 'scale(1.1) rotate(90deg)' : 'scale(1) rotate(0deg)', transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        <path d="M21 12A9 9 0 003.5 9" />
        <path d="M3 4v5h5" />
        <path d="M3 12A9 9 0 0020.5 15" />
        <path d="M21 20v-5h-5" />
        {active && <motion.circle initial={{ scale: 0 }} animate={{ scale: 1 }} cx="12" cy="12" r="2" fill="currentColor" />}
    </svg>
);

const NetworkIcon = ({ active }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "1.8"} strokeLinecap="square" strokeLinejoin="miter" style={{ transform: active ? 'scale(1.1)' : 'scale(1)', transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        <path d="M12 2L22 7.5V16.5L12 22L2 16.5V7.5L12 2Z" />
        <path d="M12 2V12L2 7.5" />
        <path d="M22 7.5L12 12V22" />
        {active && <motion.circle initial={{ scale: 0 }} animate={{ scale: 1 }} cx="12" cy="12" r="2" fill="currentColor" />}
    </svg>
);

export default function BottomNav({ currentTab, onChangeTab }) {
    const tabs = [
        { id: 'ride', label: 'Ride', Icon: RideIcon },
        { id: 'home', label: 'Home', Icon: HomeIcon },
        { id: 'vault', label: 'Vault', Icon: VaultIcon },
        { id: 'tabs', label: 'Tabs', Icon: TabsIcon },
        { id: 'network', label: 'Network', Icon: NetworkIcon }
    ];

    return (
        <div className="bottom-nav">
            {tabs.map((tab) => {
                const isActive = currentTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        className={`bottom-nav__item ${isActive ? 'active' : ''}`}
                        onClick={() => {
                            if (!isActive) triggerSelectionHaptic();
                            onChangeTab(tab.id);
                        }}
                    >
                        <div className="bottom-nav__icon" style={{
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isActive ? 'var(--color-teal)' : '#A3A3A3',
                            transition: 'color 0.2s ease',
                            marginBottom: '5px'
                        }}>
                            <tab.Icon active={isActive} />
                        </div>
                        <div className="bottom-nav__label" style={{
                            fontSize: '11px',
                            fontWeight: isActive ? '800' : '600',
                            letterSpacing: '-0.01em',
                            color: isActive ? 'var(--color-teal)' : '#A3A3A3',
                            transition: 'color 0.2s ease, font-weight 0.2s ease'
                        }}>
                            {tab.label}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

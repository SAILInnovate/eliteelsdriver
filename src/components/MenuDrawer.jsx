import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FolderOpen, Settings, MessageCircle, Info, LogOut, X } from 'lucide-react';
import { triggerHaptic } from '../lib/capacitor';

export default function MenuDrawer({ onClose }) {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();

    const displayName = user?.user_metadata?.full_name || user?.email || 'User';
    const email = user?.email || '';
    const initials = displayName
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    const handleSignOut = async () => {
        await signOut();
        onClose();
    };

    const GOLD = '#D4CFC9';

    return (
        <>
            <motion.div
                className="menu-overlay"
                onClick={onClose}
                id="menu-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.7)',
                    backdropFilter: 'blur(8px)',
                    zIndex: 9998
                }}
            />
            <motion.div
                id="menu-drawer"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                style={{
                    position: 'fixed',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: 'min(340px, 85vw)',
                    zIndex: 9999,
                    background: '#0A0A0A',
                    borderLeft: '1px solid rgba(212,207,201,0.12)',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 'calc(var(--safe-top) + 24px) 24px calc(var(--safe-bottom) + 24px)',
                    color: '#FFFFFF'
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '40px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '50%',
                            background: 'rgba(212,207,201,0.1)',
                            border: '1px solid rgba(212,207,201,0.25)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '14px',
                            fontWeight: 600,
                            color: GOLD,
                            letterSpacing: '1px'
                        }}>
                            {initials}
                        </div>
                        <div>
                            <div style={{
                                fontSize: '15px',
                                fontWeight: 500,
                                color: '#FFFFFF',
                                letterSpacing: '0.2px',
                                lineHeight: 1.2
                            }}>
                                {displayName}
                            </div>
                            <div style={{
                                fontSize: '12px',
                                color: '#888888',
                                marginTop: '3px',
                                letterSpacing: '0.2px'
                            }}>
                                {email}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close menu"
                        id="menu-close-btn"
                        style={{
                            background: 'transparent',
                            border: '1px solid rgba(212,207,201,0.15)',
                            borderRadius: '50%',
                            width: '36px',
                            height: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: GOLD,
                            transition: 'all 0.2s ease'
                        }}
                    >
                        <X size={16} strokeWidth={2} />
                    </button>
                </div>

                {/* Hairline */}
                <div style={{
                    height: '1px',
                    background: 'linear-gradient(90deg, transparent, rgba(212,207,201,0.2), transparent)',
                    marginBottom: '32px'
                }} />

                {/* Nav Items */}
                <nav style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                }}>
                    {[
                        { id: 'menu-vault', icon: FolderOpen, label: 'My Vault', path: '/?tab=vault' },
                        { id: 'menu-settings', icon: Settings, label: 'Settings', path: '/settings' },
                        { id: 'menu-help', icon: MessageCircle, label: 'Help & Support', path: '/help' },
                        { id: 'menu-about', icon: Info, label: 'About ELS Elite', path: '/about' },
                    ].map(({ id, icon: Icon, label, path }) => (
                        <div
                            key={id}
                            id={id}
                            onClick={() => { triggerHaptic('light'); navigate(path); onClose(); }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '16px',
                                padding: '16px 12px',
                                cursor: 'pointer',
                                borderRadius: '0px',
                                transition: 'all 0.2s ease',
                                color: '#FFFFFF'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(212,207,201,0.06)';
                                e.currentTarget.style.color = GOLD;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.color = '#FFFFFF';
                            }}
                        >
                            <Icon size={18} strokeWidth={1.5} color={GOLD} />
                            <span style={{
                                fontSize: '14px',
                                fontWeight: 400,
                                letterSpacing: '0.3px'
                            }}>
                                {label}
                            </span>
                        </div>
                    ))}

                    {/* Divider */}
                    <div style={{
                        height: '1px',
                        background: 'linear-gradient(90deg, transparent, rgba(212,207,201,0.15), transparent)',
                        margin: '16px 0'
                    }} />

                    {/* Sign Out */}
                    <div
                        id="menu-sign-out"
                        onClick={handleSignOut}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '16px',
                            padding: '16px 12px',
                            cursor: 'pointer',
                            borderRadius: '0px',
                            transition: 'all 0.2s ease',
                            color: '#FF3B30'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255,59,48,0.06)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                        }}
                    >
                        <LogOut size={18} strokeWidth={1.5} color="#FF3B30" />
                        <span style={{
                            fontSize: '14px',
                            fontWeight: 400,
                            letterSpacing: '0.3px'
                        }}>
                            Sign Out
                        </span>
                    </div>
                </nav>

                {/* Footer */}
                <div style={{
                    marginTop: 'auto',
                    paddingTop: '24px'
                }}>
                    <div style={{
                        fontSize: '10px',
                        letterSpacing: '2px',
                        textTransform: 'uppercase',
                        color: '#555555',
                        textAlign: 'center'
                    }}>
                        ELS Elite
                    </div>
                </div>
            </motion.div>
        </>
    );
}

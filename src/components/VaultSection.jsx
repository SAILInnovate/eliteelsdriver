import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { Shield, Clock, AlertTriangle, Trash2, Infinity, ChevronRight, Star, Award, Egg } from 'lucide-react';

const GOLD = '#D4CFC9';
const GOLD_DIM = 'rgba(212,207,201,0.12)';

export default function VaultSection({ clinches, isPro }) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('active');

    const resolveContactName = (phone) => {
        try {
            const cache = JSON.parse(localStorage.getItem('clinch_contacts_cache') || '[]');
            const contact = cache.find(c => c.phoneNumbers?.some(p => p.value.replace(/\s+/g, '') === phone?.replace(/\s+/g, '')));
            return contact ? contact.fullName : phone;
        } catch {
            return phone;
        }
    };

    const filteredClinches = clinches ? clinches.filter(c => {
        if (activeFilter === 'active' && !['clinched', 'disputed'].includes(c.status)) return false;
        if (activeFilter === 'pending' && c.status !== 'pending') return false;
        if (activeFilter === 'archived' && !['rejected', 'expired'].includes(c.status)) return false;

        const query = searchQuery.toLowerCase();
        const termsMatch = c.terms ? c.terms.toLowerCase().includes(query) : false;
        const phoneMatch = c.recipient_phone ? c.recipient_phone.toLowerCase().includes(query) : false;
        const nameMatch = c.agreed_name ? c.agreed_name.toLowerCase().includes(query) : false;
        return termsMatch || phoneMatch || nameMatch;
    }) : [];

    const isEmpty = !clinches || clinches.length === 0;
    const completedClinches = clinches ? clinches.filter(c => c.status === 'clinched').length : 0;

    const statusConfig = {
        pending: {
            Icon: Clock,
            label: 'Pending',
            color: '#F59E0B',
            bg: 'rgba(245,158,11,0.08)',
        },
        clinched: {
            Icon: Infinity,
            label: 'Clinched',
            color: GOLD,
            bg: 'rgba(212,207,201,0.08)',
        },
        expired: {
            Icon: Trash2,
            label: 'Expired',
            color: '#888888',
            bg: 'rgba(136,136,136,0.06)',
        },
        disputed: {
            Icon: AlertTriangle,
            label: 'Disputed',
            color: '#FF3B30',
            bg: 'rgba(255,59,48,0.08)',
        },
        rejected: {
            Icon: Trash2,
            label: 'Rejected',
            color: '#888888',
            bg: 'rgba(136,136,136,0.06)',
        },
    };

    const TrustIcon = completedClinches >= 5 ? Award : completedClinches > 0 ? Star : Egg;

    return (
        <div className="vault-section" id="vault-section" style={{ padding: '0 4px' }}>
            {/* Trust Badge */}
            <div style={{
                background: completedClinches > 0
                    ? 'linear-gradient(135deg, rgba(212,207,201,0.08), rgba(212,207,201,0.03))'
                    : 'transparent',
                border: `1px solid ${completedClinches > 0 ? 'rgba(212,207,201,0.15)' : GOLD_DIM}`,
                padding: '24px',
                marginBottom: '24px',
                color: '#FFFFFF',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px'
            }}>
                <TrustIcon size={28} strokeWidth={1.5} color={GOLD} />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 500, letterSpacing: '0.3px' }}>
                    {completedClinches > 0 ? 'Verified Reliable' : 'No Trust Rating Yet'}
                </h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#888888', lineHeight: 1.5 }}>
                    {completedClinches > 0
                        ? `${completedClinches} Clinch${completedClinches === 1 ? '' : 'es'} completed. Building reputation on the Trust Graph.`
                        : `Complete your first Clinch to start building your Reliability Badge.`}
                </p>
                {isPro && (
                    <div style={{
                        marginTop: '4px',
                        background: 'rgba(212,207,201,0.08)',
                        color: GOLD,
                        padding: '4px 12px',
                        border: `1px solid ${GOLD_DIM}`,
                        fontSize: '10px',
                        fontWeight: 600,
                        letterSpacing: '2px',
                        textTransform: 'uppercase'
                    }}>
                        ELS Elite Member
                    </div>
                )}
            </div>

            {/* Filter Tabs */}
            <div style={{
                display: 'flex',
                gap: '20px',
                marginBottom: '20px',
                borderBottom: '1px solid rgba(212,207,201,0.1)',
                paddingBottom: '2px'
            }}>
                {['active', 'pending', 'archived'].map(f => (
                    <button
                        key={f}
                        onClick={() => setActiveFilter(f)}
                        style={{
                            padding: '8px 2px',
                            background: 'transparent',
                            border: 'none',
                            color: activeFilter === f ? GOLD : '#888888',
                            fontWeight: '600',
                            fontSize: '13px',
                            cursor: 'pointer',
                            position: 'relative',
                            textTransform: 'uppercase',
                            letterSpacing: '1.5px'
                        }}
                    >
                        {f}
                        {activeFilter === f && (
                            <motion.div
                                layoutId="activeFilterTab"
                                style={{
                                    position: 'absolute',
                                    bottom: '-2px',
                                    left: 0,
                                    right: 0,
                                    height: '1px',
                                    background: GOLD
                                }}
                            />
                        )}
                    </button>
                ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
                <h3 style={{
                    margin: 0,
                    fontSize: '12px',
                    fontWeight: 600,
                    letterSpacing: '2px',
                    textTransform: 'uppercase',
                    color: GOLD
                }}>
                    {activeFilter === 'archived' ? 'Archived' : `Your ${activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1)} Clinches`}
                </h3>
                {activeFilter === 'pending' && (
                    <p style={{ margin: 0, fontSize: '13px', color: '#888888', fontWeight: '400' }}>
                        Includes requests sent by you and to you.
                    </p>
                )}
            </div>

            {!isEmpty && (
                <div style={{ marginBottom: '20px' }}>
                    <input
                        type="text"
                        placeholder="Search agreements..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '12px 16px',
                            border: '1px solid rgba(212,207,201,0.15)',
                            background: 'rgba(212,207,201,0.03)',
                            fontSize: '14px',
                            outline: 'none',
                            color: '#FFFFFF',
                            transition: 'border-color 0.2s',
                            caretColor: GOLD
                        }}
                    />
                </div>
            )}

            {isEmpty ? (
                <div style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: '#888888'
                }}>
                    <Shield size={48} strokeWidth={1} color={GOLD_DIM} style={{ margin: '0 auto 16px' }} />
                    <p style={{ fontSize: '14px', lineHeight: 1.5 }}>
                        Your vault is empty.<br />Send a Clinch to lock in your first agreement.
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {filteredClinches.length === 0 && searchQuery ? (
                        <p style={{ textAlign: 'center', color: '#888888', padding: '20px 0' }}>
                            No results found for "{searchQuery}".
                        </p>
                    ) : (
                        filteredClinches.map((clinch) => {
                            const config = statusConfig[clinch.status] || statusConfig.pending;
                            const StatusIcon = config.Icon;
                            return (
                                <div
                                    key={clinch.id}
                                    id={`clinch-item-${clinch.id}`}
                                    onClick={() => {
                                        const isSender = clinch.sender_id === user?.id;
                                        if (clinch.status === 'pending' && !isSender) {
                                            navigate(`/agree/${clinch.id}`);
                                        } else {
                                            navigate(`/clinch/${clinch.id}`);
                                        }
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '14px',
                                        padding: '16px',
                                        background: 'rgba(212,207,201,0.03)',
                                        border: '1px solid rgba(212,207,201,0.08)',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = 'rgba(212,207,201,0.2)';
                                        e.currentTarget.style.background = 'rgba(212,207,201,0.06)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = 'rgba(212,207,201,0.08)';
                                        e.currentTarget.style.background = 'rgba(212,207,201,0.03)';
                                    }}
                                >
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '50%',
                                        background: config.bg,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        marginTop: '2px'
                                    }}>
                                        <StatusIcon size={16} strokeWidth={1.5} color={config.color} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            color: '#FFFFFF',
                                            lineHeight: 1.3,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {clinch.terms || clinch.label}
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#888888', marginTop: '4px' }}>
                                            {(() => {
                                                const isSender = clinch.sender_id === user?.id;
                                                if (isSender) {
                                                    const recipientDisplay = clinch.agreed_name || resolveContactName(clinch.recipient_phone);
                                                    return `With ${recipientDisplay}`;
                                                } else {
                                                    return `With ${clinch.sender_name || 'Someone'}`;
                                                }
                                            })()}
                                        </div>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            marginTop: '6px'
                                        }}>
                                            <span style={{
                                                fontSize: '10px',
                                                fontWeight: 600,
                                                letterSpacing: '1.5px',
                                                textTransform: 'uppercase',
                                                color: config.color
                                            }}>
                                                {config.label}
                                            </span>
                                            <span style={{ fontSize: '11px', color: '#555555' }}>
                                                {clinch.created_at ? new Date(clinch.created_at).toLocaleDateString() : 'Just now'}
                                            </span>
                                        </div>
                                    </div>
                                    <ChevronRight size={16} color="#555555" style={{ marginTop: '10px', flexShrink: 0 }} />
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}

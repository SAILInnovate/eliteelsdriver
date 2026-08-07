import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { motion } from 'framer-motion';
import { syncContacts } from '../lib/capacitor';

// Quick helper to generate initials from a name
const getInitials = (name) => {
    if (!name || name === 'Anonymous User') return '👤';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
};

const resolveContactName = (phone) => {
    if (!phone) return null;
    try {
        const cache = JSON.parse(localStorage.getItem('clinch_contacts_cache') || '[]');

        // Extract the last 9 digits to ignore country codes (+44 vs 0)
        const targetBase = phone.replace(/\D/g, '').slice(-9);

        const contact = cache.find(c =>
            c.phoneNumbers?.some(p => {
                const localBase = p.value.replace(/\D/g, '').slice(-9);
                return localBase === targetBase && targetBase.length > 0;
            })
        );
        return contact ? contact.fullName : null;
    } catch {
        return null;
    }
};

export default function NetworkTab() {
    const { user } = useAuth();
    const { theme } = useTheme();
    const [connections, setConnections] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);

    // Calculate real stats
    const realLinks = connections.reduce((acc, curr) => acc + curr.sharedLinks, 0);
    // Trust score based on number of successful clinches (e.g., 10 per link, cap at 100)
    const realTrustScore = Math.min(100, realLinks * 10);

    useEffect(() => {
        async function runSilentSync() {
            try {
                const lastSync = localStorage.getItem('clinch_contacts_last_sync');
                const ONE_DAY = 24 * 60 * 60 * 1000;

                // Only sync if we haven't done it in the last 24 hours
                if (!lastSync || (Date.now() - parseInt(lastSync, 10)) > ONE_DAY) {
                    console.log("Silently syncing contacts...");
                    await syncContacts();
                    // Force a quick re-render of the names once synced
                    setConnections(prev => [...prev]);
                }
            } catch (err) {
                console.warn("Silent sync failed", err);
            }
        }

        runSilentSync();
    }, []);

    useEffect(() => {
        async function fetchGraphData() {
            if (!user) return;
            try {
                // Fetch user's real clinches
                const { data, error } = await supabase
                    .from('clinches')
                    .select('*')
                    .or(`sender_id.eq.${user.id},agreed_by.eq.${user?.phone || 'none'}`)
                    .eq('status', 'clinched');

                if (error) throw error;

                const nodesMap = new Map();

                (data || []).forEach(clinch => {
                    const isSender = clinch.sender_id === user.id;

                    // 1. Normalize phone numbers to guarantee perfect deduplication (removes spaces/dashes, keeps +)
                    const cleanPhone = (phoneStr) => phoneStr ? phoneStr.replace(/[^\d+]/g, '') : null;

                    const recipient = cleanPhone(clinch.recipient_phone);
                    const sender = cleanPhone(clinch.sender_phone);
                    const agreedBy = cleanPhone(clinch.agreed_by);

                    // 2. Accurately identify the OTHER person
                    const contactId = isSender
                        ? (agreedBy || recipient)
                        : (sender || clinch.sender_id);

                    // Prevent connecting to yourself or empty profiles
                    if (!contactId || contactId === user.id || contactId === cleanPhone(user?.phone)) {
                        return;
                    }

                    // 3. Fix the missing names! Pull 'agreed_name' from the DB if you are the sender.
                    // 3. Fix the missing names! Pull 'agreed_name' from the DB if you are the sender.
                    // 3. Fix the missing names! Pull 'agreed_name' from the DB
                    const dbName = isSender ? clinch.agreed_name : clinch.sender_name;
                    const resolvedName = resolveContactName(contactId);

                    // Check if they actually have a profile name saved
                    const isRegistered = !!(dbName && dbName.trim() !== '');

                    // Set the best available name
                    let finalName = 'Pending Profile';
                    if (isRegistered) {
                        finalName = dbName;
                    } else if (resolvedName) {
                        finalName = resolvedName; // Just use your phone's contact name!
                    }

                    // 4. Update the Map (Make sure to add isRegistered here)
                    if (!nodesMap.has(contactId)) {
                        nodesMap.set(contactId, {
                            id: contactId,
                            name: finalName,
                            phone: contactId,
                            sharedLinks: 1,
                            trustScore: 45,
                            isRegistered: isRegistered // <-- ADD THIS
                        });
                    } else {
                        nodesMap.get(contactId).sharedLinks += 1;
                        nodesMap.get(contactId).trustScore = Math.min(100, nodesMap.get(contactId).trustScore + 10);
                        // Upgrade the name if we find a better one on a subsequent loop
                        if (!nodesMap.get(contactId).isRegistered && isRegistered) {
                            nodesMap.get(contactId).name = finalName;
                            nodesMap.get(contactId).isRegistered = true;
                        }
                    }
                });

                setConnections(Array.from(nodesMap.values()).sort((a, b) => b.sharedLinks - a.sharedLinks));
            } catch (err) {
                console.error("Error fetching graph", err);
            } finally {
                setLoading(false);
            }
        }

        fetchGraphData();
    }, [user]);

    const filteredConnections = connections.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phone.includes(searchQuery)
    );

    return (
        <div className="network-page" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            <div style={{ padding: '24px 20px 16px', flexShrink: 0 }}>
                <h1 style={{ fontSize: '28px', fontWeight: '900', color: 'var(--color-teal)', margin: '0 0 4px 0', letterSpacing: '-1px' }}>Trust Graph</h1>
                <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: 0, fontWeight: '600' }}>Your verified network index</p>
            </div>

            {/* Global Stats Dashboard */}
            <div style={{ padding: '0 20px 20px', display: 'flex', gap: '12px', flexShrink: 0 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px', background: 'var(--color-gray-100)', borderRadius: '16px', border: '1px solid var(--color-gray-200)' }}>
                    <span style={{ fontSize: '32px', fontWeight: '900', color: 'var(--color-teal)', lineHeight: 1 }}>{realLinks}</span>
                    <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginTop: '6px', letterSpacing: '0.05em' }}>Verified Links</span>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px', background: 'var(--color-gray-100)', borderRadius: '16px', border: '1px solid var(--color-gray-200)' }}>
                    <span style={{ fontSize: '32px', fontWeight: '900', color: 'var(--color-text)', lineHeight: 1 }}>{realTrustScore}</span>
                    <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginTop: '6px', letterSpacing: '0.05em' }}>Trust Score</span>
                </div>
            </div>

            {/* Search Bar */}
            <div style={{ padding: '0 20px', marginBottom: '16px', flexShrink: 0 }}>
                <input
                    type="text"
                    placeholder="Search network..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                        width: '100%', padding: '14px 16px', borderRadius: '12px',
                        border: 'none', background: 'var(--color-gray-100)',
                        fontSize: '16px', fontWeight: '600', color: 'var(--color-text)'
                    }}
                />
            </div>

            {/* Scrollable Connections List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 40px' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>Loading network...</div>
                ) : filteredConnections.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>
                        {searchQuery ? 'No connections match your search.' : 'You have no verified handshakes yet.'}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {filteredConnections.map((conn, idx) => (
                            <motion.div
                                key={conn.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.05 }}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '16px', background: 'var(--color-white)', borderRadius: '16px',
                                    border: '1px solid var(--color-gray-200)',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    {/* Avatar */}
                                    <div style={{
                                        width: '48px', height: '48px', borderRadius: '50%',
                                        background: 'var(--color-gray-100)', border: '1px solid var(--color-gray-200)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '16px', fontWeight: '800', color: 'var(--color-teal)'
                                    }}>
                                        {getInitials(conn.name)}
                                    </div>

                                    {/* Name & Phone */}
                                    <div>
                                        <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--color-text)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            {conn.name}
                                        </div>

                                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: '600' }}>
                                            {/* Render the phone number (or clean UUID) */}
                                            {conn.phone?.includes('-') && conn.phone.length > 20
                                                ? `User ID: ${conn.phone.split('-')[0].toUpperCase()}`
                                                : conn.phone}

                                            {/* Add the custom message if they haven't joined! */}
                                            {!conn.isRegistered && (
                                                <span style={{ color: '#F59E0B' }}>
                                                    {" "} • Hasn't joined Clinch yet
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Stats Column */}
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '12px' }}>⭐</span>
                                        <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--color-text)' }}>{conn.trustScore}</span>
                                    </div>
                                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--color-teal)', background: 'rgba(0,128,128,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                                        🤝 {conn.sharedLinks} {conn.sharedLinks === 1 ? 'Link' : 'Links'}
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}



import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import NavBar from '../components/NavBar';
import { useAuth } from '../context/AuthContext';
import { triggerHaptic, isNativePlatform, getProStatus, configurePurchases } from '../lib/capacitor';
import jsPDF from 'jspdf';
import MenuDrawer from '../components/MenuDrawer';
import BottomNav from '../components/BottomNav';

export default function ClinchDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [clinch, setClinch] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isPro, setIsPro] = useState(false);

    // Helper to load an image as base64
    const loadImageAsBase64 = (url) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = reject;
            img.src = url;
        });
    };

    const handleProExport = async () => {
        try {
            if (!isPro) {
                triggerHaptic('warning');
                const wantsToUpgrade = window.confirm("Clinch+ Pro Required ⚡\n\nExporting formal PDF certificates is a premium feature. Would you like to upgrade in Settings?");
                if (wantsToUpgrade) navigate('/settings');
                return;
            }

            triggerHaptic('medium');

            // Load brand assets
            let logoBase64, handshakeBase64;
            try {
                [logoBase64, handshakeBase64] = await Promise.all([
                    loadImageAsBase64('/assets/clinch-logo.png'),
                    loadImageAsBase64('/assets/geometric-handshake.png')
                ]);
            } catch (e) {
                console.warn('Could not load brand images for PDF', e);
            }

            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const margin = 20;
            const pageWidth = 210;
            const contentWidth = pageWidth - (2 * margin);
            let y = 0;

            // ═══════════════════════════════════
            // HEADER — Dark branded banner
            // ═══════════════════════════════════
            doc.setFillColor(1, 58, 58); // Dark teal #013A3A
            doc.rect(0, 0, pageWidth, 52, 'F');

            // Accent stripe
            doc.setFillColor(0, 128, 128);
            doc.rect(0, 52, pageWidth, 3, 'F');

            // Logo image
            if (logoBase64) {
                doc.addImage(logoBase64, 'PNG', margin, 12, 50, 20);
            } else {
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(28);
                doc.setFont('helvetica', 'bold');
                doc.text('CLINCH', margin, 28);
            }

            // Certificate title
            doc.setTextColor(152, 255, 152); // Mint #98FF98
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text('CERTIFICATE OF AGREEMENT', pageWidth - margin, 22, { align: 'right' });

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(`ID: ${id.toUpperCase().slice(0, 8)}`, pageWidth - margin, 30, { align: 'right' });
            doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - margin, 36, { align: 'right' });

            y = 65;

            // ═══════════════════════════════════
            // WATERMARK — Diagonal text pattern
            // ═══════════════════════════════════
            doc.saveGraphicsState();
            doc.setGState(new doc.GState({ opacity: 0.04 }));
            doc.setTextColor(0, 128, 128);
            doc.setFontSize(28);
            doc.setFont('helvetica', 'bold');
            const watermarkText = 'CLINCH VERIFIED';
            for (let wy = 40; wy < 300; wy += 45) {
                for (let wx = -60; wx < 250; wx += 120) {
                    doc.text(watermarkText, wx, wy, { angle: 35 });
                }
            }
            doc.restoreGraphicsState();

            // ═══════════════════════════════════
            // WATERMARK — Handshake image (faded)
            // ═══════════════════════════════════
            if (handshakeBase64) {
                doc.saveGraphicsState();
                doc.setGState(new doc.GState({ opacity: 0.05 }));
                doc.addImage(handshakeBase64, 'PNG', 55, 110, 100, 80);
                doc.restoreGraphicsState();
            }

            // ═══════════════════════════════════
            // AGREEMENT TERMS — Quoted block
            // ═══════════════════════════════════
            doc.setTextColor(0, 128, 128);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('AGREEMENT TERMS', margin, y);
            y += 4;

            // Teal accent line
            doc.setDrawColor(0, 128, 128);
            doc.setLineWidth(0.8);
            doc.line(margin, y, margin + 30, y);
            y += 8;

            // Terms box
            doc.setFillColor(248, 250, 252);
            doc.setDrawColor(226, 232, 240);
            const termsText = doc.splitTextToSize(`"${clinch.terms}"`, contentWidth - 16);
            const termsBoxHeight = Math.max(24, termsText.length * 6 + 12);
            doc.roundedRect(margin, y, contentWidth, termsBoxHeight, 3, 3, 'FD');

            // Left accent bar on terms box
            doc.setFillColor(0, 128, 128);
            doc.rect(margin, y, 3, termsBoxHeight, 'F');

            doc.setTextColor(30, 41, 59);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'normal');
            doc.text(termsText, margin + 10, y + 10);
            y += termsBoxHeight + 16;

            // ═══════════════════════════════════
            // PARTIES — Two-column layout
            // ═══════════════════════════════════
            doc.setTextColor(0, 128, 128);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('PARTIES INVOLVED', margin, y);
            y += 4;
            doc.setLineWidth(0.8);
            doc.line(margin, y, margin + 30, y);
            y += 8;

            const colWidth = (contentWidth - 6) / 2;

            // Sender box
            doc.setFillColor(248, 250, 252);
            doc.setDrawColor(226, 232, 240);
            doc.roundedRect(margin, y, colWidth, 28, 2, 2, 'FD');

            doc.setTextColor(100, 116, 139);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.text('SENDER', margin + colWidth / 2, y + 8, { align: 'center' });

            doc.setTextColor(30, 41, 59);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text(clinch.sender_name || 'N/A', margin + colWidth / 2, y + 18, { align: 'center' });

            // Recipient box
            const col2X = margin + colWidth + 6;
            doc.setFillColor(248, 250, 252);
            doc.roundedRect(col2X, y, colWidth, 28, 2, 2, 'FD');

            doc.setTextColor(100, 116, 139);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.text('RECIPIENT', col2X + colWidth / 2, y + 8, { align: 'center' });

            doc.setTextColor(30, 41, 59);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text(clinch.recipient_phone || 'N/A', col2X + colWidth / 2, y + 18, { align: 'center' });

            y += 38;

            // ═══════════════════════════════════
            // AUDIT TRAIL — Timeline style
            // ═══════════════════════════════════
            doc.setTextColor(0, 128, 128);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('DIGITAL AUDIT TRAIL', margin, y);
            y += 4;
            doc.setLineWidth(0.8);
            doc.line(margin, y, margin + 30, y);
            y += 10;

            const auditEvents = [
                { label: 'Agreement Drafted', date: clinch.created_at, color: [0, 128, 128] },
                { label: clinch.agreed_at ? 'Handshake Sealed' : 'Awaiting Handshake', date: clinch.agreed_at, color: clinch.agreed_at ? [34, 197, 94] : [156, 163, 175] },
            ];

            if (clinch.disputed_at) {
                auditEvents.push({ label: 'Agreement Disputed', date: clinch.disputed_at, color: [255, 69, 58] });
            }
            if (clinch.resolved_at) {
                auditEvents.push({ label: 'Dispute Resolved', date: clinch.resolved_at, color: [34, 197, 94] });
            }

            auditEvents.forEach((event, i) => {
                // Timeline dot
                doc.setFillColor(...event.color);
                doc.circle(margin + 4, y + 1, 2.5, 'F');

                // Timeline line (skip last)
                if (i < auditEvents.length - 1) {
                    doc.setDrawColor(226, 232, 240);
                    doc.setLineWidth(0.5);
                    doc.line(margin + 4, y + 4, margin + 4, y + 14);
                }

                // Event text
                doc.setTextColor(30, 41, 59);
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                doc.text(event.label, margin + 12, y + 2);

                doc.setTextColor(100, 116, 139);
                doc.setFontSize(9);
                doc.setFont('helvetica', 'normal');
                doc.text(event.date ? new Date(event.date).toLocaleString() : 'Pending...', margin + 12, y + 7);

                y += 16;
            });

            // IP Address
            if (clinch.agreed_ip) {
                y += 2;
                doc.setTextColor(148, 163, 184);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                doc.text(`Verification IP: ${clinch.agreed_ip}`, margin + 12, y);
                y += 10;
            }

            // ═══════════════════════════════════
            // FOOTER — Branded
            // ═══════════════════════════════════
            const footerY = 272;

            // Footer line
            doc.setDrawColor(0, 128, 128);
            doc.setLineWidth(0.5);
            doc.line(margin, footerY, pageWidth - margin, footerY);

            // Footer text
            doc.setTextColor(148, 163, 184);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text('This document is a secure, verifiable certificate of intent.', pageWidth / 2, footerY + 6, { align: 'center' });
            doc.text('Generated by Clinch — Digital Handshake Protocol  •  clinch.to', pageWidth / 2, footerY + 11, { align: 'center' });

            // Handshake icon in footer
            if (handshakeBase64) {
                doc.saveGraphicsState();
                doc.setGState(new doc.GState({ opacity: 0.15 }));
                doc.addImage(handshakeBase64, 'PNG', pageWidth - margin - 20, footerY - 8, 20, 16);
                doc.restoreGraphicsState();
            }

            // Save
            doc.save(`Clinch_Certificate_${id.slice(0, 8)}.pdf`);

        } catch (error) {
            console.error(error);
            alert('Failed to generate PDF. Check your connection.');
        }
    };

    const handleDispute = async () => {
        const confirmFlag = window.confirm("Raise a Dispute?\n\nYou are about to flag this Clinch as DISPUTED. This indicates the terms were not honored. Proceed?");
        if (!confirmFlag) return;

        try {
            triggerHaptic('warning');
            const { error } = await supabase
                .from('clinches')
                .update({
                    status: 'disputed',
                    disputed_at: new Date().toISOString()
                })
                .eq('id', id);

            if (error) throw error;
            setClinch({ ...clinch, status: 'disputed', disputed_at: new Date().toISOString() });
            alert("Agreement disputed.");
        } catch (err) {
            console.error(err);
            alert("Failed to raise dispute.");
        }
    };

    const handleUnflag = async () => {
        const confirmUnflag = window.confirm("Resolve Dispute?\n\nHas this agreement been honored? Marking it as resolved will update your digital audit trail.");
        if (!confirmUnflag) return;

        try {
            triggerHaptic('medium');
            const { error } = await supabase
                .from('clinches')
                .update({
                    status: 'clinched',
                    resolved_at: new Date().toISOString()
                })
                .eq('id', id);

            if (error) throw error;
            setClinch({ ...clinch, status: 'clinched', resolved_at: new Date().toISOString() });
            alert("Dispute marked as resolved.");
        } catch (err) {
            console.error(err);
            alert("Failed to resolve dispute.");
        }
    };

    useEffect(() => {
        async function fetchClinch() {
            if (id === 'demo-123') {
                setClinch({
                    id: 'demo-123',
                    terms: 'I, Sarah, agree to pay Dave £150 for the shared electric bill by this Friday.',
                    sender_name: 'Dave Smith',
                    recipient_phone: '+44 7700 900000',
                    status: 'clinched',
                    created_at: '2026-02-26T10:00:00Z',
                    agreed_at: '2026-02-26T14:30:00Z',
                    agreed_ip: '82.16.244.102',
                    id_verified: true
                });
                setLoading(false);
                return;
            }

            try {
                const { data, error } = await supabase
                    .from('clinches')
                    .select('*')
                    .eq('id', id)
                    .single();

                if (error) throw error;
                setClinch(data);
            } catch (err) {
                console.error("Error fetching clinch data:", err);
            } finally {
                setLoading(false);
            }
        }

        async function checkProStatus() {
            if (!user) return; // Wait for user to be loaded

            if (isNativePlatform()) {
                await configurePurchases(user.id);
                const pro = await getProStatus();
                setIsPro(pro);
            } else {
                try {
                    const { data } = await supabase.from('user_subscriptions').select('tier').eq('user_id', user.id).single();
                    if (data?.tier === 'pro') setIsPro(true);
                } catch (error) {
                    console.error("Error checking pro status:", error);
                    setIsPro(false);
                }
            }
        }

        fetchClinch();
        checkProStatus();
    }, [id, user]); // Depend on user to re-check pro status if user changes

    if (loading) return <div className="splash-screen">Loading Certificate...</div>;

    if (!clinch) return <div className="splash-screen">Agreement Not Found</div>;

    return (
        <div className="app-wrapper">
            <NavBar onMenuClick={() => setIsMenuOpen(true)} />

            <div className="scroll-content">
                <div className="app-content">
                    <button className="btn-back" onClick={() => navigate('/')}>
                        ← Back to Vault
                    </button>

                    <div className="certificate">
                        <div className="certificate__header">
                            <div className="certificate__seal">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                </svg>
                            </div>
                            <h1>Clinch Certificate</h1>
                            <p className="certificate__id">ID: {id.toUpperCase()}</p>
                        </div>

                        <div className="certificate__body">
                            <div className="cert-section">
                                <span className="cert-label">Agreement Terms</span>
                                <p className="cert-terms">"{clinch.terms}"</p>
                            </div>

                            <div className="cert-row">
                                <div className="cert-col">
                                    <span className="cert-label">Sender</span>
                                    <p className="cert-value">{clinch.sender_name}</p>
                                </div>
                                <div className="cert-col">
                                    <span className="cert-label">Recipient</span>
                                    <p className="cert-value">{clinch.recipient_phone}</p>
                                </div>
                            </div>

                            <div className="cert-divider" />

                            <div className="cert-audit">
                                <h3>Digital Audit Trail</h3>
                                <div className="audit-item">
                                    <span className="audit-dot" />
                                    <div className="audit-info">
                                        <strong>Drafted</strong>
                                        <span>{new Date(clinch.created_at).toLocaleString()}</span>
                                    </div>
                                </div>
                                <div className="audit-item">
                                    <span className={`audit-dot ${clinch.status === 'clinched' ? 'audit-dot--active' : ''} ${clinch.status === 'rejected' ? 'audit-dot--rejected' : ''}`}
                                        style={clinch.status === 'rejected' ? { background: '#FF453A' } : {}} />
                                    <div className="audit-info">
                                        <strong>{clinch.status === 'clinched' ? 'Clinched via Slider' : clinch.status === 'rejected' ? 'Rejected by Recipient' : 'Pending Handshake'}</strong>
                                        <span>{clinch.status === 'rejected' && clinch.rejected_at ? new Date(clinch.rejected_at).toLocaleString() : clinch.agreed_at ? new Date(clinch.agreed_at).toLocaleString() : 'Waiting for recipient...'}</span>
                                        {clinch.agreed_ip && <span className="audit-meta">IP: {clinch.agreed_ip}</span>}
                                    </div>
                                </div>
                                {clinch.disputed_at && (
                                    <div className="audit-item" style={{ marginTop: '16px' }}>
                                        <span className="audit-dot" style={{ background: '#FF453A' }} />
                                        <div className="audit-info">
                                            <strong style={{ color: '#FF453A' }}>Agreement Disputed</strong>
                                            <span>{clinch.disputed_at ? new Date(clinch.disputed_at).toLocaleString() : 'Date Unknown'}</span>
                                            <span style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>Flagged for non-fulfillment by owner.</span>
                                        </div>
                                    </div>
                                )}
                                {clinch.resolved_at && (
                                    <div className="audit-item" style={{ marginTop: '16px' }}>
                                        <span className="audit-dot" style={{ background: '#22C55E' }} />
                                        <div className="audit-info">
                                            <strong style={{ color: '#22C55E' }}>Dispute Resolved</strong>
                                            <span>{new Date(clinch.resolved_at).toLocaleString()}</span>
                                            <span style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>Marked as resolved by owner.</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="certificate__footer">
                            <p>🛡️ This document is a secure, verifiable log of intent backed by the Clinch Trust Graph.</p>
                        </div>
                    </div>

                    <button
                        className="btn-secondary"
                        style={{ marginTop: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'linear-gradient(90deg, #FFFFFF827, #1f2937)', color: 'white', border: 'none' }}
                        onClick={handleProExport}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                            <polyline points="16 6 12 2 8 6" />
                            <line x1="12" y1="2" x2="12" y2="15" />
                        </svg>
                        Share / Export Certificate
                    </button>

                    {clinch.status !== 'disputed' && clinch.sender_id === user?.id && (
                        <button
                            className="btn-secondary"
                            style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'transparent', color: '#FF453A', border: '1px solid #FF453A' }}
                            onClick={handleDispute}
                        >
                            <span style={{ fontSize: '18px' }}>🚩</span>
                            Dispute Agreement
                        </button>
                    )}

                    {clinch.status === 'disputed' && clinch.sender_id === user?.id && (
                        <button
                            className="btn-secondary"
                            style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'rgba(34, 197, 94, 0.1)', color: '#16A34A', border: '1px solid #22C55E' }}
                            onClick={handleUnflag}
                        >
                            <span style={{ fontSize: '18px' }}>✅</span>
                            Mark as Resolved
                        </button>
                    )}

                    {clinch.status === 'pending' && (
                        <button
                            className="btn-primary"
                            style={{ marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                            onClick={() => {
                                const shareUrl = `https://clinch.to/agree/${clinch.id}`;
                                const shareMessage = `I've sent you a Digital Handshake via Clinch: ${shareUrl}`;

                                if (navigator.share) {
                                    navigator.share({
                                        title: 'Clinch Handshake',
                                        text: shareMessage,
                                        url: shareUrl,
                                    }).catch(console.error);
                                } else {
                                    navigator.clipboard.writeText(shareUrl);
                                    alert("Link copied to clipboard!");
                                }
                            }}
                        >
                            <span style={{ fontSize: '18px' }}>🚀</span>
                            Resend Clinch Link
                        </button>
                    )}
                </div>
            </div>

            <BottomNav currentTab={null} onChangeTab={(tab) => navigate(`/?tab=${tab}`)} />

            {isMenuOpen && <MenuDrawer onClose={() => setIsMenuOpen(false)} />}
        </div>
    );
}

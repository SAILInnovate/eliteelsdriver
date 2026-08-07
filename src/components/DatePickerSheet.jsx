import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function DatePickerSheet({ isOpen, onClose, onSelect, value }) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [currentMonth, setCurrentMonth] = useState(new Date(value || today));

    const days = useMemo(() => {
        const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
        const calendarDays = [];

        // Padding for previous month days
        const startPadding = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Start on Monday
        for (let i = startPadding; i > 0; i--) {
            calendarDays.push({ date: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1 - i), current: false });
        }

        // Current month days
        for (let i = 1; i <= lastDay.getDate(); i++) {
            calendarDays.push({ date: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i), current: true });
        }

        return calendarDays;
    }, [currentMonth]);

    const formattedMonth = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

    const changeMonth = (offset) => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1));
    };

    const isSelected = (date) => {
        if (!value) return false;
        const d = new Date(value);
        return d.toDateString() === date.toDateString();
    };

    const isToday = (date) => date.toDateString() === today.toDateString();
    const isPast = (date) => date < today;

    const weekdayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    return (
        <AnimatePresence>
            {isOpen && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
                    />
                    <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 250 }}
                        style={{
                            width: '100%',
                            maxWidth: '480px',
                            backgroundColor: 'var(--color-bg)',
                            borderTopLeftRadius: '32px',
                            borderTopRightRadius: '32px',
                            padding: '24px 24px calc(24px + var(--safe-bottom))',
                            boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
                            position: 'relative',
                            zIndex: 1001
                        }}
                    >
                        {/* Drawer Handle */}
                        <div style={{ width: '40px', height: '4px', background: 'var(--color-gray-300)', borderRadius: '2px', margin: '0 auto 24px' }} />

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--color-teal)' }}>Select Due Date</h2>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={() => changeMonth(-1)} style={{ padding: '8px', background: 'var(--color-gray-100)', borderRadius: '12px' }}>←</button>
                                <button onClick={() => changeMonth(1)} style={{ padding: '8px', background: 'var(--color-gray-100)', borderRadius: '12px' }}>→</button>
                            </div>
                        </div>

                        <div style={{ textAlign: 'center', marginBottom: '16px', fontWeight: '700', color: 'var(--color-text)' }}>
                            {formattedMonth}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', marginBottom: '8px' }}>
                            {weekdayLabels.map(label => (
                                <div key={label} style={{ textAlign: 'center', fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: '700' }}>
                                    {label}
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' }}>
                            {days.map(({ date, current }, i) => (
                                <button
                                    key={i}
                                    disabled={!current || isPast(date)}
                                    onClick={() => onSelect(date)}
                                    style={{
                                        height: '44px',
                                        borderRadius: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '14px',
                                        fontWeight: '600',
                                        position: 'relative',
                                        background: isSelected(date) ? 'var(--color-teal)' : 'transparent',
                                        color: isSelected(date) ? '#fff' : !current || isPast(date) ? 'var(--color-gray-400)' : 'var(--color-text)',
                                        border: isToday(date) && !isSelected(date) ? '2px solid var(--color-teal-light)' : 'none',
                                    }}
                                >
                                    {date.getDate()}
                                    {isToday(date) && (
                                        <div style={{ position: 'absolute', bottom: '4px', left: '50%', transform: 'translateX(-50%)', width: '4px', height: '4px', borderRadius: '50%', background: isSelected(date) ? '#fff' : 'var(--color-teal)' }} />
                                    )}
                                </button>
                            ))}
                        </div>

                        <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                            <button
                                className="btn-secondary"
                                onClick={() => onSelect(null)}
                                style={{ flex: 1, height: '52px', fontSize: '15px' }}
                            >
                                No Due Date
                            </button>
                            <button
                                className="btn-primary"
                                onClick={onClose}
                                style={{ flex: 1, margin: 0, height: '52px', fontSize: '15px' }}
                            >
                                Done
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}

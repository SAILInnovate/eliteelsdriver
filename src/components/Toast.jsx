import { useEffect, useRef } from 'react';

export default function Toast({ toast, onDismiss }) {
    const timerRef = useRef(null);

    useEffect(() => {
        if (toast) {
            // Auto-dismiss after 3 seconds
            timerRef.current = setTimeout(() => {
                onDismiss();
            }, 3000);
        }
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [toast, onDismiss]);

    if (!toast) return null;

    const className = `toast toast--visible toast--${toast.type || 'success'}`;

    return (
        <div className={className} id="toast" onClick={onDismiss}>
            {toast.message}
        </div>
    );
}

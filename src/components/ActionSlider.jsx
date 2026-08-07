import { useState, useRef, useEffect, useCallback } from 'react';
import { triggerHaptic, triggerNotificationHaptic } from '../lib/capacitor';

export default function ActionSlider({
    onComplete,
    label = "Slide to Confirm",
    disabled = false,
    successLabel = "Confirmed!"
}) {
    const [isDragging, setIsDragging] = useState(false);
    const [sliderProgress, setSliderProgress] = useState(0);
    const [isComplete, setIsComplete] = useState(false);

    const trackRef = useRef(null);
    const knobRef = useRef(null);
    const fillRef = useRef(null);
    const textRef = useRef(null);
    const startXRef = useRef(0);
    const hapticStepsRef = useRef({ p25: false, p50: false, p75: false });

    const knobSize = 56;
    const trackPadding = 4;

    const getMaxDrag = useCallback(() => {
        if (!trackRef.current) return 0;
        return trackRef.current.clientWidth - knobSize - (trackPadding * 2);
    }, []);

    const handleDragStart = (clientX) => {
        if (disabled || isComplete) return;
        setIsDragging(true);
        startXRef.current = clientX - (sliderProgress * getMaxDrag());
        triggerHaptic('light');
        hapticStepsRef.current = { p25: false, p50: false, p75: false };
    };

    const handleDragMove = useCallback((clientX) => {
        if (!isDragging) return;
        const maxDrag = getMaxDrag();
        if (maxDrag <= 0) return;

        let delta = clientX - startXRef.current;
        let progress = Math.max(0, Math.min(1, delta / maxDrag));

        // Direct DOM updates for 60fps buttery-smooth feel (no React re-renders while dragging)
        if (knobRef.current) {
            knobRef.current.style.transition = 'none';
            knobRef.current.style.transform = `translateX(${progress * maxDrag}px) scale(1.06)`;
        }
        if (fillRef.current) {
            fillRef.current.style.transition = 'none';
            fillRef.current.style.width = `${trackPadding + progress * maxDrag + knobSize / 2}px`;
        }
        if (textRef.current) {
            textRef.current.style.transition = 'none';
            textRef.current.style.opacity = Math.max(0.15, 1 - progress * 1.6);
        }

        // Native haptic milestones
        if (progress > 0.25 && !hapticStepsRef.current.p25) {
            triggerHaptic('light');
            hapticStepsRef.current.p25 = true;
        }
        if (progress > 0.5 && !hapticStepsRef.current.p50) {
            triggerHaptic('medium');
            hapticStepsRef.current.p50 = true;
        }
        if (progress > 0.75 && !hapticStepsRef.current.p75) {
            triggerHaptic('medium');
            hapticStepsRef.current.p75 = true;
        }
    }, [isDragging, getMaxDrag]);

    const handleDragEnd = useCallback(() => {
        if (!isDragging) return;
        setIsDragging(false);

        // Read final position directly from the DOM (most accurate)
        let finalProgress = 0;
        if (knobRef.current) {
            const transform = knobRef.current.style.transform;
            const match = transform.match(/translateX\(([\d.-]+)px\)/);
            if (match && match[1]) {
                const tx = parseFloat(match[1]);
                const maxDrag = getMaxDrag();
                finalProgress = maxDrag > 0 ? tx / maxDrag : 0;
            }
        }
        finalProgress = Math.max(0, Math.min(1, finalProgress));

        if (finalProgress > 0.88) {
            // Success path
            const maxDrag = getMaxDrag();
            if (knobRef.current) {
                knobRef.current.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)';
                knobRef.current.style.transform = `translateX(${maxDrag}px) scale(1)`;
            }
            if (fillRef.current) {
                fillRef.current.style.transition = 'width 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)';
                fillRef.current.style.width = `${trackPadding + maxDrag + knobSize / 2}px`;
            }
            if (textRef.current) {
                textRef.current.style.transition = 'opacity 0.2s ease-out';
                textRef.current.style.opacity = '1';
            }

            setSliderProgress(1);
            setIsComplete(true);
            triggerNotificationHaptic();
            if (onComplete) onComplete();
        } else {
            // Springy reset (feels extremely native)
            if (knobRef.current) {
                knobRef.current.style.transition = 'transform 0.48s cubic-bezier(0.34, 1.56, 0.64, 1)';
                knobRef.current.style.transform = 'translateX(0px) scale(1)';
            }
            if (fillRef.current) {
                fillRef.current.style.transition = 'width 0.48s cubic-bezier(0.34, 1.56, 0.64, 1)';
                fillRef.current.style.width = `${trackPadding + knobSize / 2}px`;
            }
            if (textRef.current) {
                textRef.current.style.transition = 'opacity 0.35s ease-out';
                textRef.current.style.opacity = '1';
            }

            setSliderProgress(0);
            hapticStepsRef.current = { p25: false, p50: false, p75: false };
        }
    }, [isDragging, onComplete, getMaxDrag]);

    const onMouseDown = (e) => {
        e.preventDefault();
        handleDragStart(e.clientX);
    };

    const onTouchStart = (e) => {
        handleDragStart(e.touches[0].clientX);
    };

    useEffect(() => {
        const onMouseMove = (e) => handleDragMove(e.clientX);
        const onTouchMove = (e) => handleDragMove(e.touches[0].clientX);
        const onEnd = () => handleDragEnd();

        if (isDragging) {
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onEnd);
            window.addEventListener('touchmove', onTouchMove, { passive: true });
            window.addEventListener('touchend', onEnd);
        }

        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onEnd);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onEnd);
        };
    }, [isDragging, handleDragMove, handleDragEnd]);

    // Non-dragging values (used by React for initial render + complete state)
    const maxDrag = getMaxDrag();
    const fillWidth = trackPadding + sliderProgress * maxDrag + knobSize / 2;
    const knobTranslateX = isComplete ? maxDrag : 0;

    return (
        <div
            ref={trackRef}
            className={`slide-track ${disabled ? 'slide-track--disabled' : ''} ${isComplete ? 'slide-track--complete' : ''}`}
            style={{
                position: 'relative',
                width: '100%',
                height: '64px',
                background: 'var(--color-gray-100)',
                borderRadius: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                opacity: disabled ? 0.6 : 1,
                border: '1px solid var(--color-gray-200)',
                marginTop: '16px'
            }}
        >
            <div
                ref={fillRef}
                className="slide-track__fill"
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${fillWidth}px`,
                    background: isComplete ? 'var(--color-mint)' : 'rgba(152, 255, 152, 0.2)',
                    transition: isDragging ? 'none' : 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    pointerEvents: 'none'
                }}
            />

            <span
                ref={textRef}
                className="slide-track__text"
                style={{
                    position: 'relative',
                    zIndex: 1,
                    fontSize: '15px',
                    fontWeight: '800',
                    color: isComplete ? 'var(--color-btn-primary-text)' : 'var(--color-teal)',
                    transition: isDragging ? 'none' : 'opacity 0.3s',
                    textAlign: 'center',
                    padding: '0 60px'
                }}
            >
                {isComplete ? successLabel : label}
            </span>

            <div
                ref={knobRef}
                onMouseDown={onMouseDown}
                onTouchStart={onTouchStart}
                className="slide-track__knob"
                style={{
                    position: 'absolute',
                    left: `${trackPadding}px`,
                    width: `${knobSize}px`,
                    height: `${knobSize}px`,
                    background: isComplete ? 'var(--color-white)' : 'var(--color-teal)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: disabled || isComplete ? 'default' : 'grab',
                    boxShadow: isDragging
                        ? '0 12px 32px rgba(0,0,0,0.28)'
                        : '0 4px 12px rgba(0,0,0,0.15)',
                    transition: isDragging
                        ? 'none'
                        : 'transform 0.42s cubic-bezier(0.25, 0.1, 0.25, 1.4), background 0.25s, box-shadow 0.2s',
                    willChange: isDragging ? 'transform' : 'auto',
                    transform: `translateX(${knobTranslateX}px) scale(1)`,
                    zIndex: 2,
                    touchAction: 'none'
                }}
            >
                {isComplete ? (
                    <span style={{ fontSize: '24px' }}>✓</span>
                ) : (
                    <img
                        src="/assets/geometric-handshake.png"
                        alt="Handshake"
                        style={{ width: '32px', filter: 'brightness(0) invert(1)' }}
                    />
                )}
            </div>
        </div>
    );
}
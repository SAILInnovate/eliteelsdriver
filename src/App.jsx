import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ErrorBoundary, OfflineScreen, useOnlineStatus } from './components/SafetyNet';
import { supabase } from './lib/supabase';
import { NDA_VERSION } from './content/driverNda';
import OnboardingPage from './pages/OnboardingPage';
import CompleteProfilePage from './pages/CompleteProfilePage';
import PlayerPortal from './pages/PlayerPortal';

function EliteSplashScreen({ onComplete }) {
  const [phase, setPhase] = useState('in');

  useEffect(() => {
    const holdTimer = setTimeout(() => setPhase('out'), 1800);
    const doneTimer = setTimeout(() => onComplete(), 2400);
    return () => { clearTimeout(holdTimer); clearTimeout(doneTimer); };
  }, [onComplete]);

  const stars = [
    { top: '18%', delay: 0.2, duration: 0.8, width: '80px' },
    { top: '35%', delay: 0.6, duration: 0.6, width: '120px' },
    { top: '52%', delay: 0.3, duration: 0.9, width: '60px' },
    { top: '68%', delay: 0.8, duration: 0.5, width: '100px' },
    { top: '78%', delay: 1.1, duration: 0.7, width: '70px' },
    { top: '25%', delay: 1.4, duration: 0.6, width: '90px' },
    { top: '45%', delay: 1.0, duration: 0.8, width: '50px' },
    { top: '60%', delay: 1.6, duration: 0.5, width: '110px' },
  ];

  return (
    <motion.div
      key="splash"
      initial={{ opacity: 1 }}
      animate={{ opacity: phase === 'out' ? 0 : 1 }}
      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        overflow: 'hidden'
      }}
    >
      {/* Background video removed — shared layer in MainApp */}
      {stars.map((star, i) => (
        <motion.div
          key={i}
          initial={{ x: '-10vw', opacity: 0 }}
          animate={{ x: '110vw', opacity: [0, 0.6, 0] }}
          transition={{
            duration: star.duration,
            delay: star.delay,
            ease: 'linear'
          }}
          style={{
            position: 'absolute',
            top: star.top,
            left: 0,
            width: star.width,
            height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0) 100%)',
            borderRadius: '1px',
            willChange: 'transform, opacity'
          }}
        />
      ))}

      <motion.img
        src="/elitels.png"
        alt="Elite"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1] }}
        style={{
          height: '100px',
          position: 'relative',
          zIndex: 1,
          willChange: 'transform, opacity'
        }}
      />
    </motion.div>
  );
}

function MainApp() {
  const { user, loading } = useAuth();
  const [splashFinished, setSplashFinished] = useState(false);
  const [profileComplete, setProfileComplete] = useState(false);
  const isOnline = useOnlineStatus();

  // Returning drivers must have a name, a driver application on file,
  // AND a signed copy of the current NDA (existing drivers sign on next launch)
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!user?.user_metadata?.full_name) return;
      const [{ data: profile }, { data: nda }] = await Promise.all([
        supabase
          .from('driver_profiles')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('driver_nda_acceptances')
          .select('id')
          .eq('user_id', user.id)
          .eq('nda_version', NDA_VERSION)
          .maybeSingle()
      ]);
      if (!cancelled && profile && nda) setProfileComplete(true);
    };
    check();
    return () => { cancelled = true; };
  }, [user]);

  const needsProfile = user && !profileComplete;

  // Hide the background video once the user is authenticated
  const showBgVideo = !user;

  return (
    <>
      {/* Shared background video — persists across splash → onboarding */}
      <AnimatePresence>
        {showBgVideo && (
          <motion.div
            key="bg-video"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
          >
            <video
              autoPlay
              loop
              muted
              playsInline
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'grayscale(100%) brightness(0.25)'
              }}
            >
              <source src="/assets/bgvideo.mp4" type="video/mp4" />
              <source src="/assets/bgvideo.mov" type="video/quicktime" />
            </video>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {!splashFinished && (
          <EliteSplashScreen onComplete={() => setSplashFinished(true)} />
        )}
      </AnimatePresence>

      {splashFinished && !loading && (
        <BrowserRouter>
          <Routes>
            {!user ? (
              <>
                <Route path="/login" element={<OnboardingPage />} />
                <Route path="*" element={<Navigate to="/login" />} />
              </>
            ) : needsProfile ? (
              <>
                <Route path="*" element={
                  <CompleteProfilePage onComplete={() => setProfileComplete(true)} />
                } />
              </>
            ) : (
              <>
                <Route path="/" element={<PlayerPortal />} />
                <Route path="*" element={<Navigate to="/" />} />
              </>
            )}
          </Routes>
        </BrowserRouter>
      )}

      {/* Offline overlay */}
      <AnimatePresence>
        {!isOnline && <OfflineScreen />}
      </AnimatePresence>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <ThemeProvider>
          <AuthProvider>
            <HelmetProvider>
              <MainApp />
            </HelmetProvider>
          </AuthProvider>
        </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

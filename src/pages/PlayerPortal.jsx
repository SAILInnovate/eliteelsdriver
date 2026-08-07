import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useKeyboardOverlap } from '../lib/keyboard';
import { openWhatsApp, OFFICE_WHATSAPP_DISPLAY } from '../lib/capacitor';
import useLocation from '../hooks/useLocation';
import useBackgroundLocation from '../hooks/useBackgroundLocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Camera, Check, ChevronRight, Fuel, AlertTriangle, Copy, Power, Car, History, Clock, ChevronLeft, Video, X, User, MessageSquare, MessageCircle, Phone, Headphones, FileEdit, ExternalLink, Plus, Receipt, Navigation, Trash2, PoundSterling, MapPin } from 'lucide-react';
import { suggestCongestionCharge, CONGESTION_CHARGE, ULEZ_CHARGE } from '../lib/londonZones';
import usePushNotifications from '../hooks/usePushNotifications';
import { useLanguage } from '../context/LanguageContext';
import * as turf from '@turf/turf';
import { ArrowUp, CornerUpLeft, CornerUpRight, Map as MapIcon, CornerRightUp, CornerLeftUp } from 'lucide-react';
import DriverProfileDrawer from '../components/DriverProfileDrawer';
import FlightStatusCard from '../components/FlightStatusCard';
import GuestBrief from '../components/GuestBrief';
import RideChat from '../components/RideChat';
import OpsChat from '../components/OpsChat';
import { CONDUCT_VERSION, CONDUCT_TITLE, CONDUCT_INTRO, CONDUCT_BODY } from '../content/clientConduct';

const parseWKBPoint = (hex) => {
  if (!hex || hex.length < 42) return null;
  const xHex = hex.slice(-32, -16);
  const yHex = hex.slice(-16);
  const isLittleEndian = hex.substring(0, 2) === '01';
  const parseDouble = (h) => {
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      const byteHex = h.substring(i * 2, i * 2 + 2);
      bytes[isLittleEndian ? i : 7 - i] = parseInt(byteHex, 16);
    }
    const view = new DataView(bytes.buffer);
    return view.getFloat64(0, true);
  };
  try {
    return { lon: parseDouble(xHex), lat: parseDouble(yHex) };
  } catch(e) {
    return null;
  }
};

const extractCoords = (location) => {
  if (!location) return null;
  if (typeof location === 'string') {
    if (location.startsWith('POINT')) {
      const match = location.match(/POINT\s*\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)/i);
      if (match) return [parseFloat(match[2]), parseFloat(match[1])];
    } else {
      const wkb = parseWKBPoint(location);
      if (wkb) return [wkb.lat, wkb.lon];
    }
  } else if (location.coordinates) {
    return [location.coordinates[1], location.coordinates[0]];
  }
  return null;
};

const driverIcon = L.divIcon({
  className: 'custom-driver-marker',
  html: `<div style="position:relative;width:24px;height:24px;">
    <div style="position:absolute;inset:-12px;border:1px solid rgba(212,207,201,0.45);border-radius:50%;animation:elsPulse 2.5s ease-in-out infinite;"></div>
    <div style="width:24px;height:24px;background:#FFF;border-radius:50%;border:2px solid #D4CFC9;position:relative;z-index:2;"></div>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

const pickupIcon = L.divIcon({
  className: 'custom-pickup-marker',
  html: `<div style="width:16px;height:16px;background:#000;border-radius:50%;border:3px solid #D4CFC9;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

const dropoffIcon = L.divIcon({
  className: 'custom-dropoff-marker',
  html: `<div style="width:16px;height:16px;background:#FFF;border-radius:0;border:3px solid #000;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

function MapUpdater({ center, zoom }) {
  const map = useMap();
  useEffect(() => { map.setView(center, zoom ?? map.getZoom(), { animate: true }); }, [center, zoom, map]);
  return null;
}

// variant: 'primary' (white knob) | 'accent' (pale champagne knob) | 'danger' (white knob, red label text)
const SwipeButton = ({ text, onComplete, variant = 'primary', resetOnComplete = false }) => {
  const [isDone, setIsDone] = useState(false);
  const [endX, setEndX] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    if (resetOnComplete) setIsDone(false);
  }, [resetOnComplete, text]);

  const handleDragEnd = (event, info) => {
    if (containerRef.current) {
      const width = containerRef.current.offsetWidth;
      if (info.offset.x > width * 0.6) {
        setEndX(width - 52 - 6);
        setIsDone(true);
        Haptics.impact({ style: ImpactStyle.Heavy });
        onComplete();
      }
    }
  };

  const knobBg = '#000000'; // High contrast black
  const labelColor = '#000000';

  return (
    <div ref={containerRef} style={{ width: '100%', height: '72px', background: '#F8F8F8', border: '1px solid #E0E0E0', borderRadius: '16px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: labelColor, fontSize: '0.9rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', zIndex: 1, pointerEvents: 'none', paddingLeft: '72px', paddingRight: '16px', textAlign: 'center' }}>{isDone ? 'Confirmed' : text}</span>
      <motion.div
        drag={isDone ? false : 'x'}
        dragConstraints={containerRef}
        dragElastic={0.05}
        dragSnapToOrigin
        onDragEnd={handleDragEnd}
        animate={isDone ? { x: endX } : undefined}
        transition={{ type: 'tween', duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{ position: 'absolute', left: 4, top: 4, bottom: 4, width: '64px', background: knobBg, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', zIndex: 2 }}
        whileTap={{ cursor: 'grabbing' }}
      >
        {isDone ? <Check color="#D4CFC9" size={28} /> : <ChevronRight color="#D4CFC9" size={30} />}
      </motion.div>
    </div>
  );
};

// Opens the NATIVE iOS camera (UIImagePickerController) via a capture file
// input — no in-webview getUserMedia preview, so it looks and feels like the
// system camera. We only handle the upload once the driver taps "Use Video".
const VideoRecorderOverlay = ({ onUploadComplete, onClose }) => {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const openCamera = () => inputRef.current?.click();

  useEffect(() => {
    const input = inputRef.current;
    // Driver backed out of the native camera without recording
    const onCancel = () => { if (!input?.files?.length) onClose(); };
    input?.addEventListener('cancel', onCancel);
    openCamera();
    return () => input?.removeEventListener('cancel', onCancel);
  }, []);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return onClose();
    setUploading(true);
    const contentType = file.type || 'video/quicktime';
    const ext = contentType.includes('quicktime') ? 'mov'
      : contentType.includes('webm') ? 'webm'
      : (file.name?.split('.').pop()?.toLowerCase() || 'mp4');
    const fileName = `audit_${Date.now()}.${ext}`;
    try {
      const { error } = await supabase.storage.from('audits').upload(fileName, file, { contentType });
      if (error) throw error;
      const { data: publicUrl } = supabase.storage.from('audits').getPublicUrl(fileName);
      onUploadComplete(publicUrl.publicUrl);
    } catch (err) {
      alert("Upload failed: " + err.message);
      onClose();
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#F9F9F9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        capture="environment"
        onChange={handleFile}
        style={{ display: 'none' }}
      />
      {uploading ? (
        <>
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} style={{ width: '48px', height: '48px', border: '3px solid rgba(0,0,0,0.1)', borderTopColor: '#8A7355', borderRadius: '50%', marginBottom: '20px' }} />
          <div style={{ fontSize: '0.6875rem', letterSpacing: '3px', color: '#000', fontWeight: 600 }}>UPLOADING VIDEO</div>
          <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '8px' }}>Keep the app open</div>
        </>
      ) : (
        <>
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#FFF', border: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '18px' }}>
            <Video size={24} color="#8A7355" />
          </div>
          <div style={{ fontSize: '0.9375rem', color: '#000', fontWeight: 600, marginBottom: '6px' }}>Vehicle Condition Video</div>
          <div style={{ fontSize: '0.75rem', color: '#888', textAlign: 'center', lineHeight: 1.6, marginBottom: '28px' }}>
            Record a walkaround of the vehicle using the camera.
          </div>
          <button onClick={openCamera} style={{ padding: '16px 40px', background: '#000', borderRadius: '16px', color: '#FFF', fontWeight: 600, fontSize: '0.8125rem', letterSpacing: '2px', textTransform: 'uppercase', border: 'none' }}>Open Camera</button>
          <button onClick={onClose} style={{ marginTop: '14px', padding: '12px 40px', background: 'transparent', border: 'none', color: '#888', fontWeight: 500, fontSize: '0.875rem' }}>Cancel</button>
        </>
      )}
    </div>
  );
};

// Drivers reach dispatch on the office WhatsApp line (see OFFICE_WHATSAPP in
// lib/capacitor) — the landline is not monitored, so there is no OPS_PHONE.

  const NavigationMapUpdater = ({ center, heading, autoFollow }) => {
    const map = useMap();
    useEffect(() => {
      if (center && autoFollow) {
        map.setView(center, map.getZoom(), { animate: true });
      }
      // Apply rotation to the map container
      if (map.getContainer()) {
        map.getContainer().style.transform = `rotate(${-heading}deg)`;
        map.getContainer().style.transformOrigin = 'center center';
        map.getContainer().style.transition = 'transform 0.3s ease-out';
        // Make map larger to hide edges during rotation
        map.getContainer().style.width = '150%';
        map.getContainer().style.height = '150%';
        map.getContainer().style.marginLeft = '-25%';
        map.getContainer().style.marginTop = '-25%';
        map.invalidateSize();
      }
    }, [center, map, heading, autoFollow]);
    return null;
  };

export default function PlayerPortal() {
  const keyboardOverlap = useKeyboardOverlap();
  const { user, signOut } = useAuth();
  const { t } = useLanguage();
  const { location, hasFix, locating, requestPermission } = useLocation();
  const [shiftState, setShiftState] = useState('OFFLINE'); 
  const [activeRide, setActiveRide] = useState(null);
  const [shiftData, setShiftData] = useState({ carReg: '', hasProblem: false, needsFuel: false, videoUrl: null, preNotes: '' });
  const [videoRecorded, setVideoRecorded] = useState(false);
  const [showCameraFor, setShowCameraFor] = useState(null);
  const [postVideoUrl, setPostVideoUrl] = useState(null);
  const [postNotes, setPostNotes] = useState('');
  const [currentShiftId, setCurrentShiftId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [shiftHistory, setShiftHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [routeGeoJSON, setRouteGeoJSON] = useState(null);
  const [routeSteps, setRouteSteps] = useState([]);
  const [nextManeuver, setNextManeuver] = useState(null);
  const [mapHeading, setMapHeading] = useState(0);
  const [lastLocation, setLastLocation] = useState(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showOpsChat, setShowOpsChat] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [customLogText, setCustomLogText] = useState('');
  const [showTrips, setShowTrips] = useState(false);
  const [tripsHistory, setTripsHistory] = useState([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [systemNotification, setSystemNotification] = useState(null);
  const [activeAudit, setActiveAudit] = useState(null);
  const [driverProfile, setDriverProfile] = useState(undefined); // undefined = loading, null = no application on file (legacy)
  const [billingNotes, setBillingNotes] = useState('');
  // Expenses / charges the driver logs against the job (parking, congestion, etc.)
  const [showExpenseSheet, setShowExpenseSheet] = useState(false);
  const [expenseType, setExpenseType] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');
  const [expenseSaving, setExpenseSaving] = useState(false);
  // Navigation app chooser (Waze / Google / Apple)
  const [navTarget, setNavTarget] = useState(null);
  // The guest's standing preferences, for jobs whose manifest didn't carry them
  // (PA-booked journeys, and anything booked before preferences shipped).
  const [guestProfilePrefs, setGuestProfilePrefs] = useState(null);

  const getDistanceMiles = (a, b) => {
    const R = 3958.8; // Radius of the earth in miles
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLon = (b[1] - a[1]) * Math.PI / 180;
    const x = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(a[0]*Math.PI/180) * Math.cos(b[0]*Math.PI/180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  };

  const getETA = () => {
    if (!location || !activeRide) return null;
    const pickupCoords = extractCoords(activeRide.pickup_coords);
    const dropoffCoords = extractCoords(activeRide.dropoff_coords);
    
    let target = null;
    let label = '';
    
    if (['dispatched', 'en_route'].includes(activeRide.status) && pickupCoords) {
      target = pickupCoords;
      label = 'ETA to Pickup';
    } else if (activeRide.status === 'in_progress' && dropoffCoords) {
      target = dropoffCoords;
      label = 'ETA to Dropoff';
    }
    
    if (!target) return null;
    
    const distMiles = getDistanceMiles(location, target);
    const hours = distMiles / 20; // 20 mph avg city speed
    const mins = Math.ceil(hours * 60);
    return { mins, distMiles, label };
  };

  // Legacy drivers without an application row are treated as approved
  const isApproved = driverProfile === undefined || driverProfile === null || driverProfile.status === 'approved';

  const handleLogEvent = async (eventText) => {
    triggerHaptic();
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        message: eventText,
        location: location, // [lat, lng] from useLocation hook
        driver_id: user?.id
      };

      if (activeRide) {
        const auditLogs = activeRide.metadata?.audit_logs || [];
        const newMetadata = { ...activeRide.metadata, audit_logs: [...auditLogs, logEntry] };
        await supabase.from('rides').update({ metadata: newMetadata }).eq('id', activeRide.id);
        setActiveRide(prev => ({ ...prev, metadata: newMetadata }));
      } else if (currentShiftId) {
        const { data: shift } = await supabase.from('driver_shifts').select('metadata').eq('id', currentShiftId).single();
        const auditLogs = shift?.metadata?.audit_logs || [];
        const newMetadata = { ...shift?.metadata, audit_logs: [...auditLogs, logEntry] };
        await supabase.from('driver_shifts').update({ metadata: newMetadata }).eq('id', currentShiftId);
      }
      
      triggerHaptic(ImpactStyle.Light);
      // Optional: alert('Event Logged');
    } catch (err) {
      console.error('Failed to log event', err);
    }
  };
  
  usePushNotifications();
  useBackgroundLocation(shiftState === 'ONLINE', activeRide?.id);

  // Fetch Route from OSRM
  useEffect(() => {
    if (!activeRide || !location) return;
    const isDispatched = activeRide.status === 'dispatched';
    const isEnRoute = activeRide.status === 'en_route';
    const isInProgress = activeRide.status === 'in_progress';
    
    let targetCoords = null;
    if ((isDispatched || isEnRoute) && activeRide.pickup_coords) {
      targetCoords = extractCoords(activeRide.pickup_coords);
    } else if (isInProgress && activeRide.dropoff_coords) {
      targetCoords = extractCoords(activeRide.dropoff_coords);
    }

    if (targetCoords) {
      // Avoid refetching if target hasn't changed (simplified for MVP)
      const fetchRoute = async () => {
        try {
          const url = `https://router.project-osrm.org/route/v1/driving/${location[1]},${location[0]};${targetCoords[1]},${targetCoords[0]}?overview=full&geometries=geojson&steps=true`;
          const response = await fetch(url);
          const data = await response.json();
          if (data.routes && data.routes.length > 0) {
            setRouteGeoJSON(data.routes[0].geometry);
            setRouteSteps(data.routes[0].legs[0].steps);
          }
        } catch (error) {
          console.error("OSRM Routing Error:", error);
        }
      };
      
      // Basic debounce/fetch constraint to avoid spamming OSRM
      if (!routeGeoJSON) {
        fetchRoute();
      }
    } else {
      setRouteGeoJSON(null);
      setRouteSteps([]);
      setNextManeuver(null);
    }
  }, [activeRide?.status, activeRide?.id, location, routeGeoJSON]);

  // Calculate Map Heading and Next Maneuver
  useEffect(() => {
    if (location && lastLocation) {
      // Calculate bearing between last and current location
      const p1 = turf.point([lastLocation[1], lastLocation[0]]);
      const p2 = turf.point([location[1], location[0]]);
      const dist = turf.distance(p1, p2, { units: 'meters' });
      if (dist > 2) { // Only update heading if moved > 2 meters
        const bearing = turf.bearing(p1, p2);
        setMapHeading(bearing);
      }
    }
    setLastLocation(location);

    if (location && routeSteps.length > 0 && routeGeoJSON) {
      const currentPt = turf.point([location[1], location[0]]);
      
      // Find the next step the driver is approaching
      // In a real app we'd map-match properly, but for MVP we find the active step
      // by finding the closest step maneuver point.
      let closestStep = null;
      let minDistance = Infinity;
      
      for (let i = 0; i < routeSteps.length; i++) {
        const step = routeSteps[i];
        if (step.maneuver && step.maneuver.location) {
          const stepPt = turf.point(step.maneuver.location);
          const dist = turf.distance(currentPt, stepPt, { units: 'miles' });
          
          if (dist < minDistance && dist > 0.01) { // Skip if we are right on top of it (passed it)
            minDistance = dist;
            closestStep = step;
          }
        }
      }

      if (closestStep) {
        // Convert distance to feet if under 0.1 miles
        let distText = `${minDistance.toFixed(1)} mi`;
        if (minDistance < 0.1) {
          distText = `${Math.round(minDistance * 5280)} ft`;
        }

        let icon = <ArrowUp size={32} color="#FFF" />;
        const mod = closestStep.maneuver.modifier;
        if (mod && mod.includes('left')) icon = <CornerUpLeft size={32} color="#FFF" />;
        if (mod && mod.includes('right')) icon = <CornerUpRight size={32} color="#FFF" />;

        setNextManeuver({
          instruction: closestStep.name || closestStep.maneuver.type,
          distance: distText,
          icon
        });
      }
    }
  }, [location]);


  useEffect(() => {
    // Location permission + first fix are handled by useLocation on mount.
    const checkState = async () => {
      // Driver application / ELS plate / driving profile
      const { data: profile } = await supabase.from('driver_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      setDriverProfile(profile || null);

      const { data: ride } = await supabase.from('rides')
        .select('*')
        .eq('driver_id', user.id)
        .in('status', ['dispatched', 'en_route', 'arrived', 'in_progress'])
        .maybeSingle();
      if (ride) {
        setActiveRide(ride);
        setShiftState('ONLINE');
      }

      // Restore active shift if the driver hasn't ended it
      const { data: shift } = await supabase.from('driver_shifts')
        .select('id')
        .eq('driver_id', user.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
        
      if (shift) {
        setCurrentShiftId(shift.id);
        setShiftState('ONLINE');
      }
    };
    if (user) checkState();

    // Jobs are assigned by ELS Operations — the app only reacts to rides
    // dispatched to this driver. There is no accept/decline.
    const channel = supabase.channel('driver-ride')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setActiveRide(prev => prev?.id === payload.old.id ? null : prev);
          return;
        }

        const ride = payload.new;
        if (!ride || ride.driver_id !== user?.id) return;

        if (['completed', 'cancelled'].includes(ride.status)) {
          setActiveRide(null);
        } else {
          setActiveRide(ride);
          // New job assigned to this driver — strong haptic alert
          if (payload.eventType === 'INSERT' || (payload.old?.driver_id !== ride.driver_id) || (payload.old?.status !== ride.status && ride.status === 'dispatched')) {
            try {
              Haptics.impact({ style: ImpactStyle.Heavy });
              setTimeout(() => Haptics.impact({ style: ImpactStyle.Heavy }), 200);
              setTimeout(() => Haptics.impact({ style: ImpactStyle.Heavy }), 400);
            } catch(e) {}
          }
        }
      })
      // Live updates to the driver's own application (approval, ELS plate issue)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_profiles', filter: `user_id=eq.${user?.id}` }, (payload) => {
        if (payload.eventType === 'DELETE') return;
        setDriverProfile(payload.new);
        if (payload.old?.status !== payload.new?.status || payload.old?.els_plate !== payload.new?.els_plate) {
          try { Haptics.impact({ style: ImpactStyle.Heavy }); } catch(e) {}
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Realtime Chat Notifications
  useEffect(() => {
    if (!activeRide?.id) return;
    const chatChannel = supabase.channel(`portal-chat-${activeRide.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${activeRide.id}` }, (payload) => {
        if (payload.new.sender_id !== user?.id) {
          triggerHaptic(ImpactStyle.Heavy);
          if (!showChat) {
            setUnreadMessages(prev => prev + 1);
            setSystemNotification({ type: 'passenger', title: 'New Message', message: payload.new.message });
            setTimeout(() => setSystemNotification(null), 4000);
            
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('Passenger Message', { body: payload.new.message });
            } else if ('Notification' in window && Notification.permission !== 'denied') {
              Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                  new Notification('Passenger Message', { body: payload.new.message });
                }
              });
            }
          }
        }
      }).subscribe();
      
    return () => { supabase.removeChannel(chatChannel); };
  }, [activeRide?.id, showChat, user?.id]);

  // Realtime Ops Chat Notifications
  useEffect(() => {
    if (!user?.id) return;
    const opsChannel = supabase.channel(`portal-ops-chat-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${user.id}` }, (payload) => {
        if (payload.new.sender_id !== user.id) {
          triggerHaptic(ImpactStyle.Heavy);
          if (!showOpsChat) {
            setSystemNotification({ type: 'ops', title: 'Operations Message', message: payload.new.content });
            setTimeout(() => setSystemNotification(null), 4000);
            
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('Operations', { body: payload.new.content });
            } else if ('Notification' in window && Notification.permission !== 'denied') {
              Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                  new Notification('Operations', { body: payload.new.content });
                }
              });
            }
          }
        }
      }).subscribe();
      
    return () => { supabase.removeChannel(opsChannel); };
  }, [user?.id, showOpsChat]);

  // Route change notification
  const prevRideRef = useRef();
  useEffect(() => {
    if (prevRideRef.current && activeRide) {
      const oldRide = prevRideRef.current;
      const newRide = activeRide;
      
      let routeChanged = false;
      let changeMessage = '';
      
      if (oldRide.dropoff_address !== newRide.dropoff_address && newRide.dropoff_address) {
        routeChanged = true;
        changeMessage = `Destination: ${newRide.dropoff_address}`;
      } else if (JSON.stringify(oldRide.waypoints || oldRide.metadata?.waypoints) !== JSON.stringify(newRide.waypoints || newRide.metadata?.waypoints)) {
        routeChanged = true;
        changeMessage = 'Waypoints updated';
      }
      
      if (routeChanged) {
        triggerHaptic(ImpactStyle.Heavy);
        setSystemNotification({ type: 'route', title: 'Route Updated', message: changeMessage });
        setTimeout(() => setSystemNotification(null), 4000);
        
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Route Updated', { body: changeMessage });
        } else if ('Notification' in window && Notification.permission !== 'denied') {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              new Notification('Route Updated', { body: changeMessage });
            }
          });
        }
      }
    }
    prevRideRef.current = activeRide;
  }, [activeRide]);

  const triggerHaptic = (style = ImpactStyle.Medium) => {
    try { Haptics.impact({ style }); } catch(e){}
  };

  // Standing preferences for the guest on this job. The manifest is the source
  // of truth when it carries them (the guest can change those mid-journey);
  // this only fills the gaps for jobs booked without a preference block.
  useEffect(() => {
    if (!activeRide?.id) { setGuestProfilePrefs(null); return; }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_ride_guest_preferences', { p_ride_id: activeRide.id });
      if (cancelled || error || !data) return;
      setGuestProfilePrefs(data);
    })();

    return () => { cancelled = true; };
  }, [activeRide?.id]);

  // Journey-specific choices win over the guest's saved defaults.
  const guestPreferences = useMemo(
    () => ({ ...(guestProfilePrefs || {}), ...(activeRide?.metadata?.preferences || {}) }),
    [guestProfilePrefs, activeRide?.metadata?.preferences]
  );

  // Pre-fill the shift registration with the issued ELS plate (or the
  // driver's own registered vehicle) so onboarding stays effortless
  useEffect(() => {
    const reg = driverProfile?.els_plate || driverProfile?.vehicle_reg;
    if (reg) setShiftData(prev => prev.carReg ? prev : { ...prev, carReg: reg });
  }, [driverProfile]);

  const handleStartShift = async () => {
    // Power-up haptic sequence
    try {
      Haptics.impact({ style: ImpactStyle.Heavy });
      setTimeout(() => Haptics.impact({ style: ImpactStyle.Medium }), 120);
      setTimeout(() => Haptics.impact({ style: ImpactStyle.Light }), 240);
      setTimeout(() => Haptics.impact({ style: ImpactStyle.Heavy }), 400);
    } catch(e) {}

    try {
      const { data, error } = await supabase.from('driver_shifts').insert({
        driver_id: user.id,
        car_reg: shiftData.carReg,
        has_problem: shiftData.hasProblem,
        needs_fuel: shiftData.needsFuel,
        pre_shift_video_url: shiftData.videoUrl,
        pre_notes: shiftData.preNotes || null,
        started_at: new Date().toISOString()
      }).select('id').single();
      if (data) setCurrentShiftId(data.id);
    } catch(e) {}
    setShiftState('ONLINE');
  };

  const handleEndShift = async () => {
    if (currentShiftId) {
      await supabase.from('driver_shifts').update({
        ended_at: new Date().toISOString(),
        post_shift_video_url: postVideoUrl,
        post_notes: postNotes || null
      }).eq('id', currentShiftId);
    }
    setShiftState('OFFLINE');
    setShiftData({ carReg: '', hasProblem: false, needsFuel: false, videoUrl: null, preNotes: '' });
    setVideoRecorded(false);
    setPostVideoUrl(null);
    setPostNotes('');
    setCurrentShiftId(null);
  };

  const logSystemAudit = async (status) => {
    if (!activeRide || !user) return;
    try {
      await supabase.from('ride_messages').insert({
        ride_id: activeRide.id,
        sender_id: user.id,
        sender_role: 'driver',
        message: `[SYSTEM] Status updated: ${status}`
      });
      triggerHaptic(ImpactStyle.Light);
    } catch (err) {
      console.warn('Failed to audit status update:', err);
    }
  };

  // Driver accepts the Client Conduct condition for this specific booking,
  // before any client/route details are revealed. Recorded per-ride.
  const acknowledgeConduct = async () => {
    if (!activeRide) return;
    triggerHaptic(ImpactStyle.Medium);

    const ackedAt = new Date().toISOString();
    const auditLogs = activeRide.metadata?.audit_logs || [];
    const newMetadata = {
      ...activeRide.metadata,
      conduct_acknowledged_at: ackedAt,
      conduct_version: CONDUCT_VERSION,
      audit_logs: [...auditLogs, {
        timestamp: ackedAt,
        message: `Driver accepted Client Conduct (v${CONDUCT_VERSION})`,
        location,
        driver_id: user?.id
      }]
    };

    // Optimistic local reveal, then persist
    setActiveRide(prev => (prev ? { ...prev, metadata: newMetadata } : prev));
    try {
      await supabase.from('rides').update({ metadata: newMetadata }).eq('id', activeRide.id);
    } catch (err) {
      console.warn('Failed to record conduct acknowledgment:', err);
    }
  };

  const updateRideStatus = async (status) => {
    if (!activeRide) return;

    let extraPayload = {};
    if (status === 'arrived') {
      extraPayload.arrived_at = new Date().toISOString();
      
      // Auto arrival message:
      try {
        await supabase.from('ride_messages').insert({
          ride_id: activeRide.id,
          sender_id: user.id,
          sender_role: 'driver',
          message: "I am outside"
        });
      } catch (err) {
        console.warn('Failed to send arrival message:', err);
      }
    } else if (status === 'in_progress') {
      const pobTime = new Date().toISOString();
      extraPayload.pob_at = pobTime;
      
      // Calculate wait time
      const arrivedTime = activeRide.arrived_at ? new Date(activeRide.arrived_at) : new Date();
      const waitTime = Math.max(0, Math.round((new Date(pobTime) - arrivedTime) / 60000));
      extraPayload.wait_time_mins = waitTime;
      extraPayload.total_waiting_time_mins = waitTime;
    } else if (status === 'completed') {
      extraPayload.dropoff_at = new Date().toISOString();

      // Automatically calculate route distance via OSRM
      if (activeRide.pickup_coords && activeRide.dropoff_coords) {
        try {
          const parseCoords = (c) => {
            if (typeof c === 'string') return c.split(',');
            if (c && c.lat) return [c.lat, c.lng];
            return null;
          };
          const p = parseCoords(activeRide.pickup_coords);
          const d = parseCoords(activeRide.dropoff_coords);
          
          if (p && d) {
            // OSRM requires longitude,latitude
            const url = `https://router.project-osrm.org/route/v1/driving/${p[1]},${p[0]};${d[1]},${d[0]}?overview=false`;
            const res = await fetch(url);
            const data = await res.json();
            if (data?.routes?.[0]) {
              const miles = (data.routes[0].distance * 0.000621371).toFixed(2);
              extraPayload.distance_miles = parseFloat(miles);
              extraPayload.total_mileage = parseFloat(miles);
            }
          }
        } catch (e) {
          console.warn('Failed to calculate automated distance:', e);
        }
      }
    }

    const currentMetadata = activeRide.metadata || {};
    const newMetadata = {
      ...currentMetadata,
      ...(billingNotes ? { billing_notes: billingNotes } : {})
    };
    
    const updatePayload = { 
      status,
      driver_name: user?.user_metadata?.full_name || 'Driver Assigned',
      vehicle_reg: shiftData.carReg || driverProfile?.els_plate || driverProfile?.vehicle_reg || '',
      metadata: newMetadata,
      // Log when the driver first responds to an assigned job
      ...(status === 'en_route' && !activeRide.acknowledged_at ? { acknowledged_at: new Date().toISOString() } : {}),
      ...extraPayload
    };
    
    await supabase.from('rides').update(updatePayload).eq('id', activeRide.id);
    
    if (status === 'completed' || status === 'cancelled') {
      setActiveRide(null);
      setBillingNotes('');
    } else {
      setActiveRide({ ...activeRide, ...updatePayload });
    }
  };

  // Geofence Auto-Arrive logic
  useEffect(() => {
    if (activeRide?.status === 'en_route' && activeRide.pickup_coords && location) {
      const pickupCoords = extractCoords(activeRide.pickup_coords);
      if (pickupCoords) {
        const dist = getDistanceMiles(location, pickupCoords);
        if (dist < 0.1) {
          updateRideStatus('arrived');
          logSystemAudit('Auto-arrived via geofence');
        }
      }
    }
  }, [location, activeRide?.status, activeRide?.pickup_coords]);

  // Persist an expense onto the ride's metadata so ops can review it later.
  const addExpense = async (type, amount, note = '') => {
    if (!activeRide) return;
    const value = parseFloat(amount);
    if (!type || !Number.isFinite(value) || value <= 0) return;
    setExpenseSaving(true);
    const entry = {
      id: `exp-${Date.now()}`,
      type,
      amount: Math.round(value * 100) / 100,
      note: note.trim() || null,
      added_at: new Date().toISOString(),
      added_by: user?.user_metadata?.full_name || 'Driver'
    };
    const currentMeta = activeRide.metadata || {};
    const newMeta = { ...currentMeta, expenses: [...(currentMeta.expenses || []), entry] };
    try {
      await supabase.from('rides').update({ metadata: newMeta }).eq('id', activeRide.id);
      setActiveRide(prev => ({ ...prev, metadata: newMeta }));
      logSystemAudit(`Expense added: ${type} £${entry.amount.toFixed(2)}`);
      triggerHaptic(ImpactStyle.Medium);
      setShowExpenseSheet(false);
      setExpenseType(''); setExpenseAmount(''); setExpenseNote('');
    } catch (e) {
      console.warn('Failed to add expense:', e?.message || e);
    } finally {
      setExpenseSaving(false);
    }
  };

  const removeExpense = async (id) => {
    if (!activeRide) return;
    const currentMeta = activeRide.metadata || {};
    const newMeta = { ...currentMeta, expenses: (currentMeta.expenses || []).filter(e => e.id !== id) };
    try {
      await supabase.from('rides').update({ metadata: newMeta }).eq('id', activeRide.id);
      setActiveRide(prev => ({ ...prev, metadata: newMeta }));
      triggerHaptic(ImpactStyle.Light);
    } catch (e) {
      console.warn('Failed to remove expense:', e?.message || e);
    }
  };

  const contactOps = () => {
    triggerHaptic(ImpactStyle.Light);
    handleLogEvent('Driver contacted Operations');
    openWhatsApp();
  };

  const regIsValid = shiftData.carReg.trim().length >= 2;

  const renderPreShift = () => (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Section header */}
      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 }}>
        <h3 style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: '#8A7355' }}>{t('preShiftCheck')}</h3>
        <p style={{ fontSize: '0.8125rem', color: '#666', marginTop: '6px', marginBottom: 0 }}>{t('completeAllItems')}</p>
      </motion.div>

      {/* Registration — MANDATORY */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 25 }}>
        <div style={{ background: 'rgba(0,0,0,0.04)', border: regIsValid ? '1px solid rgba(212,207,201,0.35)' : '1px solid rgba(0,0,0,0.1)', borderRadius: '12px', padding: '20px', transition: 'border-color 0.3s ease' }}>
          <label style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '2px', color: regIsValid ? '#8A7355' : '#888', marginBottom: '10px', display: 'block', textTransform: 'uppercase', transition: 'color 0.3s' }}>{t('vehicleReg')} *</label>
          <input 
            type="text" 
            placeholder={t('regPlaceholder')} 
            value={shiftData.carReg} 
            onChange={e => setShiftData({...shiftData, carReg: e.target.value.toUpperCase()})} 
            style={{ width: '100%', padding: '0', background: 'transparent', color: '#000', border: 'none', fontSize: '1.6rem', fontWeight: 600, letterSpacing: '3px', outline: 'none', fontFamily: 'var(--font-family)', textTransform: 'uppercase' }} 
          />
          {!regIsValid && <p style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: '8px', marginBottom: 0 }}>{t('regRequired')}</p>}
        </div>
      </motion.div>

      {/* Car Problem */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, type: 'spring', stiffness: 400, damping: 25 }}>
        <div style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '12px', padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '40px', height: '40px', background: shiftData.hasProblem ? 'rgba(239,68,68,0.12)' : 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.3s' }}>
              <AlertTriangle size={18} color={shiftData.hasProblem ? '#EF4444' : '#888'} />
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: '0.875rem', color: '#000' }}>{t('carProblem')}</div>
              <div style={{ fontSize: '0.6875rem', color: '#666' }}>{t('reportIssues')}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => { triggerHaptic(); setShiftData({...shiftData, hasProblem: true}); }} style={{ padding: '10px 18px', borderRadius: '8px', background: shiftData.hasProblem ? '#000' : 'transparent', border: shiftData.hasProblem ? '1px solid #000' : '1px solid rgba(0,0,0,0.1)', color: shiftData.hasProblem ? '#FFF' : '#888', fontWeight: 600, fontSize: '0.75rem', letterSpacing: '1px', textTransform: 'uppercase', transition: 'background 0.25s, color 0.25s' }}>{t('yes')}</motion.button>
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => { triggerHaptic(); setShiftData({...shiftData, hasProblem: false}); }} style={{ padding: '10px 18px', borderRadius: '8px', background: !shiftData.hasProblem ? '#000' : 'transparent', border: !shiftData.hasProblem ? '1px solid #000' : '1px solid rgba(0,0,0,0.1)', color: !shiftData.hasProblem ? '#FFF' : '#888', fontWeight: 600, fontSize: '0.75rem', letterSpacing: '1px', textTransform: 'uppercase', transition: 'background 0.25s, color 0.25s' }}>{t('no')}</motion.button>
          </div>
        </div>
      </motion.div>

      {/* Needs Fuel */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26, type: 'spring', stiffness: 400, damping: 25 }}>
        <div style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '12px', padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '40px', height: '40px', background: shiftData.needsFuel ? 'rgba(245,158,11,0.12)' : 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.3s' }}>
              <Fuel size={18} color={shiftData.needsFuel ? '#F59E0B' : '#888'} />
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: '0.875rem', color: '#000' }}>{t('needsFuel')}</div>
              <div style={{ fontSize: '0.6875rem', color: '#666' }}>{t('checkFuelLevel')}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => { triggerHaptic(); setShiftData({...shiftData, needsFuel: true}); }} style={{ padding: '10px 18px', borderRadius: '8px', background: shiftData.needsFuel ? '#000' : 'transparent', border: shiftData.needsFuel ? '1px solid #000' : '1px solid rgba(0,0,0,0.1)', color: shiftData.needsFuel ? '#FFF' : '#888', fontWeight: 600, fontSize: '0.75rem', letterSpacing: '1px', textTransform: 'uppercase', transition: 'background 0.25s, color 0.25s' }}>{t('yes')}</motion.button>
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => { triggerHaptic(); setShiftData({...shiftData, needsFuel: false}); }} style={{ padding: '10px 18px', borderRadius: '8px', background: !shiftData.needsFuel ? '#000' : 'transparent', border: !shiftData.needsFuel ? '1px solid #000' : '1px solid rgba(0,0,0,0.1)', color: !shiftData.needsFuel ? '#FFF' : '#888', fontWeight: 600, fontSize: '0.75rem', letterSpacing: '1px', textTransform: 'uppercase', transition: 'background 0.25s, color 0.25s' }}>{t('no')}</motion.button>
          </div>
        </div>
      </motion.div>

      {/* Vehicle Recording — MANDATORY */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34, type: 'spring', stiffness: 400, damping: 25 }}>
        <motion.button 
          whileTap={{ scale: 0.97 }}
          onClick={() => { triggerHaptic(); setShowCameraFor('pre'); }} 
          style={{ width: '100%', padding: '20px', background: videoRecorded ? 'rgba(138,115,85,0.08)' : 'rgba(0,0,0,0.04)', border: videoRecorded ? '1px solid rgba(138,115,85,0.4)' : '1px solid rgba(0,0,0,0.08)', borderRadius: '12px', color: videoRecorded ? '#8A7355' : '#000', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', fontWeight: 500, fontSize: '0.8125rem', letterSpacing: '1px', textTransform: 'uppercase', transition: '0.3s' }}
        >
          {videoRecorded ? <Check size={18} color="#8A7355" /> : <Camera size={18} />}
          {videoRecorded ? t('vehicleScanSaved') : t('recordWalkAround') + ' *'}
        </motion.button>
        {!videoRecorded && <p style={{ fontSize: '0.75rem', color: '#EF4444', marginTop: '8px', marginBottom: 0, textAlign: 'center' }}>{t('vehicleRecordingRequired')}</p>}
      </motion.div>

      {/* Notes — optional */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38, type: 'spring', stiffness: 400, damping: 25 }}>
        <div style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '12px', padding: '20px' }}>
          <label style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '2px', color: '#888', marginBottom: '10px', display: 'block', textTransform: 'uppercase' }}>{t('notesOptional')}</label>
          <textarea 
            placeholder={t('preNotesPlaceholder')} 
            value={shiftData.preNotes} 
            onChange={e => setShiftData({...shiftData, preNotes: e.target.value})}
            rows={3}
            style={{ width: '100%', background: 'transparent', color: '#000', border: 'none', fontSize: '0.95rem', outline: 'none', resize: 'none', lineHeight: 1.5, fontFamily: 'inherit' }}
          />
        </div>
      </motion.div>

      {/* Start Shift — blocked if no reg OR no video */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.46, type: 'spring', stiffness: 400, damping: 25 }} style={{ marginTop: '8px' }}>
        {regIsValid && videoRecorded ? (
          <SwipeButton text={t('goOnlineBtn')} variant="accent" onComplete={handleStartShift} />
        ) : (
          <div style={{ width: '100%', height: '60px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,0.06)' }}>
            <span style={{ color: '#555', fontWeight: 600, letterSpacing: '2px', fontSize: '0.6875rem', textTransform: 'uppercase' }}>
              {!regIsValid ? t('enterRegToContinue') : t('recordVehicleToContinue')}
            </span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );

  const renderActiveJob = () => {
    if (!activeRide) return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: 'easeOut' }} style={{ textAlign: 'center', padding: '10px 0 30px' }}>
        <div style={{ padding: '24px 0 36px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Quiet champagne pulse */}
          <div style={{ position: 'relative', width: '56px', height: '56px', marginBottom: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(212,207,201,0.45)', animation: 'elsPulse 3s ease-in-out infinite' }} />
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#D4CFC9' }} />
          </div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
            <h3 style={{ fontSize: '0.625rem', fontWeight: 600, color: '#8A7355', letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '12px' }}>On Duty</h3>
            <p style={{ color: '#000', fontSize: '1.375rem', fontWeight: 300, fontFamily: 'var(--font-display), serif', letterSpacing: '0.3px', marginBottom: '8px' }}>
              Awaiting your next assignment
            </p>
            <p style={{ color: '#555', fontSize: '0.6875rem', letterSpacing: '0.5px', marginBottom: 0 }}>
              Jobs are dispatched by ELS Operations
            </p>
          </motion.div>
        </div>
      </motion.div>
    );

    // Resolve a tap into a nav target, then hand off to the chosen map app.
    // Prefers a remembered app; otherwise opens the chooser (Waze default).
    const openNavigation = (address, coords = null) => {
      const parsed = extractCoords(coords); // [lat, lng] or null
      const label = (address && address !== 'As directed' && address !== 'Current Location') ? address : 'Destination';

      if (!parsed && (!address || address === 'As directed' || address === 'Current Location')) return;

      triggerHaptic(ImpactStyle.Light);
      setNavTarget({ label, lat: parsed?.[0] ?? null, lng: parsed?.[1] ?? null, address });
    };

    const launchNav = (app, target) => {
      if (!target) return;
      const hasCoords = Number.isFinite(target.lat) && Number.isFinite(target.lng);
      const ll = hasCoords ? `${target.lat},${target.lng}` : '';
      const q = hasCoords ? ll : encodeURIComponent(target.address || target.label);
      let url;
      if (app === 'waze') {
        url = hasCoords ? `https://waze.com/ul?ll=${ll}&navigate=yes` : `https://waze.com/ul?q=${q}&navigate=yes`;
      } else if (app === 'google') {
        url = hasCoords
          ? `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`
          : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
      } else { // apple
        url = hasCoords ? `maps://?daddr=${ll}&dirflg=d` : `maps://?daddr=${q}&dirflg=d`;
      }
      window.open(url, '_system');
      setNavTarget(null);
    };

    const isDispatched = activeRide.status === 'dispatched';
    const isEnRoute = activeRide.status === 'en_route';
    const isArrived = activeRide.status === 'arrived';
    const isInProgress = activeRide.status === 'in_progress';

    // Client Conduct gate — a freshly dispatched job stays hidden until the
    // driver accepts the conduct condition. Acknowledged jobs (and jobs already
    // in progress) skip straight to the booking details.
    const conductAcknowledged = !!activeRide.metadata?.conduct_acknowledged_at;
    if (isDispatched && !conductAcknowledged) {
      return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Status Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4CAF50', animation: 'elsPulse 2s ease-in-out infinite' }} />
            <span style={{ fontSize: '0.6875rem', fontWeight: 500, letterSpacing: '2px', color: '#666', textTransform: 'uppercase' }}>
              New Booking
            </span>
          </div>

          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 300, color: '#000', margin: '0 0 8px 0', fontFamily: 'var(--font-display), serif', letterSpacing: '-0.2px' }}>
              {CONDUCT_TITLE}
            </h1>
            <p style={{ fontSize: '0.8125rem', color: '#888', margin: 0, lineHeight: 1.6 }}>
              {CONDUCT_INTRO}
            </p>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '14px', padding: '20px' }}>
            {CONDUCT_BODY.map((para, i) => (
              <p key={i} style={{ fontSize: '0.8125rem', color: '#333', lineHeight: 1.7, margin: i === 0 ? '0 0 14px' : 0 }}>
                {para}
              </p>
            ))}
          </div>

          <SwipeButton
            text="Accept & View Booking"
            variant="accent"
            onComplete={acknowledgeConduct}
          />

          {/* Problem with this job? — Operations contact, same as the booking view */}
          <div style={{ marginTop: '4px' }}>
            <div style={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '1.5px', color: '#666', textTransform: 'uppercase', marginBottom: '10px' }}>
              Problem with this job?
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={contactOps}
                style={{ flex: 1, height: '48px', background: 'transparent', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '12px', color: '#000', display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }}
              >
                <MessageCircle size={15} /> WhatsApp Office
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => { triggerHaptic(); handleLogEvent('Driver messaged Operations'); setShowOpsChat(true); }}
                style={{ flex: 1, height: '48px', background: 'transparent', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '12px', color: '#000', display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }}
              >
                <Headphones size={15} /> Message Ops
              </motion.button>
            </div>
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Status Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: '#4CAF50',
            animation: 'elsPulse 2s ease-in-out infinite'
          }} />
          <span style={{ fontSize: '0.6875rem', fontWeight: 500, letterSpacing: '2px', color: '#666', textTransform: 'uppercase' }}>
            {isDispatched ? 'Job Assigned' : isEnRoute ? 'En Route to Client' : isArrived ? 'Client Approaching' : 'Journey in Progress'}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: '0.5625rem', letterSpacing: '2px', color: '#444', textTransform: 'uppercase' }}>
            {activeRide.service_type === 'by_the_hour' ? 'HOURLY' : 'ONE WAY'}
          </span>
        </div>

        {/* Real-time ETA for Driver */}
        {(() => {
          const etaData = getETA();
          if (!etaData) return null;
          return (
            <div style={{ display: 'flex', gap: '16px', background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '12px', padding: '12px 16px', marginTop: '-8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.5625rem', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '2px' }}>{etaData.label}</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: '#000', fontFamily: 'var(--font-family)' }}>
                  {etaData.mins}<span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#888' }}> min</span>
                </div>
              </div>
              <div style={{ width: '1px', background: 'rgba(0,0,0,0.08)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.5625rem', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '2px' }}>Distance</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: '#000', fontFamily: 'var(--font-family)' }}>
                  {etaData.distMiles.toFixed(1)}<span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#888' }}> mi</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Client & Route Details */}
        <div>
          <div style={{ fontSize: '0.8rem', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>Client</div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#000', margin: '0 0 16px 0', fontFamily: 'var(--font-family)', lineHeight: 1.4 }}>
            {activeRide.passenger_name || activeRide.metadata?.client_name || 'Client'}
          </h1>

          {/* Pickup time shown to the driver 15 min ahead of the real booking
              time — buffer so they arrive early. Real time is unchanged for
              the client, billing and ops. */}
          {(() => {
            if (!activeRide.scheduled_at) return null;
            const real = new Date(activeRide.scheduled_at);
            if (isNaN(real.getTime())) return null;
            const shown = new Date(real.getTime() - 15 * 60 * 1000);
            return (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(138,115,85,0.08)', border: '1px solid rgba(138,115,85,0.3)', borderRadius: '10px', padding: '8px 14px', marginBottom: '16px' }}>
                <Clock size={14} color="#8A7355" />
                <span style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#8A7355' }}>Pickup</span>
                <span style={{ fontSize: '1rem', fontWeight: 700, color: '#000', fontFamily: 'var(--font-display), serif' }}>
                  {shown.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ fontSize: '0.625rem', color: '#999' }}>
                  · {shown.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            );
          })()}

          {/* Live flight status — airport pickups only */}
          {activeRide.metadata?.flight_number && (
            <div style={{ marginBottom: '16px' }}>
              <FlightStatusCard flightNumber={activeRide.metadata.flight_number} pickupTime={activeRide.scheduled_at} />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
            <div style={{ position: 'absolute', left: '7px', top: '24px', bottom: '24px', width: '1px', background: 'rgba(0,0,0,0.1)' }} />
            
            <div onClick={() => openNavigation(activeRide.pickup_address, activeRide.pickup_coords)} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', cursor: 'pointer' }}>
              <div style={{ width: '15px', height: '15px', borderRadius: '50%', background: '#000', border: '3px solid #D4CFC9', zIndex: 1, marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: '0.8rem', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>Pickup</div>
                <div style={{ fontSize: '1.25rem', color: '#000', fontWeight: 600, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {activeRide.pickup_address} <ExternalLink size={16} color="#666" />
                </div>
              </div>
            </div>

            {/* Waypoints */}
            {(activeRide?.waypoints || activeRide?.metadata?.waypoints || []).map((w, index) => {
              const currentStopIndex = activeRide?.metadata?.current_stop_index || 0;
              const isPast = index < currentStopIndex;
              return (
                <div key={index} onClick={() => openNavigation(w.name, `${w.lat},${w.lon}`)} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', cursor: 'pointer', opacity: isPast ? 0.4 : 1 }}>
                  <div style={{ width: '15px', height: '15px', borderRadius: '50%', background: isPast ? '#555' : '#D4CFC9', border: isPast ? '3px solid #EBEBEB' : '3px solid #888', zIndex: 1, marginTop: '2px' }} />
                  <div>
                    <div style={{ fontSize: '0.65rem', color: '#666', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>Stop {index + 1}</div>
                    <div style={{ fontSize: '1.0625rem', color: '#000', fontWeight: 500, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {w.name} <ExternalLink size={13} color="#666" />
                    </div>
                  </div>
                </div>
              );
            })}

            <div onClick={() => openNavigation(activeRide.dropoff_address || 'As directed', activeRide.dropoff_coords)} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', cursor: 'pointer' }}>
              <div style={{ width: '15px', height: '15px', background: '#FFF', border: '3px solid #000', zIndex: 1, marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: '0.8rem', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>Dropoff</div>
                <div style={{ fontSize: '1.25rem', color: '#000', fontWeight: 600, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {activeRide.dropoff_address || 'As directed'} {(activeRide.dropoff_address || activeRide.dropoff_coords) && <ExternalLink size={16} color="#666" />}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cabin Brief — how this guest travels */}
        <GuestBrief
          guestName={activeRide.passenger_name || activeRide.metadata?.client_name}
          preferences={guestPreferences}
          note={activeRide.metadata?.comment_to_driver}
          passengers={Number(activeRide.metadata?.passengers) || 0}
          suitcases={Number(activeRide.metadata?.suitcases) || 0}
          updatedAt={activeRide.metadata?.passenger_edited_at}
        />

        {/* Primary Actions Grid */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
          <motion.button 
            whileTap={{ scale: 0.96 }}
            onClick={() => { triggerHaptic(); setShowChat(true); setUnreadMessages(0); }} 
            style={{ position: 'relative', flex: 1, height: '60px', background: '#F8F8F8', border: '1px solid #E0E0E0', borderRadius: '14px', color: '#000', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.5px' }}
          >
            <MessageSquare size={18}/> Chat
            {unreadMessages > 0 && (
              <span style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#EF4444', color: '#FFF', fontSize: '0.7rem', fontWeight: 800, width: '22px', height: '22px', borderRadius: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #F8F8F8', boxShadow: '0 2px 8px rgba(239,68,68,0.3)' }}>
                {unreadMessages}
              </span>
            )}
          </motion.button>

          <motion.button 
            whileTap={{ scale: 0.96 }}
            onClick={() => { triggerHaptic(); window.location.href = `tel:${activeRide.passenger_phone || '+448000000000'}`; }} 
            style={{ flex: 1, height: '60px', background: '#F8F8F8', border: '1px solid #E0E0E0', borderRadius: '14px', color: '#000', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.5px' }}
          >
            <Phone size={18}/> Call
          </motion.button>

          <motion.button 
            whileTap={{ scale: 0.96 }}
            onClick={() => { triggerHaptic(); setShowAuditLog(true); }} 
            style={{ flex: 1, height: '60px', background: '#F8F8F8', border: '1px solid #E0E0E0', borderRadius: '14px', color: '#000', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.5px' }}
          >
            <FileEdit size={18}/> Audit
          </motion.button>
        </div>

        {/* Expenses / Charges — recorded on the job for ops to review */}
        {(() => {
          const expenses = activeRide?.metadata?.expenses || [];
          const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
          return (
            <div style={{ marginTop: '16px', background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: expenses.length ? '16px' : '0', flexWrap: 'wrap', gap: '10px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#555', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Receipt size={16} color="#000" /> Expenses
                  {total > 0 && <span style={{ color: '#000', fontWeight: 800 }}>· £{total.toFixed(2)}</span>}
                </label>
                <motion.button whileTap={{ scale: 0.94 }}
                  onClick={() => { triggerHaptic(); setExpenseType(''); setExpenseAmount(''); setExpenseNote(''); setShowExpenseSheet(true); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#000', color: '#FFF', border: 'none', borderRadius: '8px', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                  <Plus size={14} /> Add charge
                </motion.button>
              </div>
              {expenses.map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderTop: '1px solid rgba(0,0,0,0.1)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#000' }}>{e.type}</div>
                    {e.note && <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.note}</div>}
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#000', fontFamily: 'var(--font-display), serif' }}>£{Number(e.amount).toFixed(2)}</div>
                  <motion.button whileTap={{ scale: 0.9 }} onClick={() => removeExpense(e.id)} style={{ background: 'rgba(239,68,68,0.1)', borderRadius: '8px', border: 'none', padding: '8px', cursor: 'pointer', display: 'flex', color: '#EF4444' }}>
                    <Trash2 size={16} />
                  </motion.button>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Billing Notes / Corrections */}
        <div style={{ marginTop: '16px', background: '#F8F8F8', border: '2px solid #E0E0E0', borderRadius: '16px', padding: '16px' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#444', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '12px', display: 'block' }}>Notes / Corrections for Billing</label>
          <textarea
            rows={2}
            value={billingNotes}
            onChange={(e) => setBillingNotes(e.target.value)}
            placeholder="e.g. Forgot to swipe Arrived, actual arrival time was 11:35 PM"
            style={{ width: '100%', background: 'transparent', border: 'none', color: '#000', fontSize: '1rem', outline: 'none', resize: 'none', lineHeight: 1.5, fontFamily: 'inherit', padding: 0, fontWeight: 500 }}
          />
        </div>

        {/* Action Swipe — the required next step, made unmissable so drivers
            don't forget to log arrival/POB (which corrupts billing timestamps) */}
        <div style={{ marginTop: '16px', position: 'relative', padding: '20px', borderRadius: '20px', background: '#FFFFFF', border: '1px solid var(--color-gold, #D4CFC9)', boxShadow: '0 8px 24px rgba(212,207,201,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '16px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#8A7355', animation: 'elsPulse 1.8s ease-in-out infinite' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: '#8A7355' }}>
              Required next step
            </span>
          </div>
          {isDispatched && <SwipeButton resetOnComplete text="Start Journey to Pickup" onComplete={() => { updateRideStatus('en_route'); logSystemAudit('Driver en route to pickup'); }} />}
          {isEnRoute && <SwipeButton resetOnComplete text="Arrived at Pickup" onComplete={() => { updateRideStatus('arrived'); logSystemAudit('Driver is on location'); }} />}
          {isArrived && <SwipeButton resetOnComplete text="Passenger On Board" onComplete={() => { updateRideStatus('in_progress'); logSystemAudit('Passenger On Board (POB)'); }} />}
          {isInProgress && (() => {
            const waypoints = activeRide?.waypoints || activeRide?.metadata?.waypoints || [];
            const currentStopIndex = activeRide?.metadata?.current_stop_index || 0;
            
            if (currentStopIndex < waypoints.length) {
              const currentStop = waypoints[currentStopIndex];
              return (
                <SwipeButton 
                  resetOnComplete 
                  text={`Arrived at ${currentStop.name.substring(0, 15)}${currentStop.name.length > 15 ? '...' : ''}`} 
                  onComplete={async () => { 
                    const newMetadata = { ...activeRide.metadata, current_stop_index: currentStopIndex + 1 };
                    await supabase.from('rides').update({ metadata: newMetadata }).eq('id', activeRide.id);
                    setActiveRide(prev => ({ ...prev, metadata: newMetadata }));
                    logSystemAudit(`Arrived at Stop: ${currentStop.name}`);
                  }} 
                />
              );
            }
            
            return (
              <SwipeButton 
                resetOnComplete 
                text="Complete Booking" 
                variant="accent" 
                onComplete={() => { updateRideStatus('completed'); }} 
              />
            );
          })()}
        </div>

        {/* No accept/decline — assigned jobs go through Operations */}
        <div style={{ marginTop: '16px' }}>
          <div style={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '1.5px', color: '#666', textTransform: 'uppercase', marginBottom: '10px' }}>
            Problem with this job?
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={contactOps}
              style={{ flex: 1, height: '48px', background: 'transparent', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '12px', color: '#000', display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }}
            >
              <MessageCircle size={15} /> WhatsApp Office
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => { triggerHaptic(); handleLogEvent('Driver messaged Operations'); setShowOpsChat(true); }}
              style={{ flex: 1, height: '48px', background: 'transparent', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '12px', color: '#000', display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }}
            >
              <Headphones size={15} /> Message Ops
            </motion.button>
          </div>
        </div>

        {/* Expense entry sheet — portalled to body: the job card animates with a
            transform, which would otherwise trap position:fixed inside it */}
        {createPortal(
        <AnimatePresence>
          {showExpenseSheet && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                onClick={() => setShowExpenseSheet(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(10,9,8,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} />
              <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 340, damping: 36, mass: 0.9 }}
                style={{ position: 'fixed', bottom: keyboardOverlap, left: 0, right: 0, zIndex: 10051, background: '#FFF', borderRadius: '24px 24px 0 0', padding: '10px 0 0', maxHeight: 'calc(var(--vv-height, 100dvh) - 40px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 -12px 48px rgba(0,0,0,0.18)', transition: 'bottom 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)' }}>
                {/* Pinned header — stays visible while the body scrolls under the keyboard */}
                <div style={{ flexShrink: 0, padding: '0 24px' }}>
                  <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: '#E8E4DE', margin: '0 auto 20px' }} />
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div>
                      <div style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#8A7355', marginBottom: '6px' }}>Expenses</div>
                      <div style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.75rem', fontWeight: 500, color: '#000', lineHeight: 1.1 }}>Add a charge</div>
                    </div>
                    <button onClick={() => setShowExpenseSheet(false)} style={{ background: 'transparent', border: '1px solid #E8E4DE', borderRadius: '50%', width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><X size={15} color="#000" /></button>
                  </div>
                  <div style={{ height: '1px', background: '#F0EDE8', margin: '16px 0 20px' }} />
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 24px calc(24px + env(safe-area-inset-bottom))' }}>
                {(() => {
                  const pickupC = extractCoords(activeRide?.pickup_coords);
                  const dropoffC = extractCoords(activeRide?.dropoff_coords);
                  const suggestion = suggestCongestionCharge([pickupC, dropoffC].filter(Boolean));
                  if (!suggestion) return null;
                  const already = (activeRide?.metadata?.expenses || []).some(e => e.type === 'Congestion Charge');
                  if (already) return null;
                  return (
                    <motion.button whileTap={{ scale: 0.98 }} onClick={() => addExpense('Congestion Charge', suggestion.amount, 'Auto-detected — Congestion Zone')}
                      style={{ width: '100%', textAlign: 'left', background: 'rgba(138,115,85,0.06)', border: '1px solid rgba(138,115,85,0.25)', borderRadius: '14px', padding: '14px 16px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                      <MapPin size={17} color="#8A7355" />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#000' }}>This job enters the Congestion Zone</div>
                        <div style={{ fontSize: '0.6875rem', color: '#8A7355', marginTop: '2px', letterSpacing: '0.3px' }}>Tap to add the £{suggestion.amount.toFixed(2)} charge</div>
                      </div>
                      <Plus size={17} color="#8A7355" />
                    </motion.button>
                  );
                })()}

                <div style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#9A938A', marginBottom: '12px' }}>Type</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '28px' }}>
                  {[
                    { label: 'Parking', amount: '' },
                    { label: 'Congestion Charge', amount: String(CONGESTION_CHARGE) },
                    { label: 'ULEZ', amount: String(ULEZ_CHARGE) },
                    { label: 'Toll', amount: '' },
                    { label: 'Meet & Greet', amount: '' },
                    { label: 'Waiting Time', amount: '' },
                    { label: 'Cleaning', amount: '' },
                    { label: 'Other', amount: '' }
                  ].map(q => (
                    <motion.button key={q.label} whileTap={{ scale: 0.97 }} onClick={() => { triggerHaptic(); setExpenseType(q.label); if (q.amount) setExpenseAmount(q.amount); }}
                      style={{ minHeight: '52px', padding: '8px 10px', borderRadius: '12px', border: expenseType === q.label ? '1px solid #000' : '1px solid #E8E4DE', background: expenseType === q.label ? '#000' : '#FFF', color: expenseType === q.label ? '#FFF' : '#000', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.4px', lineHeight: 1.25, cursor: 'pointer', transition: 'background 0.2s, color 0.2s, border-color 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                      {q.label}
                    </motion.button>
                  ))}
                </div>

                <div style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#9A938A', marginBottom: '4px' }}>Amount</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', borderBottom: '1px solid #E8E4DE', marginBottom: '22px' }}>
                  <span style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.75rem', color: '#8A7355', lineHeight: 1 }}>£</span>
                  <input type="number" inputMode="decimal" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} placeholder="0.00"
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: '2.25rem', fontWeight: 500, color: '#000', padding: '8px 0 12px', fontFamily: 'var(--font-display), serif', minWidth: 0 }} />
                </div>

                <input type="text" value={expenseNote} onChange={(e) => setExpenseNote(e.target.value)} placeholder="Note (optional) — e.g. NCP Heathrow T5"
                  style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid #E8E4DE', borderRadius: 0, padding: '10px 0 14px', outline: 'none', fontSize: '0.9375rem', color: '#000', marginBottom: '28px', fontFamily: 'inherit' }} />

                <motion.button whileTap={{ scale: 0.98 }} disabled={!expenseType || !(parseFloat(expenseAmount) > 0) || expenseSaving}
                  onClick={() => addExpense(expenseType, expenseAmount, expenseNote)}
                  style={{ width: '100%', height: '56px', borderRadius: '14px', border: 'none', background: (expenseType && parseFloat(expenseAmount) > 0) ? '#000' : '#F0EDE8', color: (expenseType && parseFloat(expenseAmount) > 0) ? '#FFF' : '#B5AEA4', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', cursor: 'pointer', transition: 'background 0.25s, color 0.25s' }}>
                  {expenseSaving ? 'Saving…' : 'Record Charge'}
                </motion.button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body)}

        {/* Navigation app chooser — portalled for the same reason */}
        {createPortal(
        <AnimatePresence>
          {navTarget && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                onClick={() => setNavTarget(null)}
                style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(10,9,8,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} />
              <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 340, damping: 36, mass: 0.9 }}
                style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10051, background: '#FFF', borderRadius: '24px 24px 0 0', padding: '10px 24px calc(20px + env(safe-area-inset-bottom))', boxShadow: '0 -12px 48px rgba(0,0,0,0.18)' }}>
                <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: '#E8E4DE', margin: '0 auto 20px' }} />
                <div style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#8A7355', marginBottom: '6px' }}>Navigate to</div>
                <div style={{ fontFamily: 'var(--font-display), serif', fontSize: '1.375rem', fontWeight: 500, color: '#000', lineHeight: 1.2, marginBottom: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{navTarget.label}</div>
                <div style={{ height: '1px', background: '#F0EDE8', margin: '16px 0 16px' }} />

                {[
                  { app: 'waze', name: 'Waze', tag: 'Recommended' },
                  { app: 'google', name: 'Google Maps', tag: null },
                  { app: 'apple', name: 'Apple Maps', tag: null }
                ].map(o => (
                  <motion.button key={o.app} whileTap={{ scale: 0.98 }} onClick={() => launchNav(o.app, navTarget)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '14px', padding: '17px 18px', marginBottom: '10px', background: o.app === 'waze' ? '#000' : '#FFF', border: o.app === 'waze' ? '1px solid #000' : '1px solid #E8E4DE', borderRadius: '14px', cursor: 'pointer' }}>
                    <Navigation size={17} color={o.app === 'waze' ? '#D4CFC9' : '#8A7355'} />
                    <span style={{ flex: 1, textAlign: 'left', fontSize: '0.9375rem', fontWeight: 600, letterSpacing: '0.2px', color: o.app === 'waze' ? '#FFF' : '#000' }}>{o.name}</span>
                    {o.tag && <span style={{ fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#8A7355' }}>{o.tag}</span>}
                    <ChevronRight size={17} color={o.app === 'waze' ? 'rgba(255,255,255,0.4)' : '#C9C2B8'} />
                  </motion.button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body)}
      </motion.div>
    );
  };

  return (
    <div style={{ height: '100dvh', background: '#FFF', color: '#000', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      
      {/* Chat Notification Toast */}
      {/* System Notification Toast */}
      <AnimatePresence>
        {systemNotification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            onClick={() => {
              const { type } = systemNotification;
              setSystemNotification(null);
              if (type === 'passenger') {
                setShowChat(true);
                setUnreadMessages(0);
              } else if (type === 'ops') {
                setShowOpsChat(true);
              }
            }}
            style={{
              position: 'absolute',
              top: 'calc(max(env(safe-area-inset-top), 24px) + 60px)',
              left: '20px',
              right: '20px',
              background: 'rgba(20,20,20,0.95)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: systemNotification.type === 'route' ? '1px solid #4CAF50' : '1px solid var(--color-gold-dim, rgba(212,207,201,0.3))',
              borderRadius: '16px',
              padding: '16px',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
              cursor: systemNotification.type === 'route' ? 'default' : 'pointer'
            }}
          >
            <div style={{ background: systemNotification.type === 'route' ? '#4CAF50' : 'var(--color-gold, #D4CFC9)', borderRadius: '50%', padding: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {systemNotification.type === 'route' ? <MapPin size={16} color="#000" /> : systemNotification.type === 'ops' ? <Headphones size={16} color="#000" /> : <MessageSquare size={16} color="#000" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '1px', color: systemNotification.type === 'route' ? '#4CAF50' : 'var(--color-gold, #D4CFC9)', textTransform: 'uppercase', marginBottom: '2px' }}>{systemNotification.title}</div>
              <div style={{ fontSize: '0.95rem', color: '#FFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
                {systemNotification.message}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Header */}
      <div style={{ paddingTop: 'calc(12px + max(env(safe-area-inset-top), 12px))', paddingLeft: '24px', paddingRight: '24px', paddingBottom: '16px', background: 'linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 60%, transparent 100%)', zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'absolute', top: 0, left: 0, right: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img src="/elitels.png" alt="Elite" style={{ height: '28px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', background: 'rgba(0,0,0,0.04)', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.1)' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '3px', background: shiftState === 'ONLINE' ? '#4CAF50' : '#555', transition: '0.3s' }} />
            <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '2px', color: '#8A7355', textTransform: 'uppercase' }}>{t('chauffeur')}</span>
          </div>
        </div>
        <motion.button 
          whileTap={{ scale: 0.9 }}
          onClick={() => { setShowProfile(true); try { Haptics.impact({ style: ImpactStyle.Light }); } catch(e){} }}
          style={{ padding: '6px', background: 'rgba(0,0,0,0.06)', borderRadius: '50%', backdropFilter: 'blur(16px)', border: '1px solid rgba(0,0,0,0.08)', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <User size={18} color="#000" />
        </motion.button>
      </div>

      {/* Map Background */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <MapContainer center={location} zoom={hasFix ? 17 : 12} style={{ height: '100%', width: '100%' }} zoomControl={false} attributionControl={false}>
          <MapUpdater center={location} zoom={hasFix ? 17 : 12} />
          <TileLayer
            url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
            attribution="&copy; Google Maps"
          />
          {hasFix && <Marker position={location} icon={driverIcon} />}
          {(() => {
            if (!activeRide) return null;
            const pCoords = extractCoords(activeRide.pickup_coords);
            const dCoords = extractCoords(activeRide.dropoff_coords);
            return (
              <>
                {pCoords && (
                  <Marker position={pCoords} icon={pickupIcon} />
                )}
                {dCoords && (
                  <Marker position={dCoords} icon={dropoffIcon} />
                )}
                
                {/* Real Route Polyline */
                 routeGeoJSON && (
                  <Polyline
                    positions={routeGeoJSON.coordinates.map(c => [c[1], c[0]])}
                    pathOptions={{ color: '#008080', weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
                  />
                )}
                
                {/* Fallback to straight line if no route */}
                {!routeGeoJSON && hasFix && pCoords && (
                  <Polyline
                    positions={[location, pCoords]}
                    pathOptions={{ color: '#D4CFC9', weight: 3, dashArray: '8, 8', opacity: 0.7 }}
                  />
                )}
                {!routeGeoJSON && pCoords && dCoords && activeRide.status === 'in_progress' && (
                  <Polyline
                    positions={[pCoords, dCoords]}
                    pathOptions={{ color: '#AAA', weight: 4, opacity: 0.8 }}
                  />
                )}
              </>
            );
          })()}
        </MapContainer>

        {/* Locating indicator — shown until the first real GPS fix */}
        {!hasFix && (
          <div style={{ position: 'absolute', top: '34%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 900, display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: '20px', pointerEvents: 'none' }}>
            <motion.div
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: '8px', height: '8px', borderRadius: '4px', background: '#FFF' }}
            />
            <span style={{ color: '#FFF', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase' }}>
              {locating ? 'Locating' : 'Location unavailable'}
            </span>
          </div>
        )}
      </div>

      {/* Bottom Sheet UI */}
      <motion.div layout transition={{ layout: { type: 'spring', stiffness: 350, damping: 30 } }} style={{ marginTop: 'auto', zIndex: 10, background: '#FFFFFF', borderTopLeftRadius: '16px', borderTopRightRadius: '16px', borderTop: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 -12px 40px rgba(0,0,0,0.18)', padding: '12px 24px 32px', paddingBottom: 'calc(32px + env(safe-area-inset-bottom))', maxHeight: '85dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', willChange: 'transform' }}>
        
        {/* Drag handle pill */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <div style={{ width: '36px', height: '5px', borderRadius: '3px', background: 'rgba(0,0,0,0.18)' }} />
        </div>
        {shiftState === 'OFFLINE' && (
          <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} transition={{ staggerChildren: 0.15, duration: 0.4, ease: "easeOut" }} style={{ textAlign: 'center' }}>
            <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ fontSize: '1.75rem', marginBottom: '12px', fontWeight: 300, fontFamily: 'var(--font-display), serif', letterSpacing: '0.5px' }}>{t('chauffeurPortal')}</motion.h2>

            {!isApproved ? (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'left' }}>
                <div style={{ background: driverProfile?.status === 'suspended' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)', border: driverProfile?.status === 'suspended' ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(245,158,11,0.25)', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <Clock size={18} color={driverProfile?.status === 'suspended' ? '#EF4444' : '#F59E0B'} />
                    <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: driverProfile?.status === 'suspended' ? '#EF4444' : '#F59E0B', textTransform: 'uppercase', letterSpacing: '2px' }}>
                      {driverProfile?.status === 'suspended' ? 'Account Suspended' : 'Application Under Review'}
                    </span>
                  </div>
                  <p style={{ color: '#AAA', fontSize: '0.85rem', lineHeight: 1.6 }}>
                    {driverProfile?.status === 'suspended'
                      ? 'Your account is currently suspended. Contact ELS Operations for details.'
                      : driverProfile?.owns_vehicle
                        ? `We're reviewing your application${driverProfile?.vehicle_reg ? ` for ${driverProfile.vehicle_reg}` : ''}. Once approved, your ELS plate will be issued here and jobs will be assigned to you.`
                        : "We're reviewing your application. Once approved, jobs will be assigned to you here."}
                  </p>
                  <p style={{ color: '#666', fontSize: '0.75rem', marginTop: '10px' }}>
                    Speed things up by uploading your documents in your profile.
                  </p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { triggerHaptic(); setShowProfile(true); }}
                  style={{ width: '100%', padding: '16px', background: 'transparent', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', color: '#000', fontWeight: 500, fontSize: '0.8125rem', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}
                >
                  <User size={18} /> Complete My Profile
                </motion.button>
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={contactOps}
                    style={{ flex: 1, padding: '14px', background: 'transparent', border: '1px solid rgba(0,0,0,0.12)', borderRadius: '8px', color: '#000', fontWeight: 600, fontSize: '0.75rem', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  >
                    <MessageCircle size={14} /> WhatsApp Office
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { triggerHaptic(); setShowOpsChat(true); }}
                    style={{ flex: 1, padding: '14px', background: 'transparent', border: '1px solid rgba(0,0,0,0.12)', borderRadius: '8px', color: '#000', fontWeight: 600, fontSize: '0.75rem', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  >
                    <Headphones size={14} /> Message Ops
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <>
                {driverProfile?.els_plate && (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', padding: '10px 18px', marginBottom: '16px' }}>
                    <Car size={16} color="#8A7355" />
                    <span style={{ fontSize: '0.625rem', color: '#8A7355', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase' }}>ELS Plate</span>
                    <span style={{ fontWeight: 600, letterSpacing: '2px', color: '#000' }}>{driverProfile.els_plate}</span>
                  </motion.div>
                )}
                <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ color: '#888', marginBottom: '32px', fontSize: '0.8125rem' }}>{t('goOnline')}</motion.p>
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 300 }}>
                  <SwipeButton text={t('startShift')} onComplete={() => setShiftState('PRE_SHIFT')} />
                </motion.div>
              </>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '24px' }}>
              <motion.button 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
                whileTap={{ scale: 0.95 }}
                onClick={async () => {
                  triggerHaptic();
                  setHistoryLoading(true);
                  setShowHistory(true);
                  const { data } = await supabase.from('driver_shifts').select('*').eq('driver_id', user.id).order('started_at', { ascending: false }).limit(50);
                  setShiftHistory(data || []);
                  setHistoryLoading(false);
                }}
                style={{ flex: 1, padding: '15px 16px', background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '12px', color: '#000', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '0.75rem', letterSpacing: '1.5px', textTransform: 'uppercase' }}
              >
                <History size={16} /> {t('myShifts')}
              </motion.button>

              <motion.button 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                whileTap={{ scale: 0.95 }}
                onClick={async () => {
                  triggerHaptic();
                  setHistoryLoading(true);
                  setShowTrips(true);
                  const { data } = await supabase.from('rides').select('*').eq('driver_id', user.id).order('created_at', { ascending: false }).limit(50);
                  setTripsHistory(data || []);
                  setHistoryLoading(false);
                }}
                style={{ flex: 1, padding: '15px 16px', background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '12px', color: '#000', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '0.75rem', letterSpacing: '1.5px', textTransform: 'uppercase' }}
              >
                <Car size={16} /> My Trips
              </motion.button>
            </div>
          </motion.div>
        )}

        {shiftState === 'PRE_SHIFT' && renderPreShift()}

        {shiftState === 'ONLINE' && (
          <>
            {renderActiveJob()}
            {!activeRide && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.6 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}
              >
                <motion.button 
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { triggerHaptic(); setShowAuditLog(true); }} 
                  style={{ 
                    width: '100%', padding: '16px', 
                    background: activeAudit ? 'rgba(138,115,85,0.08)' : 'rgba(0,0,0,0.03)',
                    border: activeAudit ? '1px solid rgba(138,115,85,0.4)' : '1px solid rgba(0,0,0,0.1)',
                    borderRadius: '8px',
                    color: activeAudit ? '#8A7355' : '#000',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', fontWeight: 600, fontSize: '0.8125rem', letterSpacing: '1px', textTransform: 'uppercase'
                  }}
                >
                  <FileEdit size={16} color={activeAudit ? '#8A7355' : '#000'} />
                  {activeAudit ? `Active: ${activeAudit}` : 'Record Audit'}
                </motion.button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={contactOps}
                    style={{ flex: 1, padding: '14px', background: 'transparent', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', color: '#000', fontWeight: 600, fontSize: '0.6875rem', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  >
                    <MessageCircle size={14} /> WhatsApp Ops
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { triggerHaptic(); setShowOpsChat(true); }}
                    style={{ flex: 1, padding: '14px', background: 'transparent', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', color: '#000', fontWeight: 600, fontSize: '0.6875rem', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  >
                    <Headphones size={14} /> Message Ops
                  </motion.button>
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShiftState('POST_SHIFT')}
                  style={{ width: '100%', padding: '16px', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#EF4444', fontWeight: 500, fontSize: '0.8125rem', letterSpacing: '1px', textTransform: 'uppercase', transition: 'background 0.2s', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                >
                  {t('endShift')}
                </motion.button>
              </motion.div>
            )}
          </>
        )}

        {shiftState === 'POST_SHIFT' && (
          <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Header */}
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
              <h3 style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: '#D4CFC9' }}>{t('endOfShift')}</h3>
            </motion.div>

            {/* Step-by-step instructions */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '12px', padding: '20px' }}
            >
              <p style={{ fontWeight: 500, fontSize: '0.875rem', color: '#000', marginBottom: '12px' }}>{t('walkAroundInstructions')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[t('step1'), t('step2'), t('step3'), t('step4'), t('step5')].map((step, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#AAA', fontSize: '0.8125rem' }}>
                    <div style={{ minWidth: '24px', height: '24px', borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6875rem', fontWeight: 600, color: '#D4CFC9' }}>{i + 1}</div>
                    {step}
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Record Button — mandatory */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, type: 'spring', stiffness: 400, damping: 25 }}>
              <motion.button 
                whileTap={{ scale: 0.97 }}
                onClick={() => { triggerHaptic(); setShowCameraFor('post'); }} 
                style={{ width: '100%', padding: '22px', background: postVideoUrl ? 'rgba(212,207,201,0.06)' : 'rgba(0,0,0,0.04)', border: postVideoUrl ? '1px solid rgba(212,207,201,0.35)' : '1px solid rgba(0,0,0,0.08)', borderRadius: '12px', color: postVideoUrl ? '#D4CFC9' : '#000', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', fontWeight: 500, fontSize: '0.8125rem', letterSpacing: '1px', textTransform: 'uppercase', transition: '0.3s' }}
              >
                {postVideoUrl ? <Check size={18} color="#D4CFC9" /> : <Camera size={18} />}
                {postVideoUrl ? t('vehicleScanSaved') : t('tapToRecord')}
              </motion.button>
            </motion.div>

            {/* Notes — optional */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, type: 'spring', stiffness: 400, damping: 25 }}>
              <div style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '12px', padding: '20px' }}>
                <label style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '2px', color: '#888', marginBottom: '10px', display: 'block', textTransform: 'uppercase' }}>{t('endOfShiftNotes')}</label>
                <textarea 
                  placeholder={t('postNotesPlaceholder')} 
                  value={postNotes} 
                  onChange={e => setPostNotes(e.target.value)}
                  rows={3}
                  style={{ width: '100%', background: 'transparent', color: '#000', border: 'none', fontSize: '0.95rem', outline: 'none', resize: 'none', lineHeight: 1.5, fontFamily: 'inherit' }}
                />
              </div>
            </motion.div>

            {/* Complete — only if video done */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} style={{ marginTop: '8px' }}>
              {postVideoUrl ? (
                <SwipeButton text={t('completeShift')} variant="danger" onComplete={handleEndShift} />
              ) : (
                <div style={{ width: '100%', height: '60px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,0.06)' }}>
                  <span style={{ color: '#555', fontWeight: 600, letterSpacing: '2px', fontSize: '0.6875rem', textTransform: 'uppercase' }}>{t('recordToComplete')}</span>
                </div>
              )}
            </motion.div>

            {/* Cancel — go back online */}
            <button onClick={() => setShiftState('ONLINE')} style={{ padding: '12px', color: '#888', fontSize: '0.85rem', fontWeight: 500 }}>{t('cancelStayOnline')}</button>
          </motion.div>
        )}

      </motion.div>

      {showCameraFor && (
        <VideoRecorderOverlay 
          onClose={() => setShowCameraFor(null)} 
          onUploadComplete={(url) => { 
            if (showCameraFor === 'pre') {
              setShiftData({...shiftData, videoUrl: url});
              setVideoRecorded(true);
            } else {
              setPostVideoUrl(url);
            }
            setShowCameraFor(null); 
          }} 
        />
      )}

      {/* Shift History Overlay */}
      <AnimatePresence>
        {showHistory && (
          <motion.div 
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} 
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9998, background: '#F9F9F9', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            {/* History Header */}
            <div style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 20px) + 8px)', paddingLeft: '24px', paddingRight: '24px', paddingBottom: '16px', display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '1px solid rgba(0,0,0,0.06)', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)' }}>
              <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowHistory(false)} style={{ padding: '10px', background: 'transparent', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '8px' }}>
                <ChevronLeft size={20} color="#000" />
              </motion.button>
              <h2 style={{ color: '#000', fontSize: '1.5rem', fontWeight: 300, fontFamily: 'var(--font-display), serif', flex: 1 }}>{t('myShifts')}</h2>
              {!historyLoading && shiftHistory.length > 0 && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  style={{ padding: '4px 12px', background: 'rgba(0,0,0,0.04)', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.1)' }}
                >
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#999', fontVariantNumeric: 'tabular-nums' }}>{shiftHistory.length}</span>
                </motion.div>
              )}
            </div>

            {/* History List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', paddingBottom: 'calc(32px + env(safe-area-inset-bottom))', WebkitOverflowScrolling: 'touch' }}>
              {historyLoading ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#555' }}>
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} style={{ width: '32px', height: '32px', border: '2px solid rgba(0,0,0,0.1)', borderTopColor: '#D4CFC9', borderRadius: '50%', margin: '0 auto 16px' }} />
                  {t('loadingShifts')}
                </div>
              ) : shiftHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#555' }}>
                  <Clock size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
                  <p>{t('noShiftsYet')}</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {shiftHistory.map((shift, i) => {
                    const start = new Date(shift.started_at);
                    const end = shift.ended_at ? new Date(shift.ended_at) : null;
                    const duration = end ? Math.round((end - start) / 60000) : null;
                    let durationLabel = null;
                    if (duration !== null) {
                      const totalHrs = Math.floor(duration / 60);
                      durationLabel = totalHrs >= 24
                        ? `${Math.floor(totalHrs / 24)}d ${totalHrs % 24}h`
                        : `${totalHrs}h ${duration % 60}m`;
                    }
                    const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' };
                    const labelStyle = { fontSize: '0.6875rem', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' };
                    const valueStyle = { fontSize: '0.8125rem', color: '#000', fontWeight: 500, fontVariantNumeric: 'tabular-nums' };
                    return (
                      <motion.div 
                        key={shift.id} 
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                        style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '12px', padding: '18px 20px' }}
                      >
                        {/* Date + Status */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div style={{ fontWeight: 500, fontSize: '1.0625rem', fontFamily: 'var(--font-display), serif', color: '#000' }}>
                            {start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </div>
                          <div style={{ fontSize: '0.625rem', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: end ? '#D4CFC9' : '#4CAF50' }}>
                            {end ? t('completed') : t('inProgress')}
                          </div>
                        </div>

                        {/* Details */}
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <div style={rowStyle}>
                            <span style={labelStyle}>{t('clockIn')}</span>
                            <span style={valueStyle}>{start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          {end && (
                            <div style={rowStyle}>
                              <span style={labelStyle}>{t('clockOut')}</span>
                              <span style={valueStyle}>{end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          )}
                          {durationLabel && (
                            <div style={rowStyle}>
                              <span style={labelStyle}>{t('duration')}</span>
                              <span style={valueStyle}>{durationLabel}</span>
                            </div>
                          )}
                          {shift.car_reg && (
                            <div style={{ ...rowStyle, borderBottom: 'none' }}>
                              <span style={labelStyle}>{t('vehicle')}</span>
                              <span style={{ ...valueStyle, letterSpacing: '1px' }}>{shift.car_reg}</span>
                            </div>
                          )}
                          {shift.has_problem && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#EF4444', fontSize: '0.75rem', marginTop: '6px' }}>
                              <AlertTriangle size={13} /> {t('problemReported')}
                            </div>
                          )}
                          {shift.needs_fuel && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#F59E0B', fontSize: '0.75rem', marginTop: '4px' }}>
                              <Fuel size={13} /> {t('fuelNeeded')}
                            </div>
                          )}
                        </div>

                        {/* Video Links */}
                        {(shift.pre_shift_video_url || shift.post_shift_video_url) && (
                          <div style={{ display: 'flex', flexDirection: 'column', marginTop: '10px', paddingTop: '4px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                            {shift.pre_shift_video_url && (
                              <a href={shift.pre_shift_video_url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', color: '#999', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.5px', textDecoration: 'none' }}>
                                <Video size={14} color="#D4CFC9" /> {t('preShiftVideo')}
                              </a>
                            )}
                            {shift.post_shift_video_url && (
                              <a href={shift.post_shift_video_url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', color: '#999', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.5px', textDecoration: 'none' }}>
                                <Video size={14} color="#D4CFC9" /> {t('postShiftVideo')}
                              </a>
                            )}
                          </div>
                        )}

                        {/* Shift Audit Logs */}
                        {shift.metadata?.audit_logs && shift.metadata.audit_logs.length > 0 && (
                          <div style={{ marginTop: '10px', paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                            <div style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '1px', color: '#555', marginBottom: '8px', textTransform: 'uppercase' }}>Shift Logs</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {shift.metadata.audit_logs.map((log, idx) => (
                                <div key={idx} style={{ display: 'flex', gap: '10px', fontSize: '0.8125rem' }}>
                                  <span style={{ color: '#555', fontVariantNumeric: 'tabular-nums' }}>{new Date(log.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                  <span style={{ color: '#D4CFC9', fontWeight: 400 }}>{log.message}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trips History Overlay */}
      <AnimatePresence>
        {showTrips && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            style={{ position: 'absolute', inset: 0, background: '#F9F9F9', zIndex: 100, display: 'flex', flexDirection: 'column' }}
          >
            {/* Header */}
            <div style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 24px) + 12px)', paddingLeft: '24px', paddingRight: '24px', paddingBottom: '20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button onClick={() => setShowTrips(false)} style={{ padding: '10px', background: 'transparent', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ChevronLeft size={20} color="#000" />
              </button>
              <h2 style={{ color: '#000', fontSize: '1.5rem', fontWeight: 300, fontFamily: 'var(--font-display), serif', flex: 1 }}>My Trips</h2>
              {!historyLoading && tripsHistory.length > 0 && (
                <div style={{ padding: '4px 12px', background: 'rgba(0,0,0,0.04)', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.1)' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#999', fontVariantNumeric: 'tabular-nums' }}>{tripsHistory.length}</span>
                </div>
              )}
            </div>

            {/* Trips List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', paddingBottom: 'calc(32px + env(safe-area-inset-bottom))', WebkitOverflowScrolling: 'touch' }}>
              {historyLoading ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#555' }}>
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} style={{ width: '32px', height: '32px', border: '2px solid rgba(0,0,0,0.1)', borderTopColor: '#D4CFC9', borderRadius: '50%', margin: '0 auto 16px' }} />
                  Loading Trips...
                </div>
              ) : tripsHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#555' }}>
                  <Car size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
                  <p>No trips found</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {tripsHistory.map((trip, i) => {
                    const start = new Date(trip.created_at);
                    const isCompleted = trip.status === 'completed';
                    const isCancelled = trip.status === 'cancelled';
                    const statusColor = isCompleted ? '#D4CFC9' : isCancelled ? '#555' : '#4CAF50';
                    const auditLogs = trip.metadata?.audit_logs || [];
                    const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' };
                    const labelStyle = { fontSize: '0.6875rem', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' };
                    const valueStyle = { fontSize: '0.8125rem', color: '#000', fontWeight: 500, fontVariantNumeric: 'tabular-nums' };
                    
                    return (
                      <motion.div 
                        key={trip.id} 
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                        style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '12px', padding: '18px 20px' }}
                      >
                        {/* Status Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div style={{ fontWeight: 500, fontSize: '1.0625rem', fontFamily: 'var(--font-display), serif', color: '#000' }}>
                            {start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} <span style={{ color: '#555' }}>·</span> {start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div style={{ fontSize: '0.625rem', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: statusColor }}>
                            {trip.status}
                          </div>
                        </div>

                        {/* Details */}
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <div style={rowStyle}>
                            <span style={labelStyle}>Client</span>
                            <span style={valueStyle}>{trip.passenger_name || trip.metadata?.client_name || 'Client'}</span>
                          </div>
                          <div style={{ ...rowStyle, borderBottom: auditLogs.length > 0 ? rowStyle.borderBottom : 'none' }}>
                            <span style={labelStyle}>Dropoff</span>
                            <span style={{ ...valueStyle, textAlign: 'right', maxWidth: '60%' }}>{trip.dropoff_address || 'As Directed'}</span>
                          </div>
                        </div>

                        {/* Audit Logs */}
                        {auditLogs.length > 0 && (
                          <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '1px', color: '#555', marginBottom: '8px', textTransform: 'uppercase' }}>Audit Logs</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {auditLogs.map((log, idx) => (
                                <div key={idx} style={{ display: 'flex', gap: '10px', fontSize: '0.8125rem' }}>
                                  <span style={{ color: '#555', fontVariantNumeric: 'tabular-nums' }}>{new Date(log.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                  <span style={{ color: '#D4CFC9', fontWeight: 400 }}>{log.message}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Driver Profile Drawer */}
      <DriverProfileDrawer 
        open={showProfile} 
        onClose={() => setShowProfile(false)} 
        profile={driverProfile}
        onSignOut={async () => {
          if (shiftState === 'ONLINE' || shiftState === 'PRE_SHIFT' || shiftState === 'POST_SHIFT') {
            if (currentShiftId) {
              await supabase.from('driver_shifts').update({ ended_at: new Date().toISOString() }).eq('id', currentShiftId);
            }
          }
          signOut();
        }}
      />

      {/* Ride Chat UI */}
      <AnimatePresence>
        {showChat && activeRide && (
          <RideChat
            rideId={activeRide.id}
            userId={user?.id}
            driverName={user?.user_metadata?.full_name || 'Driver'}
            onClose={() => setShowChat(false)}
          />
        )}
      </AnimatePresence>

      {/* Direct line to ELS Operations — lands in the PA dashboard CS inbox */}
      <AnimatePresence>
        {showOpsChat && (
          <OpsChat userId={user?.id} onClose={() => setShowOpsChat(false)} />
        )}
      </AnimatePresence>

      {/* Audit Log / Trip Notes Modal */}
      <AnimatePresence>
        {showAuditLog && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 'var(--vv-height, 100dvh)', zIndex: 10000, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-end' }}
          >
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              style={{ width: '100%', background: '#FFFFFF', borderTop: '1px solid rgba(0,0,0,0.08)', borderTopLeftRadius: '12px', borderTopRightRadius: '12px', padding: '24px', paddingBottom: 'calc(var(--modal-pb, 24px) + var(--safe-area-bottom, env(safe-area-inset-bottom)))', maxHeight: 'calc(var(--vv-height, 100dvh) - 24px)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3 style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: '#D4CFC9' }}>Trip Notes / Audit</h3>
                <button onClick={() => setShowAuditLog(false)} style={{ padding: '8px', background: 'transparent', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={18} color="#000" />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                {['Refuelling Vehicle', 'Washing Vehicle', 'Waiting for Client', 'Stopped for Client', 'Traffic Delay'].map((option) => {
                  const isActive = activeAudit === option;
                  return (
                    <button 
                      key={option}
                      onClick={() => { 
                        if (isActive) {
                          handleLogEvent(`Finished: ${option}`);
                          setActiveAudit(null);
                        } else {
                          handleLogEvent(`Started: ${option}`);
                          setActiveAudit(option);
                        }
                        setShowAuditLog(false); 
                      }} 
                      style={{ 
                        padding: '16px', 
                        background: isActive ? 'rgba(212,207,201,0.06)' : 'rgba(0,0,0,0.04)', 
                        border: isActive ? '1px solid rgba(212,207,201,0.35)' : '1px solid rgba(0,0,0,0.08)',
                        borderRadius: '8px', 
                        fontWeight: 500, 
                        fontSize: '0.8125rem',
                        letterSpacing: '0.5px',
                        color: isActive ? '#D4CFC9' : '#000' 
                      }}
                    >
                      {isActive ? `Finish ${option}` : option}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <input 
                  type="text" 
                  value={customLogText}
                  onChange={(e) => setCustomLogText(e.target.value)}
                  placeholder="Custom note..." 
                  style={{ flex: 1, padding: '14px', background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', color: '#000', outline: 'none' }} 
                />
                <button 
                  onClick={() => {
                    if (customLogText.trim()) {
                      handleLogEvent(customLogText.trim());
                      setCustomLogText('');
                      setShowAuditLog(false);
                    }
                  }}
                  style={{ padding: '0 24px', background: '#000000', color: '#FFFFFF', fontWeight: 600, fontSize: '0.75rem', letterSpacing: '2px', textTransform: 'uppercase', borderRadius: '8px' }}
                >
                  Log
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

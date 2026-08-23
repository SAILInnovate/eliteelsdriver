import { useState, useEffect, useRef, useCallback } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { supabase } from './supabase';

/**
 * In-app voice calls between passenger and driver.
 *
 * Audio is WebRTC peer-to-peer — it never touches our servers. Signalling rides
 * on a Supabase Realtime broadcast channel, which we already pay for, so a call
 * costs nothing per minute. Only the minority of calls stuck behind symmetric
 * NAT / carrier CGNAT fall back to a TURN relay; point VITE_TURN_* at your own
 * coturn box when the free public relay stops being good enough.
 *
 * Both apps mount this hook for the whole life of an active ride, not just while
 * the chat is open — that is what lets an incoming call ring.
 */

const TURN_URL = import.meta.env.VITE_TURN_URL;

// Public STUN gets both ends their reflexive address, which is enough for the
// large majority of calls. There is no working free public TURN any more (the
// Open Relay Project's is dead), so relay is opt-in via VITE_TURN_* — see
// .env.example. Without one, calls behind symmetric NAT fail over to the
// carrier line instead of connecting.
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ...(TURN_URL
    ? [{
        urls: TURN_URL.split(',').map(u => u.trim()),
        username: import.meta.env.VITE_TURN_USERNAME,
        credential: import.meta.env.VITE_TURN_CREDENTIAL
      }]
    : [])
];

// How long we ring before giving up on either end
const RING_TIMEOUT_MS = 45000;
// ...and how long we allow ICE to negotiate once the call has been answered
const CONNECT_TIMEOUT_MS = 20000;

const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// Ringtone and ringback, synthesised — no audio files to ship or host
function makeRinger() {
  let ctx = null;
  let loop = null;

  const tone = (freq, startAt, dur, level) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + startAt;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(level, t0 + 0.03);
    gain.gain.setValueAtTime(level, t0 + dur - 0.05);
    gain.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  return {
    start(kind) {
      this.stop();
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        ctx = ctx || new Ctor();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const cycle = () => {
          try {
            if (kind === 'incoming') {
              tone(880, 0, 0.38, 0.14);
              tone(660, 0.44, 0.38, 0.14);
            } else {
              tone(425, 0, 0.9, 0.05); // UK-style ringback purr
            }
          } catch { /* context died — nothing to do */ }
        };
        cycle();
        loop = setInterval(cycle, kind === 'incoming' ? 2200 : 3200);
      } catch { /* no WebAudio — haptics still fire */ }
    },
    stop() {
      if (loop) { clearInterval(loop); loop = null; }
    }
  };
}

export function useRideCall({ rideId, userId, role, displayName, enabled = true }) {
  // idle | outgoing | incoming | connecting | active | ended | failed
  const [status, setStatus] = useState('idle');
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerName, setPeerName] = useState(null);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [note, setNote] = useState(null); // "Call ended", "No answer", ...

  const statusRef = useRef('idle');
  const channelRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const audioElRef = useRef(null);
  const callIdRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const pendingIceRef = useRef([]);
  const ringTimerRef = useRef(null);
  const durationTimerRef = useRef(null);
  const endedTimerRef = useRef(null);
  const connectTimerRef = useRef(null);
  const vibrateTimerRef = useRef(null);
  const ringerRef = useRef(null);
  if (!ringerRef.current) ringerRef.current = makeRinger();

  const setPhase = (next) => { statusRef.current = next; setStatus(next); };

  // Remote audio lives on a detached element appended to body, so playback
  // survives the call UI unmounting mid-call.
  const audioEl = () => {
    if (!audioElRef.current) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('playsinline', '');
      el.style.display = 'none';
      document.body.appendChild(el);
      audioElRef.current = el;
    }
    return audioElRef.current;
  };

  const send = useCallback((type, payload = {}) => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.send({
      type: 'broadcast',
      event: 'signal',
      payload: { type, from: userId, fromRole: role, callId: callIdRef.current, ...payload }
    });
  }, [userId, role]);

  const startVibrate = () => {
    const buzz = () => { Haptics.vibrate({ duration: 600 }).catch(() => {}); };
    buzz();
    vibrateTimerRef.current = setInterval(buzz, 2200);
  };

  const stopRinging = () => {
    ringerRef.current.stop();
    if (vibrateTimerRef.current) { clearInterval(vibrateTimerRef.current); vibrateTimerRef.current = null; }
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
  };

  const releaseMedia = () => {
    stopRinging();
    if (connectTimerRef.current) { clearTimeout(connectTimerRef.current); connectTimerRef.current = null; }
    if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null; }
    if (pcRef.current) {
      try { pcRef.current.onicecandidate = null; pcRef.current.ontrack = null; pcRef.current.onconnectionstatechange = null; pcRef.current.close(); } catch { /* non-fatal */ }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => { try { t.stop(); } catch { /* non-fatal */ } });
      localStreamRef.current = null;
    }
    if (audioElRef.current) audioElRef.current.srcObject = null;
    pendingOfferRef.current = null;
    pendingIceRef.current = [];
    callIdRef.current = null;
  };

  const reset = useCallback(() => {
    if (endedTimerRef.current) { clearTimeout(endedTimerRef.current); endedTimerRef.current = null; }
    setPhase('idle');
    setNote(null);
    setPeerName(null);
    setDuration(0);
  }, []);

  // Wind the call down. A clean end shows a closing line for a beat and clears
  // itself; a failure sticks around so the caller can take the phone fallback.
  const finish = useCallback((message, { failed = false } = {}) => {
    releaseMedia();
    setMuted(false);
    setNote(message || null);
    if (failed) { setPhase('failed'); return; }
    setPhase('ended');
    if (endedTimerRef.current) clearTimeout(endedTimerRef.current);
    endedTimerRef.current = setTimeout(() => {
      setPhase('idle');
      setNote(null);
      setPeerName(null);
      setDuration(0);
    }, 1500);
  }, []);

  const onConnected = useCallback(() => {
    if (statusRef.current === 'active') return;
    stopRinging();
    if (connectTimerRef.current) { clearTimeout(connectTimerRef.current); connectTimerRef.current = null; }
    setPhase('active');
    setDuration(0);
    durationTimerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
  }, []);

  const buildPeer = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (e.candidate) send('ice', { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const el = audioEl();
      el.srcObject = e.streams[0];
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') onConnected();
      else if (s === 'failed') finish('Could not connect', { failed: true });
      else if (s === 'closed' && statusRef.current === 'active') finish('Call ended');
    };
    return pc;
  }, [send, onConnected, finish]);

  const captureMic = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    localStreamRef.current = stream;
    return stream;
  };

  // Nothing else bounds the negotiation phase — without this a call that can
  // never traverse the NAT sits on "Connecting..." indefinitely.
  const armConnectTimeout = useCallback(() => {
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    connectTimerRef.current = setTimeout(() => {
      send('hangup');
      finish('Could not connect', { failed: true });
    }, CONNECT_TIMEOUT_MS);
  }, [send, finish]);

  const flushIce = async (pc) => {
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const c of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* stale candidate */ }
    }
  };

  // ---- Actions -------------------------------------------------------------

  const startCall = useCallback(async () => {
    if (statusRef.current !== 'idle' || !channelRef.current) return;
    callIdRef.current = uid();
    setNote(null);
    setPhase('outgoing');
    try {
      const stream = await captureMic();
      const pc = buildPeer();
      pcRef.current = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send('invite', { sdp: { type: offer.type, sdp: offer.sdp }, name: displayName });
      ringerRef.current.start('outgoing');
      ringTimerRef.current = setTimeout(() => {
        send('hangup');
        finish('No answer', { failed: true });
      }, RING_TIMEOUT_MS);
    } catch (e) {
      finish(
        e && e.name === 'NotAllowedError' ? 'Microphone access needed' : 'Could not start call',
        { failed: true }
      );
    }
  }, [buildPeer, send, displayName, finish]);

  const acceptCall = useCallback(async () => {
    if (statusRef.current !== 'incoming') return;
    stopRinging();
    setPhase('connecting');
    armConnectTimeout();
    try {
      const stream = await captureMic();
      const pc = buildPeer();
      pcRef.current = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));
      await flushIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send('answer', { sdp: { type: answer.type, sdp: answer.sdp } });
    } catch (e) {
      send('decline', { reason: 'error' });
      finish(
        e && e.name === 'NotAllowedError' ? 'Microphone access needed' : 'Could not connect',
        { failed: true }
      );
    }
  }, [buildPeer, send, armConnectTimeout, finish]);

  const declineCall = useCallback(() => {
    if (statusRef.current !== 'incoming') return;
    send('decline', { reason: 'declined' });
    finish('Declined');
  }, [send, finish]);

  const endCall = useCallback(() => {
    if (statusRef.current === 'idle' || statusRef.current === 'ended') return;
    send('hangup');
    finish('Call ended');
  }, [send, finish]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }, [muted]);

  // ---- Signalling channel --------------------------------------------------

  useEffect(() => {
    if (!enabled || !rideId || !userId) return;

    const channel = supabase.channel(`ride-call:${rideId}`, {
      config: { broadcast: { self: false }, presence: { key: userId } }
    });
    channelRef.current = channel;

    const readPresence = () => {
      const state = channel.presenceState();
      const others = Object.entries(state).filter(([key]) => key !== userId);
      setPeerOnline(others.length > 0);
    };

    channel.on('presence', { event: 'sync' }, readPresence);
    channel.on('presence', { event: 'join' }, readPresence);
    channel.on('presence', { event: 'leave' }, () => {
      readPresence();
      // The other side closed the app mid-call — nothing left to talk to
      if (['outgoing', 'incoming', 'connecting', 'active'].includes(statusRef.current)) {
        finish('Call ended');
      }
    });

    channel.on('broadcast', { event: 'signal' }, async ({ payload: msg }) => {
      if (!msg || msg.from === userId) return;
      const pc = pcRef.current;

      switch (msg.type) {
        case 'invite': {
          if (statusRef.current !== 'idle') {
            channel.send({
              type: 'broadcast',
              event: 'signal',
              payload: { type: 'decline', from: userId, callId: msg.callId, reason: 'busy' }
            });
            return;
          }
          callIdRef.current = msg.callId;
          pendingOfferRef.current = msg.sdp;
          pendingIceRef.current = [];
          setPeerName(msg.name || null);
          setNote(null);
          setPhase('incoming');
          ringerRef.current.start('incoming');
          startVibrate();
          ringTimerRef.current = setTimeout(() => {
            send('decline', { reason: 'timeout' });
            finish('Missed call');
          }, RING_TIMEOUT_MS + 5000);
          break;
        }
        case 'answer': {
          if (msg.callId !== callIdRef.current || !pc) return;
          stopRinging();
          setPhase('connecting');
          armConnectTimeout();
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            await flushIce(pc);
          } catch {
            finish('Could not connect', { failed: true });
          }
          break;
        }
        case 'ice': {
          if (msg.callId !== callIdRef.current || !msg.candidate) return;
          if (pc && pc.remoteDescription) {
            try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch { /* non-fatal */ }
          } else {
            pendingIceRef.current.push(msg.candidate);
          }
          break;
        }
        case 'decline': {
          if (msg.callId !== callIdRef.current) return;
          finish(msg.reason === 'busy' ? 'Line busy' : 'Call declined');
          break;
        }
        case 'hangup': {
          if (msg.callId !== callIdRef.current) return;
          finish('Call ended');
          break;
        }
        default:
          break;
      }
    });

    channel.subscribe(async (state) => {
      if (state === 'SUBSCRIBED') {
        await channel.track({ role, name: displayName || null });
        readPresence();
      }
    });

    return () => {
      releaseMedia();
      statusRef.current = 'idle';
      if (endedTimerRef.current) clearTimeout(endedTimerRef.current);
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
    // displayName is read at subscribe time only; re-subscribing on a name
    // change would drop an in-flight call for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rideId, userId, role]);

  // Tear the audio element down with the hook
  useEffect(() => () => {
    if (audioElRef.current) {
      try { audioElRef.current.remove(); } catch { /* non-fatal */ }
      audioElRef.current = null;
    }
  }, []);

  /**
   * Show the call surface in its failed state without placing a call.
   *
   * WebRTC can only reach an app that is open and subscribed to this ride, so
   * when the peer is absent there is nothing to ring. Silently opening the
   * dialler made the button look like it had done nothing.
   */
  const reportUnavailable = useCallback((message) => {
    finish(message, { failed: true });
  }, [finish]);

  return {
    status,
    peerOnline,
    peerName,
    muted,
    duration,
    note,
    inCall: status !== 'idle',
    failed: status === 'failed',
    startCall,
    reportUnavailable,
    dismissCall: reset,
    acceptCall,
    declineCall,
    endCall,
    toggleMute
  };
}

export const formatCallDuration = (secs) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

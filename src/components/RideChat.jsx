import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowUp } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../context/LanguageContext';
import { useKeyboardOverlap } from '../lib/keyboard';

const haptic = async (s = ImpactStyle.Light) => { try { await Haptics.impact({ style: s }); } catch(e) {} };

export default function RideChat({ rideId, userId, driverName, onClose }) {
  const { t } = useLanguage();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const keyboardHeight = useKeyboardOverlap();
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Keep the newest message in view as the composer lifts above the keyboard
  useEffect(() => {
    if (keyboardHeight > 0 && scrollRef.current) {
      const t = setTimeout(() => { scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, 50);
      return () => clearTimeout(t);
    }
  }, [keyboardHeight]);

  // Load and poll messages
  useEffect(() => {
    if (!rideId) return;

    let isPolling = true;

    const loadMessages = async () => {
      if (!isPolling) return;
      const { data } = await supabase
        .from('ride_messages')
        .select('*')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true });
        
      if (data) {
        setMessages(data);
        
        // Mark incoming messages as read
        const unreadIncoming = data.filter(m => m.sender_id !== userId && !m.is_read);
        if (unreadIncoming.length > 0) {
          const unreadIds = unreadIncoming.map(m => m.id);
          await supabase.from('ride_messages')
            .update({ is_read: true })
            .in('id', unreadIds);
            
          // We don't need to refetch immediately; next poll will catch it
        }
      }
    };
    
    // Initial load
    loadMessages();

    // Poll every 3 seconds
    const intervalId = setInterval(loadMessages, 3000);

    // Realtime subscription (keep as immediate fallback for new inserts)
    const channel = supabase
      .channel(`ride-chat-${rideId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'ride_messages',
        filter: `ride_id=eq.${rideId}`
      }, (payload) => {
        setMessages(prev => {
          if (prev.some(m => m.id === payload.new.id)) return prev;
          if (payload.new.sender_id !== userId) haptic();
          return [...prev, payload.new];
        });
      })
      .subscribe();

    return () => { 
      isPolling = false;
      clearInterval(intervalId);
      supabase.removeChannel(channel); 
    };
  }, [rideId, userId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    haptic(ImpactStyle.Medium);
    setSending(true);

    const msg = input.trim();
    setInput('');

    // Optimistic add
    const optimistic = {
      id: `temp-${Date.now()}`,
      ride_id: rideId,
      sender_id: userId,
      sender_role: 'driver',
      message: msg,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const { data, error } = await supabase.from('ride_messages').insert({
        ride_id: rideId,
        sender_id: userId,
        sender_role: 'driver',
        message: msg
      }).select().single();

      if (error) throw error;

      // Replace optimistic with real
      setMessages(prev => prev.map(m => m.id === optimistic.id ? data : m));
    } catch (e) {
      console.warn('Send failed:', e);
      // Mark as failed
      setMessages(prev => prev.map(m => m.id === optimistic.id ? { ...m, failed: true } : m));
    } finally {
      setSending(false);
    }
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: '100%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '100%' }}
      transition={{ type: 'tween', duration: 0.25 }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        height: 'var(--vv-height, 100dvh)',
        background: '#F9F9F9',
        display: 'flex', flexDirection: 'column'
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'calc(var(--safe-top, 0px) + 16px) 20px 16px',
        borderBottom: '1px solid #FFFFFF'
      }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic(); onClose(); }}
          style={{ background: 'transparent', border: '1px solid #EBEBEB', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={16} color="#000" />
        </motion.button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.6875rem', letterSpacing: '3px', color: '#000', fontWeight: 600 }}>
            {driverName || t('client')}
          </div>
          <div style={{ fontSize: '0.5rem', letterSpacing: '1px', color: '#555', marginTop: '2px' }}>
            {t('enRoute')}
          </div>
        </div>
        <div style={{ width: '36px' }} />
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: '8px'
      }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#EBEBEB', fontSize: '0.75rem', letterSpacing: '1px', marginTop: '40px' }}>
            {t('noMessages')}
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender_id === userId;
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              style={{
                alignSelf: isMe ? 'flex-end' : 'flex-start',
                maxWidth: '75%'
              }}
            >
              <div style={{
                padding: '10px 14px',
                background: isMe ? '#000' : '#FFFFFF',
                color: isMe ? '#FFF' : '#000',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                borderRadius: isMe ? '0' : '0',
                opacity: msg.failed ? 0.5 : 1
              }}>
                {msg.message}
              </div>
              <div style={{
                fontSize: '0.5rem',
                color: '#444',
                marginTop: '4px',
                textAlign: isMe ? 'right' : 'left',
                letterSpacing: '0.5px'
              }}>
                {formatTime(msg.created_at)}
                {isMe && !msg.failed && (
                  <span style={{ marginLeft: '4px', color: msg.is_read ? '#D4CFC9' : '#888' }}>
                    {msg.is_read ? '✔✔' : '✔'}
                  </span>
                )}
                {msg.failed && ' · Failed'}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 20px calc(var(--chat-pb, 12px) + var(--safe-area-bottom, env(safe-area-inset-bottom)))',
        borderTop: '1px solid #FFFFFF',
        display: 'flex', alignItems: 'center', gap: '12px'
      }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
          placeholder={t('typeMessage')}
          style={{
            flex: 1, background: '#FFFFFF', border: '1px solid #F5F5F5',
            color: '#000', fontSize: '0.875rem', padding: '12px 16px',
            outline: 'none', fontFamily: 'var(--font-family)',
            caretColor: '#D4CFC9'
          }}
        />
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={sendMessage}
          disabled={!input.trim() || sending}
          style={{
            width: '44px', height: '44px', borderRadius: '50%',
            background: input.trim() ? '#000' : '#F5F5F5',
            border: 'none', display: 'flex', flexShrink: 0,
            alignItems: 'center', justifyContent: 'center',
            cursor: input.trim() ? 'pointer' : 'default',
            transition: 'background 0.2s ease'
          }}
        >
          <ArrowUp size={20} strokeWidth={2.5} color={input.trim() ? '#FFF' : '#555'} />
        </motion.button>
      </div>
    </motion.div>
  );
}

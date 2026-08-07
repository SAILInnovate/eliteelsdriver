import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, ArrowUp, Headphones, MessageCircle } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { supabase } from '../lib/supabase';
import { useKeyboardOverlap } from '../lib/keyboard';
import { openWhatsApp, OFFICE_WHATSAPP_DISPLAY } from '../lib/capacitor';

const haptic = async (s = ImpactStyle.Light) => { try { await Haptics.impact({ style: s }); } catch(e) {} };

/**
 * Direct line from the driver to ELS Operations. Writes into the same
 * support_messages table the PA dashboard's Customer Service inbox reads,
 * so superadmins see and answer driver messages there in real time.
 * conversation_id = the driver's user id (same model as PA support chats).
 */
export default function OpsChat({ userId, onClose }) {
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

  // Load thread + realtime
  useEffect(() => {
    if (!userId) return;

    const markRead = () => supabase.rpc('mark_support_read', { p_conversation: userId }).then(() => {}).catch(() => {});

    const loadMessages = async () => {
      const { data } = await supabase
        .from('support_messages')
        .select('*')
        .eq('conversation_id', userId)
        .order('created_at', { ascending: true });
      if (data) {
        setMessages(data);
        markRead();
      }
    };
    loadMessages();

    const channel = supabase
      .channel(`ops-chat-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'support_messages',
        filter: `conversation_id=eq.${userId}`
      }, (payload) => {
        setMessages(prev => {
          if (prev.some(m => m.id === payload.new.id)) return prev;
          if (payload.new.sender_id !== userId) { haptic(); markRead(); }
          return [...prev, payload.new];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'support_messages',
        filter: `conversation_id=eq.${userId}`
      }, (payload) => {
        // read-receipt flips from the operations side
        setMessages(prev => prev.map(m => m.id === payload.new.id ? payload.new : m));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    haptic(ImpactStyle.Medium);
    setSending(true);
    const msg = input.trim();
    setInput('');

    const optimistic = {
      id: `temp-${Date.now()}`,
      conversation_id: userId,
      sender_id: userId,
      content: msg,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const { data, error } = await supabase.from('support_messages').insert({
        conversation_id: userId,
        sender_id: userId,
        content: msg
      }).select().single();
      if (error) throw error;
      setMessages(prev => prev.map(m => m.id === optimistic.id ? data : m));
    } catch (e) {
      console.warn('Ops message send failed:', e?.message || e);
      setMessages(prev => prev.map(m => m.id === optimistic.id ? { ...m, failed: true } : m));
    } finally {
      setSending(false);
    }
  };

  const formatTime = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const lastOwnId = [...messages].reverse().find(m => m.sender_id === userId && !m.failed)?.id;

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
        borderBottom: '1px solid #FFFFFF', background: '#F9F9F9'
      }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic(); onClose(); }}
          style={{ background: 'transparent', border: '1px solid #EBEBEB', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={16} color="#000" />
        </motion.button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Headphones size={13} color="#8A7355" />
            <span style={{ fontSize: '0.6875rem', letterSpacing: '3px', color: '#000', fontWeight: 600 }}>ELS OPERATIONS</span>
          </div>
          <div style={{ fontSize: '0.5625rem', letterSpacing: '1px', color: '#555', marginTop: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#4CAF50', display: 'inline-block' }} />
            DIRECT LINE TO DISPATCH
          </div>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => { haptic(); openWhatsApp(); }}
          aria-label="Message the office on WhatsApp"
          style={{ background: 'transparent', border: '1px solid #EBEBEB', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <MessageCircle size={15} color="#000" />
        </motion.button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: '8px',
        WebkitOverflowScrolling: 'touch'
      }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: '48px', padding: '0 24px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#FFF', border: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <Headphones size={20} color="#8A7355" />
            </div>
            <div style={{ fontSize: '0.875rem', color: '#000', fontWeight: 600, marginBottom: '6px' }}>Message ELS Operations</div>
            <div style={{ fontSize: '0.75rem', color: '#888', lineHeight: 1.6 }}>
              Job issues, delays, vehicle problems — dispatch reads this line and replies here. Urgent? WhatsApp the office on {OFFICE_WHATSAPP_DISPLAY}.
            </div>
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
              style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '78%' }}
            >
              <div style={{
                padding: '10px 14px',
                background: isMe ? '#000' : '#FFFFFF',
                border: isMe ? 'none' : '1px solid #F0F0F0',
                color: isMe ? '#FFF' : '#000',
                fontSize: '0.9375rem',
                lineHeight: 1.5,
                borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                opacity: msg.failed ? 0.5 : 1
              }}>
                {msg.content}
              </div>
              <div style={{
                fontSize: '0.5625rem', color: '#888', marginTop: '4px',
                textAlign: isMe ? 'right' : 'left', letterSpacing: '0.5px'
              }}>
                {!isMe && <span style={{ color: '#8A7355', fontWeight: 600, marginRight: '6px' }}>OPERATIONS</span>}
                {formatTime(msg.created_at)}
                {isMe && msg.id === lastOwnId && (
                  <span style={{ marginLeft: '5px', color: msg.is_read ? '#4CAF50' : '#888', fontWeight: 600 }}>
                    {msg.is_read ? '· Read' : '· Delivered'}
                  </span>
                )}
                {msg.failed && <span style={{ color: '#EF4444' }}> · Failed to send</span>}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 20px calc(var(--chat-pb, 12px) + var(--safe-area-bottom, env(safe-area-inset-bottom)))',
        borderTop: '1px solid #FFFFFF', background: '#F9F9F9',
        display: 'flex', alignItems: 'center', gap: '12px'
      }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
          placeholder="Message Operations..."
          style={{
            flex: 1, background: '#FFFFFF', border: '1px solid #EBEBEB',
            borderRadius: '22px',
            color: '#000', fontSize: '0.9375rem', padding: '12px 18px',
            outline: 'none', fontFamily: 'var(--font-family)',
            caretColor: '#8A7355'
          }}
        />
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={sendMessage}
          disabled={!input.trim() || sending}
          style={{
            width: '44px', height: '44px', borderRadius: '50%',
            background: input.trim() ? '#000' : '#EFEFEF',
            border: 'none', display: 'flex', flexShrink: 0,
            alignItems: 'center', justifyContent: 'center',
            cursor: input.trim() ? 'pointer' : 'default',
            transition: 'background 0.2s ease'
          }}
        >
          <ArrowUp size={20} strokeWidth={2.5} color={input.trim() ? '#FFF' : '#999'} />
        </motion.button>
      </div>
    </motion.div>
  );
}

import React, { createContext, useContext, useState, useEffect } from 'react';
import translations from '../i18n/translations';

const SUPPORTED = ['en', 'de', 'es', 'fr', 'ar', 'ur'];
const RTL_LANGS = ['ar', 'ur'];

function detectLanguage() {
  // Check localStorage first (user override)
  const saved = localStorage.getItem('els_lang');
  if (saved && SUPPORTED.includes(saved)) return saved;
  
  // Auto-detect from browser
  const browser = navigator.language?.slice(0, 2)?.toLowerCase();
  if (browser && SUPPORTED.includes(browser)) return browser;
  
  return 'en';
}

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(detectLanguage);

  const setLang = (code) => {
    if (!SUPPORTED.includes(code)) return;
    localStorage.setItem('els_lang', code);
    setLangState(code);
  };

  const isRTL = RTL_LANGS.includes(lang);

  // Apply RTL to the document
  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang, isRTL]);

  const t = (key) => {
    return translations[lang]?.[key] || translations.en?.[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, isRTL, supportedLanguages: SUPPORTED }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}

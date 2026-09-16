import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

const LANG_KEY = 'todoquant_language';

const getSavedLanguage = (): string => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh-CN' || saved === 'en-US') return saved;
  } catch {}
  try {
    return navigator.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
  } catch {}
  return 'en-US';
};

const initialLang = getSavedLanguage();

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
    },
    lng: initialLang,
    fallbackLng: 'zh-CN',
    interpolation: {
      escapeValue: false,
    },
  });

document.documentElement.lang = initialLang;

fetch('/api/system/locale', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ locale: initialLang }),
}).catch(() => {});

export function switchLanguage(lng: string): void {
  if (lng !== 'zh-CN' && lng !== 'en-US') return;
  try {
    localStorage.setItem(LANG_KEY, lng);
  } catch {}
  i18n.changeLanguage(lng);
  document.documentElement.lang = lng;
  fetch('/api/system/locale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale: lng }),
  }).catch(() => {});
}

export default i18n;

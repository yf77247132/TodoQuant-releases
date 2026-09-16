import {
  LOG_TEMPLATES,
  DESC_FIELD_EN,
  DESC_VALUE_EN,
  CANCEL_FIELD_EN,
  ORDER_TYPE_EN,
  ORDER_FIELD_EN,
} from '../src/lib/logTemplates.ts';

const templates = Object.keys(LOG_TEMPLATES).map((key) => {
  const t = LOG_TEMPLATES[key];
  return { key, zh: typeof t.zh === 'function', en: typeof t.en === 'function' };
});

const payload = {
  templates,
  maps: {
    df: DESC_FIELD_EN,
    dv: DESC_VALUE_EN,
    cf: CANCEL_FIELD_EN,
    ot: ORDER_TYPE_EN,
    of: ORDER_FIELD_EN,
  },
};

process.stdout.write(JSON.stringify(payload) + '\n');

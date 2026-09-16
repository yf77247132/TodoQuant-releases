
import i18next from 'i18next';

export const getPaymentOptions = (t: (key: string) => string = i18next.t.bind(i18next)) => [
  { label: t('margin.fundingAccount'), value: 'funding' },
  { label: t('margin.savingsUsdt'), value: 'savings' },
];

export const getOkxDestOptions = (t: (key: string) => string = i18next.t.bind(i18next)) => [
  { label: t('margin.tradingAccount'), value: '18' },
];

export const getBinanceDestOptions = (t: (key: string) => string = i18next.t.bind(i18next)) => [
  { label: t('margin.spotAccount'), value: 'SPOT' },
  { label: t('margin.marginAccountCross'), value: 'MARGIN' },
  { label: t('margin.futuresAccountUsdt'), value: 'USDT_FUTURE' },
];

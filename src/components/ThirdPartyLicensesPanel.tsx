import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/Badge.tsx';

interface LicenseEntry {
  name: string;
  license: string;
  source: string;
  descKey: string;
}

const LICENSES: LicenseEntry[] = [
  {
    name: 'freqtrade',
    license: 'GPL-3.0',
    source: 'https://github.com/freqtrade/freqtrade',
    descKey: 'thirdParty.freqtradeDesc',
  },
  {
    name: 'technical',
    license: 'GPL-3.0',
    source: 'https://github.com/freqtrade/technical',
    descKey: 'thirdParty.technicalDesc',
  },
];

interface ThirdPartyLicensesPanelProps {
  className?: string;
}

function LicenseCard({ item }: { item: LicenseEntry }) {
  return (
    <div className="rounded-lg border border-brand-yellow/40 bg-brand-yellow/5 p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm font-semibold text-text-primary">{item.name}</span>
        <Badge variant="warning" className="!bg-brand-yellow !text-surface-0">
          {item.license}
        </Badge>
      </div>
      <p className="text-xs text-text-tertiary mb-2">
        <DescriptionRenderer descKey={item.descKey} />
      </p>
      <a
        href={item.source}
        target="_blank"
        rel="noopener noreferrer"
        className="text-2xs text-brand-blue hover:underline"
      >
        {item.source}
      </a>
    </div>
  );
}

function DescriptionRenderer({ descKey }: { descKey: string }) {
  const { t } = useTranslation();
  return <>{t(descKey)}</>;
}

function ThirdPartyLicensesPanelInner({ className }: ThirdPartyLicensesPanelProps) {
  const { t } = useTranslation();

  return (
    <div className={`bg-surface-2 rounded-xl p-6 ${className ?? ''}`}>
      <h2 className="text-base font-bold text-text-primary mb-2">{t('thirdParty.title')}</h2>
      <p className="text-xs text-text-tertiary mb-5 leading-relaxed">
        {t('thirdParty.intro')}
      </p>

      <div>
        <h3 className="text-sm font-semibold text-brand-yellow mb-3 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-yellow" />
          {t('thirdParty.gplSection')}
        </h3>
        <div className="grid gap-3">
          {LICENSES.map((item) => (
            <LicenseCard key={item.name} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const ThirdPartyLicensesPanel = React.memo(ThirdPartyLicensesPanelInner);

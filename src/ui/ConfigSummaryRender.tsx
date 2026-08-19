import { memo } from 'react';
import i18next from 'i18next';

function translateConfigValue(value: string): string {
  if (i18next.language?.startsWith('en')) {
    if (value === '账户(已删除)') return 'Account (deleted)';
    if (value === '未选择账号') return 'No account selected';
  }
  return value;
}

export interface DescSegment {
  label: string;
  value: string;
  style?: 'value' | 'green' | 'red' | 'yellow-on' | 'gray-off';
}

interface ConfigSummaryRenderProps {
  segments: DescSegment[];
  accountColor?: string;
  className?: string;
}

const ConfigSummaryRender = memo(({ 
  segments, 
  accountColor,
  className = "flex flex-wrap items-center gap-1"
}: ConfigSummaryRenderProps) => {
  const renderValue = (seg: DescSegment) => {
    if (seg.label === i18next.t('amend.account') || seg.label === 'Account') {
      return (
        <span style={{ color: accountColor || undefined }} className="text-xs tracking-tight font-bold truncate block">
          {translateConfigValue(seg.value)}
        </span>
      );
    }
    if (seg.style === 'green' || seg.style === 'red') {
      return <span className={`text-xs tracking-tight font-medium truncate block ${seg.style === 'green' ? 'text-trade-green' : 'text-trade-red'}`}>{seg.value}</span>;
    }
    return (
      <span className={`
        text-xs tracking-tight truncate block
        ${!seg.style || seg.style === 'value' ? 'text-brand-blue font-medium' : ''}
        ${seg.style === 'yellow-on' ? 'font-medium text-brand-yellow' : ''}
        ${seg.style === 'gray-off' ? 'font-medium text-text-tertiary' : ''}
      `}>{seg.value}</span>
    );
  };

  return (
    <div className={className}>
      {segments.map((seg, index) => (
        <div key={`${seg.label}:${seg.value}:${index}`} className="px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 border border-border-default bg-surface-1 w-fit max-w-full">
          <span className="text-text-tertiary font-normal shrink-0">{seg.label}</span>
          <div className="flex items-center min-w-0">
            {renderValue(seg)}
          </div>
        </div>
      ))}
    </div>
  );
});

ConfigSummaryRender.displayName = 'ConfigSummaryRender';

export default ConfigSummaryRender;

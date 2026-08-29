import { useTranslation } from 'react-i18next';
import { type ReactNode } from 'react';
import { Plus, FileX2 } from 'lucide-react';
import Button from './Button.tsx';
import { EmptyState } from './EmptyState';

interface EmptyConfigsProps {
  label: string;
  onAdd: () => void;
}

export function EmptyConfigs({ label, onAdd }: EmptyConfigsProps) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<FileX2 className="w-full h-full" />}
      title={label}
      variant="card"
      action={
        <Button
          variant="secondary"
          onClick={onAdd}
        >
          <Plus className="w-3.5 h-3.5" />
          {t('ui.configListLayout.addFirstConfig')}
        </Button>
      }
    />
  );
}

interface ConfigListLayoutProps {
  children: ReactNode;
  logPanel: ReactNode;
  listColSpan?: number | string;
  logColSpan?: number | string;
  listClassName?: string;
}

const SPAN_CLASS_MAP: Record<number, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
  6: 'lg:col-span-6',
  7: 'lg:col-span-7',
  8: 'lg:col-span-8',
  9: 'lg:col-span-9',
  10: 'lg:col-span-10',
  11: 'lg:col-span-11',
  12: 'lg:col-span-12',
};

function toSpanClass(span: number | string): string {
  const parsed = Number(span);
  const normalized = Number.isFinite(parsed)
    ? Math.min(12, Math.max(1, Math.trunc(parsed)))
    : 1;
  return SPAN_CLASS_MAP[normalized];
}

export default function ConfigListLayout({
  children,
  logPanel,
  listColSpan = 5,
  logColSpan = 7,
  listClassName = '',
}: ConfigListLayoutProps) {
  const listSpanClass = toSpanClass(listColSpan);
  const logSpanClass = toSpanClass(logColSpan);

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0 w-full mt-4">
      <div className={`${listSpanClass} flex flex-col min-h-0 h-full ${listClassName}`}>
        <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-3 pr-2 custom-scrollbar">
          {children}
        </div>
      </div>

      <div className={`${logSpanClass} flex flex-col min-h-0 min-w-0 h-full`}>
        {logPanel}
      </div>
    </div>
  );
}

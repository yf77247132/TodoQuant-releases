import { createPortal } from 'react-dom';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import NumberInput from './NumberInput.tsx';
import Button from './Button.tsx';
import { Spinner } from './Spinner.tsx';
import { getOrderTypeLabel } from '../constants/orderTypes.ts';

export interface ConvertOrderInfo {
  ordId?: string;
  algoId?: string;
  instId: string;
  side: string;
  sz: string;
  ordType: string;
  tdMode?: string;
  posSide?: string;
  _accountId?: string;
  _account: number;
  exchange?: string;
}

interface ConvertOrderModalProps {
  open: boolean;
  order: ConvertOrderInfo | null;
  onClose: () => void;
  onSuccess: () => void;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export default function ConvertOrderModal({
  open,
  order,
  onClose,
  onSuccess,
  showToast,
}: ConvertOrderModalProps) {
  const { t } = useTranslation();
  const [chaseVal, setChaseVal] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  const handleChaseValChange = useCallback((value: string) => {
    setChaseVal(value);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!order) return;

    setSubmitting(true);
    try {
      const cancelRes = await fetch('/api/order/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: order._accountId || '',
          _account: order._account,
          instId: order.instId,
          ordId: order.ordId || undefined,
          algoId: order.algoId || undefined,
          tdMode: order.tdMode,
        }),
      });
      const cancelData = await cancelRes.json();
      if (!cancelData.ok) {
        showToast(t('convert.cancelFailed'), 'error');
        return;
      }

      const placeRes = await fetch('/api/trader/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: order._accountId || '',
          inst_id: order.instId,
          order_type: 'chase',
          side: order.side,
          pos_side: order.posSide || 'net',
          td_mode: order.tdMode || 'cross',
          contract_size: order.sz,
          chase_val: chaseVal,
          order_count: '1',
          order_interval: '1000',
          first_order_price: '-1',
          price_increment: '0',
          take_profit_margin: '-1',
          stop_loss_margin: '-1',
          first_tp_price: '-1',
          first_sl_price: '-1',
          callback_ratio: '0.01',
          callback_spread: '-1',
          active_px: '-1',
          place_test_mode: false,
        }),
      });
      const placeData = await placeRes.json();
      if (!placeData.ok) {
        showToast(t('convert.placeFailedAfterCancel'), 'error');
        return;
      }

      showToast(t('convert.success'), 'success');
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }, [order, chaseVal, onClose, onSuccess, showToast, t]);

  if (!open || !order) return null;

  const sideLabel = order.side === 'buy' ? t('order.buy') : t('order.sell');
  const orderTypeLabel = t(getOrderTypeLabel(order.ordType));

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-confirm)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      data-modal-open="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-md bg-surface-2 border border-border-default p-6 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-text-secondary mb-4">{t('convert.title')}</h3>

        <div className="bg-surface-1 rounded-xl p-4 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-text-tertiary">{t('convert.currentType')}</span>
            <span className="text-text-primary">{orderTypeLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">{t('convert.targetType')}</span>
            <span className="text-brand-yellow">{t('order.typeChase')}</span>
          </div>
          <div className="h-px bg-border-subtle my-1" />
          <div className="flex justify-between">
            <span className="text-text-tertiary">{t('convert.instId')}</span>
            <span className="text-text-primary font-mono">{order.instId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">{t('convert.side')}</span>
            <span className={order.side === 'buy' ? 'text-trade-green' : 'text-trade-red'}>{sideLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">{t('convert.size')}</span>
            <span className="text-brand-blue font-mono">{order.sz}</span>
          </div>
        </div>

        <div className="mb-6">
          <NumberInput
            label={t('place.form.chaseValLabel')}
            tooltip={t('place.form.chaseValTooltip')}
            value={chaseVal}
            defaultValue="0"
            placeholder="0"
            onChange={handleChaseValChange}
            min={0}
            step="any"
          />
        </div>

        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            size="md"
            onClick={onClose}
            className="rounded-xl"
            disabled={submitting}
          >
            {t('ui.confirmModal.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            className="rounded-xl"
            onClick={handleConvert}
            disabled={submitting}
          >
            {submitting ? <Spinner size="xs" /> : t('convert.confirm')}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

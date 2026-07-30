
import DashedHint from '../ui/DashedHint'
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '../ui/Spinner.tsx';
import { filterOrderTypesByContext } from '../constants/orderTypes.ts';
import AccountSelect from '../ui/AccountSelect.tsx';
import InstrumentInput from '../ui/InstrumentInput.tsx';
import Select from '../ui/Select.tsx';
import NumberInput from '../ui/NumberInput.tsx';
import FormulaPriceField from '../ui/FormulaPriceField.tsx';
import { Tooltip } from '../ui/Tooltip.tsx';
import Button from '../ui/Button.tsx';
import { LABEL_BASE } from '../ui/inputStyles.ts';
import { safeStorageGet, safeStorageSet } from '../lib/safeStorage.ts';

const isRegularOrder = (t: string) => ['market', 'limit', 'post_only', 'fok', 'ioc'].includes(t);
const isTrigger = (t: string) => t === 'trigger';
const isConditional = (t: string) => t === 'conditional';
const isOCO = (t: string) => t === 'oco';
const isChase = (t: string) => t === 'chase';
const isMoveOrderStop = (t: string) => t === 'move_order_stop';

export interface QuickTradePanelProps {
  accounts: Array<{ id: string; name: string; exchange?: string }>;
  accountNames: Record<string, string>;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export default function QuickTradePanel({
  accounts,
  showToast,
}: QuickTradePanelProps) {
  const { t } = useTranslation();

  const STORAGE_KEY = 'quick-trade-form';

  const [form, setForm] = useState(() => {
    const saved = safeStorageGet<Record<string, string>>(STORAGE_KEY, {});
    return {
      accountId: saved.accountId || accounts[0]?.id || '',
      instId: saved.instId || 'BTC-USDT-SWAP',
      posSide: saved.posSide || 'net',
      tdMode: saved.tdMode || 'cross',
      side: (saved.side as 'buy' | 'sell') || 'buy',
      orderType: saved.orderType || 'limit',
      tpSlType: saved.tpSlType || 'tp_sl',
      firstOrderPrice: saved.firstOrderPrice || '10000',
      takeProfitMargin: saved.takeProfitMargin || '-1',
      stopLossMargin: saved.stopLossMargin || '-1',
      firstTpPrice: saved.firstTpPrice || '-1',
      firstSlPrice: saved.firstSlPrice || '-1',
      chaseVal: saved.chaseVal || '0',
      callbackRatioSpread: saved.callbackRatioSpread || '1%',
      activePx: saved.activePx || '-1',
      orderInterval: saved.orderInterval || '1000',
      contractSize: saved.contractSize || '1',
    };
  });

  useEffect(() => {
    safeStorageSet(STORAGE_KEY, form);
  }, [form]);

  const { accountId, instId, posSide, tdMode, side, orderType, tpSlType,
    firstOrderPrice, takeProfitMargin, stopLossMargin, firstTpPrice, firstSlPrice,
    chaseVal, callbackRatioSpread, activePx, orderInterval, contractSize } = form;

  const updateForm = useCallback((key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const [pricePreviews, setPricePreviews] = useState<Record<string, { text: string | null; error: boolean }>>({});

  const [submitting, setSubmitting] = useState(false);

  const currentAccount = useMemo(() =>
    accounts.find(a => a.id === accountId),
    [accounts, accountId]
  );
  const currentExchange = currentAccount?.exchange?.toUpperCase() || 'OKX';
  const isSpot = useMemo(() => {
    if (!instId) return true;
    const upper = instId.toUpperCase();
    return !upper.includes('SWAP') && !upper.includes('PERP') && !upper.includes('FUTURES');
  }, [instId]);

  const filteredOrderTypeOptions = useMemo(() => {
    return filterOrderTypesByContext(currentExchange, isSpot, tdMode);
  }, [currentExchange, isSpot, tdMode]);

  React.useEffect(() => {
    if (!filteredOrderTypeOptions.some(o => o.value === orderType)) {
      updateForm('orderType', 'limit');
    }
  }, [filteredOrderTypeOptions, orderType, updateForm]);

  const handleFormulaBlur = useCallback(async (field: string, value: string) => {
    if (!value || !value.startsWith('=')) {
      setPricePreviews(prev => ({ ...prev, [field]: { text: null, error: false } }));
      return;
    }
    try {
      const res = await fetch('/api/evaluate-formula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression: value, instId }),
      });
      const data = await res.json();
      if (data.ok && data.result !== undefined) {
        setPricePreviews(prev => ({ ...prev, [field]: { text: String(data.result), error: false } }));
      } else {
        setPricePreviews(prev => ({ ...prev, [field]: { text: data.error || 'Error', error: true } }));
      }
    } catch {
      setPricePreviews(prev => ({ ...prev, [field]: { text: 'Network error', error: true } }));
    }
  }, [instId]);

  const handleSubmit = useCallback(async (submitSide: 'buy' | 'sell') => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        account_id: accountId,
        inst_id: instId,
        order_type: orderType,
        side: submitSide,
        pos_side: posSide,
        td_mode: tdMode,
        order_direction: side === 'buy' ? 'up' : 'down',
        first_order_price: firstOrderPrice,
        order_interval: orderInterval,
        order_count: '1',
        contract_size: contractSize,
        take_profit_margin: takeProfitMargin,
        stop_loss_margin: stopLossMargin,
        first_tp_price: firstTpPrice,
        first_sl_price: firstSlPrice,
        chase_val: chaseVal,
        callback_ratio_spread: callbackRatioSpread,
        active_px: activePx,
        tp_sl_type: tpSlType,
        place_test_mode: false,
        skip_duplicate_orders: false,
      };
      const res = await fetch('/api/trader/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        const sideLabel = submitSide === 'buy' ? t('place.option.sideBuy') : t('place.option.sideSell');
        const orderCount = data.successCount ?? 1;
        showToast(t('common.orderPlacedToast', { side: sideLabel, count: orderCount }), 'success');
      } else {
        const msg = data.firstError || data.msg || t('common.operationFailed');
        showToast(msg, 'error');
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      showToast(error.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, accountId, instId, orderType, side, posSide, tdMode, firstOrderPrice, orderInterval, contractSize, takeProfitMargin, stopLossMargin, firstTpPrice, firstSlPrice, chaseVal, callbackRatioSpread, activePx, tpSlType, showToast, t]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <AccountSelect
            value={accountId}
            onChange={(v: string) => updateForm('accountId', v)}
            accounts={accounts}
          />
          <InstrumentInput
            label={t('place.form.instIdLabel')}
            tooltip={t('place.form.instIdTooltip')}
            value={instId}
            defaultValue="BTC-USDT-SWAP"
            placeholder="BTC-USDT-SWAP"
            exchange={currentExchange}
            onChange={(v: string) => updateForm('instId', v)}
          />

          <div className="space-y-1.5">
            <label className={LABEL_BASE}>
              <Tooltip content={t('place.form.posModeTooltip')}>
                <DashedHint className={`cursor-help ${isSpot ? 'border-gray-600' : ''}`}>
                  {t('place.form.posModeLabel')}
                </DashedHint>
              </Tooltip>
            </label>
            <Select
              value={posSide}
              onChange={(e) => updateForm('posSide', e.target.value)}
              className={
                isSpot
                  ? ''
                  : posSide === 'long'
                    ? '!text-trade-green'
                    : posSide === 'short'
                      ? '!text-trade-red'
                      : '!text-text-primary'
              }
              disabled={isSpot}
            >
              <option value="net" className="!text-text-primary">{t('place.option.posSideNet')}</option>
              <option value="long" className="!text-trade-green">{t('place.option.posSideLong')}</option>
              <option value="short" className="!text-trade-red">{t('place.option.posSideShort')}</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className={LABEL_BASE}>
              <Tooltip content={t('place.form.tdModeTooltip')}>
                <DashedHint className={`cursor-help ${(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot ? 'border-gray-600' : ''}`}>
                  {t('place.form.tdModeLabel')}
                </DashedHint>
              </Tooltip>
            </label>
            <Select
              value={tdMode}
              onChange={(e) => updateForm('tdMode', e.target.value)}
              disabled={(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot}
            >
              {isSpot && <option value="cash">{t('place.option.tdModeCash')}</option>}
              <option value="cross">{t('place.option.tdModeCross')}</option>
              <option value="isolated">{t('place.option.tdModeIsolated')}</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className={LABEL_BASE}>
              <Tooltip content={t('common.orderTypeMapping')}>
                <DashedHint className="cursor-help">
                  {t('place.form.orderTypeLabel')}
                </DashedHint>
              </Tooltip>
            </label>
            <Select
              value={orderType}
              onChange={(e) => updateForm('orderType', e.target.value)}
            >
              {filteredOrderTypeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
              ))}
            </Select>
          </div>

          {(isRegularOrder(orderType) || isTrigger(orderType)) && (
            <div className="space-y-1.5">
              <label className={LABEL_BASE}>
                <Tooltip content={t('place.form.tpSlTypeTooltip')}>
                  <DashedHint className="cursor-help">
                    {t('place.form.tpSlTypeLabel')}
                  </DashedHint>
                </Tooltip>
              </label>
              <Select
                value={tpSlType}
                onChange={(e) => updateForm('tpSlType', e.target.value)}
              >
                <option value="tp_sl">{t('place.option.tpSl')}</option>
                {!isSpot && <option value="move_stop">{t('place.option.moveStop')}</option>}
              </Select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {((isRegularOrder(orderType) && orderType !== 'market') || isTrigger(orderType)) && (
            <FormulaPriceField
              label={isTrigger(orderType) ? t('place.form.triggerOrOrderPrice') : t('place.form.firstOrderPrice')}
              tooltip={t('place.form.firstOrderPriceFormulaTooltip')}
              value={firstOrderPrice}
              placeholder="10000"
              onChange={(v: string) => updateForm('firstOrderPrice', v)}
              preview={pricePreviews['first_order_price']?.text ?? null}
              previewError={pricePreviews['first_order_price']?.error ?? false}
              onBlur={() => handleFormulaBlur('first_order_price', firstOrderPrice)}
              onFocus={() => {}}
            />
          )}

          {(isRegularOrder(orderType) || isTrigger(orderType)) && (
            <>
              {tpSlType === 'tp_sl' ? (
                <NumberInput
                  label={t('place.form.tpMarginLabel')}
                  tooltip={t('place.form.tpMarginTooltip')}
                  value={takeProfitMargin}
                  defaultValue="-1"
                  placeholder="-1"
                  onChange={(v: string) => updateForm('takeProfitMargin', v)}
                  min={-1}
                  step="any"
                  disabled={(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot}
                  allowPercent
                />
              ) : (
                <>
                  <NumberInput
                    label={t('place.form.callbackRatioSpreadLabel')}
                    tooltip={t('place.form.callbackRatioSpreadTooltip')}
                    value={callbackRatioSpread}
                    defaultValue="1%"
                    placeholder="1% 或 0.01"
                    onChange={(v: string) => updateForm('callbackRatioSpread', v)}
                    min={-1}
                    step="any"
                    disabled={currentExchange === 'BINANCE' || currentExchange === 'Binance'}
                    allowPercent
                  />
                  <FormulaPriceField
                    label={t('place.form.activePxLabel')}
                    tooltip={t('place.form.activePxTooltip')}
                    value={activePx}
                    placeholder="-1"
                    onChange={(v: string) => updateForm('activePx', v)}
                    preview={pricePreviews['active_px']?.text ?? null}
                    previewError={pricePreviews['active_px']?.error ?? false}
                    onBlur={() => handleFormulaBlur('active_px', activePx)}
                    onFocus={() => {}}
                    disabled={currentExchange === 'BINANCE' || currentExchange === 'Binance'}
                  />
                </>
              )}
              <NumberInput
                label={t('place.form.slMarginLabel')}
                tooltip={t('place.form.slMarginTooltip')}
                value={stopLossMargin}
                defaultValue="-1"
                placeholder="-1"
                onChange={(v: string) => updateForm('stopLossMargin', v)}
                min={-1}
                step="any"
                disabled={(currentExchange === 'BINANCE' || currentExchange === 'Binance') && !isSpot}
                allowPercent
              />
            </>
          )}

          {(isConditional(orderType) || isOCO(orderType)) && (
            <>
              <FormulaPriceField
                label={isConditional(orderType) ? t('place.form.triggerOrOrderPrice') : t('place.form.tpTriggerPrice')}
                tooltip={isConditional(orderType) ? t('place.form.tpTriggerTooltip') : t('place.form.tpTriggerTooltipOco')}
                value={firstTpPrice}
                placeholder="-1"
                onChange={(v: string) => updateForm('firstTpPrice', v)}
                preview={pricePreviews['first_tp_price']?.text ?? null}
                previewError={pricePreviews['first_tp_price']?.error ?? false}
                onBlur={() => handleFormulaBlur('first_tp_price', firstTpPrice)}
                onFocus={() => {}}
              />
              {isOCO(orderType) && (
                <FormulaPriceField
                  label={t('place.form.slTriggerPrice')}
                  tooltip={t('place.form.slTriggerTooltip')}
                  value={firstSlPrice}
                  placeholder="-1"
                  onChange={(v: string) => updateForm('firstSlPrice', v)}
                  preview={pricePreviews['first_sl_price']?.text ?? null}
                  previewError={pricePreviews['first_sl_price']?.error ?? false}
                  onBlur={() => handleFormulaBlur('first_sl_price', firstSlPrice)}
                  onFocus={() => {}}
                />
              )}
            </>
          )}

          {isChase(orderType) && (
            <NumberInput
              label={t('place.form.chaseValLabel')}
              tooltip={t('place.form.chaseValTooltip')}
              value={chaseVal}
              defaultValue="0"
              placeholder="0"
              onChange={(v: string) => updateForm('chaseVal', v)}
              min={0}
              step="any"
            />
          )}

          {isMoveOrderStop(orderType) && (
            <>
              <NumberInput
                label={t('place.form.callbackRatioSpreadLabel')}
                tooltip={t('place.form.callbackRatioSpreadTooltip')}
                value={callbackRatioSpread}
                defaultValue="1%"
                placeholder="1% 或 0.01"
                onChange={(v: string) => updateForm('callbackRatioSpread', v)}
                min={-1}
                step="any"
                allowPercent
              />
              <FormulaPriceField
                label={t('place.form.activePxLabel')}
                tooltip={t('place.form.activePxTooltip')}
                value={activePx}
                placeholder="-1"
                onChange={(v: string) => updateForm('activePx', v)}
                preview={pricePreviews['active_px']?.text ?? null}
                previewError={pricePreviews['active_px']?.error ?? false}
                onBlur={() => handleFormulaBlur('active_px', activePx)}
                onFocus={() => {}}
              />
            </>
          )}

          <FormulaPriceField
            label={t('place.form.contractSizeLabel')}
            tooltip={t('place.form.contractSizeFormulaTooltip')}
            value={contractSize}
            placeholder="1 或 =10*1.2^n"
            onChange={(v: string) => updateForm('contractSize', v)}
            preview={pricePreviews['contract_size']?.text ?? null}
            previewError={pricePreviews['contract_size']?.error ?? false}
            onBlur={() => handleFormulaBlur('contract_size', contractSize)}
            onFocus={() => {}}
          />
        </div>
      </div>

      <div className="shrink-0 p-3 border-t border-border-subtle flex gap-3">
        <Button
          size="md"
          className="flex-1 py-2.5 rounded-xl font-bold !bg-trade-green !text-white hover:!bg-trade-green/90"
          onClick={() => handleSubmit('buy')}
          disabled={submitting}
        >
          {submitting ? <Spinner size="sm" /> : null}
          {t('place.option.sideBuy')}
        </Button>
        <Button
          size="md"
          className="flex-1 py-2.5 rounded-xl font-bold !bg-trade-red !text-white hover:!bg-trade-red/90"
          onClick={() => handleSubmit('sell')}
          disabled={submitting}
        >
          {submitting ? <Spinner size="sm" /> : null}
          {t('place.option.sideSell')}
        </Button>
      </div>
    </div>
  );
}

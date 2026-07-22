import React, { useEffect, useRef, memo, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { Settings, X, List, Trash2, AlertTriangle, ArrowUpToLine, LineChart } from 'lucide-react';
import { Spinner } from '../ui/Spinner.tsx';
import type { PartialAppConfig, TradingViewSettings } from '../types/core.ts';
import { useClickOutside } from '../hooks/useClickOutside.ts';
import { setWatchlistToFavorites } from '../lib/favoriteInstruments.ts';
import ConfirmModal from '../ui/ConfirmModal.tsx';
import ConfigHeader from '../ui/ConfigHeader.tsx';
import Button from '../ui/Button.tsx';
import TextInput from '../ui/TextInput.tsx';

class TradingViewErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  constructor(props: { children: React.ReactNode }) {
    super(props);
  }

  static getDerivedStateFromError(_: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn("TradingView 组件错误:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-surface-3 rounded-xl border border-border-default text-text-tertiary p-8 text-center">
          <AlertTriangle className="w-12 h-12 mb-4 text-brand-yellow/50" />
          <p className="text-sm font-medium mb-2">{i18next.t('tradingview.chartError')}</p>
          <p className="text-xs mb-4">{i18next.t('tradingview.chartErrorDesc')}</p>
          <Button variant="primary" onClick={() => this.setState({ hasError: false })}>
            {i18next.t('common.retry')}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface TradingViewModuleProps {
  isActive?: boolean;
  config: PartialAppConfig;
  updateConfig: (cfg: Partial<PartialAppConfig>) => void;
}

function TradingViewWidget({ isActive = true, config, updateConfig }: TradingViewModuleProps) {
  const { t, i18n } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  const watchlist = useMemo(() => {
    try {
      const saved = config.chart_watchlist;
      if (!saved) return ["BINANCE:BTCUSDT.P", "BINANCE:ETHUSDT.P", "BINANCE:SOLUSDT.P", "BINANCE:DOGEUSDT.P", "BINANCE:XRPUSDT.P", "BINANCE:XAUUSDT.P"];
      if (Array.isArray(saved)) return saved;
      return JSON.parse(saved as string);
    } catch (e) {
      return ["BINANCE:BTCUSDT.P", "BINANCE:ETHUSDT.P", "BINANCE:SOLUSDT.P", "BINANCE:DOGEUSDT.P", "BINANCE:XRPUSDT.P", "BINANCE:XAUUSDT.P"];
    }
  }, [config.chart_watchlist]);

  useEffect(() => {
    if (watchlist.length > 0) {
      setWatchlistToFavorites(watchlist);
    }
  }, []);

  const settings = useMemo((): TradingViewSettings => {
    try {
      const saved = config.chart_settings;
      if (!saved) return { symbol: "BINANCE:BTCUSDT.P", interval: "1" };
      if (typeof saved === 'object') return saved as TradingViewSettings;
      return JSON.parse(saved as string);
    } catch (e) {
      return { symbol: "BINANCE:BTCUSDT.P", interval: "1" };
    }
  }, [config.chart_settings]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  useClickOutside(settingsPanelRef, () => setIsSettingsOpen(false));
  const [tempSettings, setTempSettings] = useState<TradingViewSettings>(settings);

  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const watchlistPanelRef = useRef<HTMLDivElement>(null);
  useClickOutside(watchlistPanelRef, () => setIsWatchlistOpen(false));
  const [tempWatchlist, setTempWatchlist] = useState<string[]>(watchlist);
  const [newSymbol, setNewSymbol] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  
  const [renderKey, setRenderKey] = useState(() => `0-${i18n.language}`);
  const lastActiveState = useRef<{ refreshKey: number; lang: string; timezone: string; watchlistRef?: string[] }>({ refreshKey: 0, lang: i18n.language, timezone: config.timezone || '' });

  useEffect(() => {
    const currentLang = i18n.language;
    const currentTimezone = config.timezone || '';
    if (isActive) {
      if (lastActiveState.current.lang !== currentLang || lastActiveState.current.timezone !== currentTimezone || lastActiveState.current.refreshKey !== refreshKey || lastActiveState.current.watchlistRef !== watchlist) {
        lastActiveState.current.lang = currentLang;
        lastActiveState.current.timezone = currentTimezone;
        lastActiveState.current.refreshKey = refreshKey;
        lastActiveState.current.watchlistRef = watchlist;
        setRenderKey(`${refreshKey}-${currentLang}-${currentTimezone}-${watchlist.length}-${watchlist[0] || ''}`);
      }
    }
  }, [isActive, refreshKey, i18n.language, config.timezone, watchlist]);

  const [tvStatus, setTvStatus] = useState<'idle' | 'loading' | 'loaded' | 'timeout'>('idle');
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;
  const TV_TIMEOUT_MS = 8000;

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const msg = event.message ? String(event.message) : "";
      const file = event.filename ? String(event.filename) : "";

      if (
        msg === "Script error." ||
        msg.includes("ResizeObserver") ||
        file.includes("tradingview")
      ) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reasonStr = String(event.reason);
      const reasonMsg = event.reason?.message ? String(event.reason.message) : "";

      if (
        reasonStr === "Script error." ||
        reasonStr.includes("tradingview") ||
        reasonMsg === "Script error." ||
        reasonMsg.includes("tradingview") ||
        reasonMsg.includes("ResizeObserver")
      ) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  useEffect(
    () => {
      const currentContainer = container.current;
      const currentWidgetDiv = widgetRef.current;
      if (!currentContainer || !currentWidgetDiv) return;

      setTvStatus('loading');

      let cancelled = false;

      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      script.type = "text/javascript";
      script.async = true;

      const mappedWatchlist: string[] = watchlist && watchlist.length > 0
        ? watchlist.map((s: string) => s.replace(/\.P$/, 'PERP'))
        : ["BINANCE:BTCUSDT"];

      const widgetConfig: Record<string, unknown> = {
        "allow_symbol_change": true,
        "calendar": false,
        "details": true,
        "hide_side_toolbar": true,
        "hide_top_toolbar": false,
        "hide_legend": false,
        "hide_volume": true,
        "hotlist": false,
        "interval": settings.interval,
        "locale": lastActiveState.current.lang.startsWith('zh') ? "zh_CN" : "en",
        "save_image": true,
        "style": "1",
        "symbol": settings.symbol.replace(/\.P$/, 'PERP'),
        "theme": "dark",
        "timezone": config.timezone === 'UTC' ? 'Etc/UTC' : (config.timezone || 'Etc/UTC'),
        "backgroundColor": "#0F0F0F",
        "gridColor": "rgba(242, 242, 242, 0.06)",
        "watchlist": mappedWatchlist,
        "withdateranges": true,
        "compareSymbols": [] as string[],
        "show_popup_button": true,
        "popup_height": "650",
        "popup_width": "1000",
        "studies": [
          "Volume@tv-basicstudies"
        ],
        "autosize": true
      };

      script.innerHTML = JSON.stringify(widgetConfig);

      currentContainer.appendChild(script);

      const checkInterval = setInterval(() => {
        if (cancelled) return;
        const iframe = currentContainer.querySelector('iframe');
        if (iframe) {
          clearInterval(checkInterval);
          clearTimeout(timeoutTimer);
          if (!cancelled) setTvStatus('loaded');
        }
      }, 1000);

      const timeoutTimer = setTimeout(() => {
        if (cancelled) return;
        clearInterval(checkInterval);
        const iframe = currentContainer.querySelector('iframe');
        if (iframe) {
          setTvStatus('loaded');
          return;
        }
        if (retryCount < MAX_RETRIES) {
          setRetryCount(c => c + 1);
          console.warn(`[TradingView] 加载超时 (${TV_TIMEOUT_MS}ms),自动重试 ${retryCount + 1}/${MAX_RETRIES}`);
          setTvStatus('loading');
          setRefreshKey(prev => prev + 1);
        } else {
          console.error(`[TradingView] 加载失败:已重试 ${MAX_RETRIES} 次仍未成功,请检查网络`);
          setTvStatus('timeout');
        }
      }, TV_TIMEOUT_MS);

      return () => {
        cancelled = true;
        clearInterval(checkInterval);
        clearTimeout(timeoutTimer);
      };
    },
    [renderKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleSaveSettings = async () => {
    try {
      setRetryCount(0);
      await updateConfig({ chart_settings: tempSettings });
      setRefreshKey(prev => prev + 1);
      setIsSettingsOpen(false);
    } catch (err) {
      console.error('保存图表设置失败:', err);
    }
  };

  const handleSaveWatchlist = async () => {
    try {
      setRetryCount(0);
      await updateConfig({ chart_watchlist: tempWatchlist });
      setWatchlistToFavorites(tempWatchlist);
      setRefreshKey(prev => prev + 1);
      setIsWatchlistOpen(false);
    } catch (err) {
      console.error('保存图表观察列表失败:', err);
    }
  };

  const handleAddSymbol = () => {
    if (newSymbol && !tempWatchlist.includes(newSymbol)) {
      setTempWatchlist([...tempWatchlist, newSymbol]);
      setNewSymbol("");
    }
  };

  const [symbolToDelete, setSymbolToDelete] = useState<string | null>(null);

  const handleRemoveSymbol = (symbol: string) => {
    setSymbolToDelete(symbol);
  };

  const confirmRemoveSymbol = () => {
    if (symbolToDelete) {
      setTempWatchlist(tempWatchlist.filter(s => s !== symbolToDelete));
      setSymbolToDelete(null);
    }
  };

  const handlePinSymbol = (symbol: string) => {
    const filtered = tempWatchlist.filter(s => s !== symbol);
    setTempWatchlist([symbol, ...filtered]);
  };

  return (
    <div className="w-full flex flex-col bg-transparent relative h-full">
      <ConfigHeader
        icon={LineChart}
        iconColor="text-brand-blue"
        title={t('tradingview.title')}
        actions={
          <div className="flex items-center gap-2 h-full">
            <Button
              onClick={() => {
                setTempSettings(settings);
                setIsSettingsOpen(!isSettingsOpen);
                setIsWatchlistOpen(false);
              }}
              className={isSettingsOpen ? '!bg-brand-yellow !text-black' : ''}
            >
              <Settings className="w-3 h-3" />
              {t('tradingview.defaultDisplay')}
            </Button>
            <Button
              onClick={() => {
                setTempWatchlist(watchlist);
                setIsWatchlistOpen(!isWatchlistOpen);
                setIsSettingsOpen(false);
              }}
              className={isWatchlistOpen ? '!bg-brand-yellow !text-black' : ''}
            >
              <List className="w-3 h-3" />
              {t('tradingview.editWatchlist')}
            </Button>
          </div>
        }
      />

      {isWatchlistOpen && (
        <div ref={watchlistPanelRef} className="absolute right-4 top-12 z-[var(--z-modal)] w-80 bg-surface-3 border border-border-default rounded-xl shadow-2xl p-4 animate-in fade-in zoom-in duration-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-text-secondary">{t('tradingview.watchlistTitle')}</h3>
            <button onClick={() => setIsWatchlistOpen(false)} className="text-text-tertiary hover:text-text-primary">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">{t('tradingview.addSymbol')}</label>
              <div className="flex gap-2">
                <TextInput
                  value={newSymbol}
                  defaultValue=""
                  onChange={setNewSymbol}
                  placeholder={t('tradingview.placeholderSymbol')}
                  className="flex-1"
                  containerClassName=""
                />
                <Button variant="primary" size="md" onClick={handleAddSymbol}>
                  {t('tradingview.add')}
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-text-tertiary leading-relaxed">
                {t('tradingview.symbolTip')}
              </p>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1.5">{t('tradingview.currentWatchlist')} ({tempWatchlist.length})</label>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                {tempWatchlist.map(symbol => (
                  <div key={symbol} className="flex items-center justify-between bg-surface-4 px-3 py-2 rounded-lg group">
                    <span className="text-xs text-text-primary font-mono">{symbol}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePinSymbol(symbol)}
                        className="text-text-muted hover:text-brand-yellow transition-colors"
                        title={t('tradingview.pin')}
                      >
                        <ArrowUpToLine className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveSymbol(symbol)}
                        className="text-text-muted hover:text-trade-red transition-colors"
                        title={t('tradingview.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button variant="primary" className="w-full mt-2" onClick={handleSaveWatchlist}>
              {t('tradingview.saveRefresh')}
            </Button>
          </div>
        </div>
      )}
      {isSettingsOpen && (
        <div ref={settingsPanelRef} className="absolute right-4 top-12 z-[var(--z-modal)] w-80 bg-surface-3 border border-border-default rounded-xl shadow-2xl p-4 animate-in fade-in zoom-in duration-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-text-secondary">{t('tradingview.chartConfig')}</h3>
            <button onClick={() => setIsSettingsOpen(false)} className="text-text-tertiary hover:text-text-primary">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">{t('tradingview.defaultSymbol')}</label>
              <TextInput
                value={tempSettings.symbol}
                defaultValue={settings.symbol}
                onChange={(val) => setTempSettings({...tempSettings, symbol: val})}
                placeholder={t('tradingview.placeholderSymbol')}
                containerClassName=""
              />
              <p className="mt-1.5 text-xs text-text-tertiary leading-relaxed">
                {t('tradingview.symbolTip')}
              </p>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1.5">{t('tradingview.defaultPeriod')}</label>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { val: "1", label: t('tradingview.period1m') },
                  { val: "3", label: t('tradingview.period3m') },
                  { val: "5", label: t('tradingview.period5m') },
                  { val: "15", label: t('tradingview.period15m') },
                  { val: "30", label: t('tradingview.period30m') },
                  { val: "60", label: t('tradingview.period1h') },
                  { val: "120", label: t('tradingview.period2h') },
                  { val: "180", label: t('tradingview.period3h') },
                  { val: "240", label: t('tradingview.period4h') },
                  { val: "D", label: t('tradingview.periodD') },
                  { val: "W", label: t('tradingview.periodW') }
                ].map(item => (
                  <button
                    key={item.val}
                    onClick={() => setTempSettings({...tempSettings, interval: item.val})}
                    className={`px-2 py-1.5 rounded text-2xs font-medium transition-all ${
                      tempSettings.interval === item.val
                        ? 'bg-brand-yellow text-black'
                        : 'bg-surface-4 text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <Button variant="primary" className="w-full mt-2" onClick={handleSaveSettings}>
              {t('tradingview.saveRefresh')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!symbolToDelete}
        message={t('tradingview.confirmDelete', { symbol: symbolToDelete })}
        onClose={() => setSymbolToDelete(null)}
        onConfirm={confirmRemoveSymbol}
      />

      <div className="w-full flex-1 min-h-0 mt-3">
        <div className="bg-surface-2 border border-border-default rounded-2xl w-full h-full overflow-hidden relative group shadow-sm">
          <style dangerouslySetInnerHTML={{ __html: `
            .tradingview-widget-container iframe {
              height: 100% !important;
              width: 100% !important;
            }
          ` }} />

          {tvStatus === 'loading' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-surface-0/80 backdrop-blur-sm rounded-xl">
              <Spinner size="lg" className="mb-3 text-brand-yellow" />
              <p className="text-xs text-text-tertiary">{t('tradingview.loadingChart')}{retryCount > 0 ? ` (${t('tradingview.retry')} ${retryCount}/${MAX_RETRIES})` : ''}...</p>
            </div>
          )}

          {tvStatus === 'timeout' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-surface-0/90 backdrop-blur-sm rounded-xl">
              <AlertTriangle className="w-10 h-10 mb-3 text-trade-red/60" />
              <p className="text-sm font-medium text-text-secondary mb-1">{t('tradingview.chartLoadFailed')}</p>
              <p className="text-xs text-text-tertiary mb-4">{t('tradingview.networkIssue')}</p>
              <Button
                variant="primary"
                onClick={() => {
                  setRetryCount(0);
                  setRefreshKey(prev => prev + 1);
                }}
              >
                {t('tradingview.manualRetry')}
              </Button>
            </div>
          )}

          <TradingViewErrorBoundary>
            <div className="tradingview-widget-container" ref={container} key={renderKey} style={{ height: "100%", width: "100%" }}>
              <div className="tradingview-widget-container__widget" ref={widgetRef} style={{ height: "100%", width: "100%" }}></div>
              <div className="tradingview-widget-copyright" style={{ display: 'none' }}>
                <a href="https://cn.tradingview.com/" rel="noopener noreferrer nofollow" target="_blank">
                  <span className="blue-text">TradingView</span>
                </a>
              </div>
            </div>
          </TradingViewErrorBoundary>
        </div>
      </div>

    </div>
  );
}

export default memo(TradingViewWidget);

import React, { useEffect, useRef, memo } from 'react';

function TradingViewWidget() {
  const container = useRef();

  useEffect(
    () => {
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      script.type = "text/javascript";
      script.async = true;
      script.innerHTML = `
        {
          "allow_symbol_change": true,
          "calendar": false,
          "details": true,
          "hide_side_toolbar": true,
          "hide_top_toolbar": false,
          "hide_legend": false,
          "hide_volume": true,
          "hotlist": false,
          "interval": "1",
          "locale": "zh_CN",
          "save_image": true,
          "style": "1",
          "symbol": "BINANCE:BTCUSDT.P",
          "theme": "dark",
          "timezone": "Etc/UTC",
          "backgroundColor": "#0F0F0F",
          "gridColor": "rgba(242, 242, 242, 0.06)",
          "watchlist": [
            "BINANCE:BTCUSDT.P",
            "BINANCE:ETHUSDT.P",
            "BINANCE:SOLUSDT.P",
            "BINANCE:XAUUSDT.P"
          ],
          "withdateranges": true,
          "compareSymbols": [],
          "show_popup_button": true,
          "popup_height": "650",
          "popup_width": "1000",
          "studies": [
            "Volume@tv-basicstudies"
          ],
          "autosize": true
        }`;
      container.current.appendChild(script);
    },
    []
  );

  return (
    <div className="tradingview-widget-container" ref={container} style={{ height: "100%", width: "100%" }}>
      <div className="tradingview-widget-container__widget" style={{ height: "calc(100% - 32px)", width: "100%" }}></div>
      <div className="tradingview-widget-copyright"><a href="https://cn.tradingview.com/symbols/BTCUSDT.P/?exchange=BINANCE" rel="noopener nofollow" target="_blank"><span className="blue-text">Track all markets on TradingView</span></a></div>
    </div>
  );
}

export default memo(TradingViewWidget);

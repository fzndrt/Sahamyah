import { useMemo, useState } from 'react';
import type { Candle, TradePlan } from '../../shared/idxTypes.ts';
import { formatRp, formatVolume } from '../lib/formatters.ts';

interface CandlestickChartProps {
  symbol: string;
  candles: Candle[];
  tradePlan: TradePlan;
  showLevels?: boolean;
}

export function CandlestickChart({
  symbol,
  candles,
  tradePlan,
  showLevels = true,
}: CandlestickChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visibleCandles = useMemo(() => candles.slice(-60), [candles]);

  const width = 760;
  const height = 340;
  const padLeft = 12;
  const padRight = 72;
  const padTop = 18;
  const priceHeight = 225;
  const volTop = padTop + priceHeight + 16;
  const volHeight = 56;

  const chartData = useMemo(() => {
    if (visibleCandles.length === 0) return null;

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 1;

    for (const c of visibleCandles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.ema20 !== null) {
        if (c.ema20 < minPrice) minPrice = c.ema20;
        if (c.ema20 > maxPrice) maxPrice = c.ema20;
      }
      if (c.ema50 !== null) {
        if (c.ema50 < minPrice) minPrice = c.ema50;
        if (c.ema50 > maxPrice) maxPrice = c.ema50;
      }
      if (c.volume > maxVol) maxVol = c.volume;
    }

    if (showLevels) {
      minPrice = Math.min(minPrice, tradePlan.cutLoss);
      maxPrice = Math.max(maxPrice, tradePlan.tp1);
    }

    const range = Math.max(1, maxPrice - minPrice);
    const paddedMin = minPrice - range * 0.06;
    const paddedMax = maxPrice + range * 0.06;
    const paddedRange = Math.max(1, paddedMax - paddedMin);

    const plotWidth = width - padLeft - padRight;
    const step = plotWidth / Math.max(1, visibleCandles.length);
    const bodyWidth = Math.max(3, Math.min(9, step * 0.64));

    const yPrice = (price: number) =>
      padTop + ((paddedMax - price) / paddedRange) * priceHeight;

    const yVol = (vol: number) => volTop + volHeight - (vol / maxVol) * volHeight;

    const xCenter = (idx: number) => padLeft + idx * step + step / 2;

    const buildLinePath = (getter: (c: Candle) => number | null) => {
      let d = '';
      visibleCandles.forEach((c, idx) => {
        const val = getter(c);
        if (val === null) return;
        const x = xCenter(idx);
        const y = yPrice(val);
        d += d === '' ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      });
      return d;
    };

    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const price = paddedMax - (paddedRange * i) / 4;
      return { price, y: yPrice(price) };
    });

    return {
      paddedMin,
      paddedMax,
      step,
      bodyWidth,
      yPrice,
      yVol,
      xCenter,
      ema20Path: buildLinePath((c) => c.ema20),
      ema50Path: buildLinePath((c) => c.ema50),
      yTicks,
    };
  }, [visibleCandles, tradePlan, showLevels]);

  if (!chartData || visibleCandles.length === 0) {
    return (
      <div className="flex h-[340px] items-center justify-center border border-slate-200 bg-slate-50 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        Data grafik tidak tersedia untuk {symbol}.
      </div>
    );
  }

  const activeIdx = hoverIdx !== null ? hoverIdx : visibleCandles.length - 1;
  const activeCandle = visibleCandles[activeIdx];
  const prevCandle = activeIdx > 0 ? visibleCandles[activeIdx - 1] : activeCandle;
  const activeChangePct =
    prevCandle.close > 0 ? ((activeCandle.close - prevCandle.close) / prevCandle.close) * 100 : 0;

  return (
    <div className="w-full">
      {/* Compact OHLCV inspection bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{activeCandle.date}</span>
          <span>O {activeCandle.open.toLocaleString('id-ID')}</span>
          <span>H {activeCandle.high.toLocaleString('id-ID')}</span>
          <span>L {activeCandle.low.toLocaleString('id-ID')}</span>
          <span
            className={
              activeChangePct >= 0
                ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                : 'font-semibold text-red-700 dark:text-red-400'
            }
          >
            C {activeCandle.close.toLocaleString('id-ID')} ({activeChangePct >= 0 ? '+' : ''}
            {activeChangePct.toFixed(2)}%)
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            Vol {formatVolume(activeCandle.volume)}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <span className="inline-block h-0.5 w-3 bg-amber-500" />
            EMA 20{' '}
            <span className="font-mono tabular-nums">
              {activeCandle.ema20 ? Math.round(activeCandle.ema20).toLocaleString('id-ID') : '—'}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-blue-700 dark:text-blue-400">
            <span className="inline-block h-0.5 w-3 bg-blue-500" />
            EMA 50{' '}
            <span className="font-mono tabular-nums">
              {activeCandle.ema50 ? Math.round(activeCandle.ema50).toLocaleString('id-ID') : '—'}
            </span>
          </span>
        </div>
      </div>

      <div className="relative overflow-x-auto border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-[540px] select-none"
          role="img"
          aria-label={`Grafik candlestick harian ${symbol} dengan EMA 20, EMA 50, dan level rencana trading`}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Horizontal grid & right price axis */}
          {chartData.yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padLeft}
                y1={tick.y}
                x2={width - padRight}
                y2={tick.y}
                className="stroke-slate-100 dark:stroke-slate-800/80"
                strokeWidth="1"
              />
              <text
                x={width - padRight + 8}
                y={tick.y + 4}
                className="fill-slate-500 font-mono text-[10px] dark:fill-slate-400"
              >
                {Math.round(tick.price).toLocaleString('id-ID')}
              </text>
            </g>
          ))}

          {/* Volume separator hairline */}
          <line
            x1={padLeft}
            y1={volTop - 8}
            x2={width - padRight}
            y2={volTop - 8}
            className="stroke-slate-200 dark:stroke-slate-800"
            strokeWidth="1"
          />

          {/* Horizontal Trade Plan Levels */}
          {showLevels && (
            <g>
              {/* TP1 line */}
              {tradePlan.tp1 >= chartData.paddedMin && tradePlan.tp1 <= chartData.paddedMax && (
                <g>
                  <line
                    x1={padLeft}
                    y1={chartData.yPrice(tradePlan.tp1)}
                    x2={width - padRight}
                    y2={chartData.yPrice(tradePlan.tp1)}
                    stroke="#16A34A"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                  />
                  <text
                    x={padLeft + 4}
                    y={chartData.yPrice(tradePlan.tp1) - 4}
                    className="fill-emerald-700 font-mono text-[10px] font-medium dark:fill-emerald-400"
                  >
                    TP1 {formatRp(tradePlan.tp1)}
                  </text>
                </g>
              )}

              {/* Cut Loss line */}
              {tradePlan.cutLoss >= chartData.paddedMin &&
                tradePlan.cutLoss <= chartData.paddedMax && (
                  <g>
                    <line
                      x1={padLeft}
                      y1={chartData.yPrice(tradePlan.cutLoss)}
                      x2={width - padRight}
                      y2={chartData.yPrice(tradePlan.cutLoss)}
                      stroke="#DC2626"
                      strokeWidth="1.2"
                      strokeDasharray="4 3"
                    />
                    <text
                      x={padLeft + 4}
                      y={chartData.yPrice(tradePlan.cutLoss) - 4}
                      className="fill-red-700 font-mono text-[10px] font-medium dark:fill-red-400"
                    >
                      Cut Loss {formatRp(tradePlan.cutLoss)}
                    </text>
                  </g>
                )}
            </g>
          )}

          {/* Volume bars */}
          {visibleCandles.map((c, idx) => {
            const x = chartData.xCenter(idx) - chartData.bodyWidth / 2;
            const y = chartData.yVol(c.volume);
            const barH = Math.max(1, volTop + volHeight - y);
            const isUp = c.close >= c.open;
            return (
              <rect
                key={`v-${c.date}`}
                x={x}
                y={y}
                width={chartData.bodyWidth}
                height={barH}
                className={
                  isUp
                    ? 'fill-emerald-500/35 dark:fill-emerald-400/30'
                    : 'fill-red-500/35 dark:fill-red-400/30'
                }
              />
            );
          })}

          {/* Candlesticks */}
          {visibleCandles.map((c, idx) => {
            const cx = chartData.xCenter(idx);
            const yHigh = chartData.yPrice(c.high);
            const yLow = chartData.yPrice(c.low);
            const yOpen = chartData.yPrice(c.open);
            const yClose = chartData.yPrice(c.close);
            const isUp = c.close >= c.open;
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
            const color = isUp ? '#16A34A' : '#DC2626';

            return (
              <g key={c.date}>
                <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth="1.2" />
                <rect
                  x={cx - chartData.bodyWidth / 2}
                  y={bodyTop}
                  width={chartData.bodyWidth}
                  height={bodyH}
                  fill={color}
                />
              </g>
            );
          })}

          {/* EMA 50 */}
          {chartData.ema50Path && (
            <path d={chartData.ema50Path} fill="none" stroke="#3B82F6" strokeWidth="1.5" />
          )}

          {/* EMA 20 */}
          {chartData.ema20Path && (
            <path d={chartData.ema20Path} fill="none" stroke="#D97706" strokeWidth="1.5" />
          )}

          {/* Active crosshair */}
          {hoverIdx !== null && (
            <line
              x1={chartData.xCenter(hoverIdx)}
              y1={padTop}
              x2={chartData.xCenter(hoverIdx)}
              y2={volTop + volHeight}
              className="stroke-slate-400 dark:stroke-slate-500"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          )}

          {/* Date axis labels (first, middle, last) */}
          {[0, Math.floor(visibleCandles.length / 2), visibleCandles.length - 1].map((idx) => {
            const item = visibleCandles[idx];
            if (!item) return null;
            return (
              <text
                key={`d-${idx}`}
                x={chartData.xCenter(idx)}
                y={height - 6}
                textAnchor={idx === 0 ? 'start' : idx === visibleCandles.length - 1 ? 'end' : 'middle'}
                className="fill-slate-400 font-mono text-[10px] dark:fill-slate-500"
              >
                {item.date.slice(5)}
              </text>
            );
          })}

          {/* Invisible hover capture strips */}
          {visibleCandles.map((c, idx) => (
            <rect
              key={`hit-${c.date}`}
              x={padLeft + idx * chartData.step}
              y={padTop}
              width={chartData.step}
              height={volTop + volHeight - padTop}
              fill="transparent"
              className="cursor-crosshair"
              onMouseEnter={() => setHoverIdx(idx)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

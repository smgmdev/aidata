"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

// ================================
//  ALADDIN-STYLE AI CRYPTO TERMINAL
//  - Top 10 Binance USDT pairs
//  - Cross-exchange arbitrage (Binance, Bybit, OKX) — HYBRID REST + WS
//  - Spot + leverage (momentum/mean-rev) ideas
//  - Lightweight AI prediction model (5–10m horizon)
//  NOTE: Estimates are naive, before fees/slippage/funding/latency.
// ================================

const REST_BASE = "https://api.binance.com";
const WS_BASE = "wss://data-stream.binance.vision/ws"; // Binance public market data only

const BYBIT_REST = "https://api.bybit.com";
const BYBIT_WS = "wss://stream.bybit.com/v5/public/spot";

const OKX_REST = "https://www.okx.com";
const OKX_WS = "wss://ws.okx.com:8443/ws/v5/public";

const TOP_N = 10;
const MINI_HISTORY = 60; // for microtrend & vol proxy
const TRI_MAX = 10; // show top N arb opportunities
const IDEAS_MAX = 8;
const PRED_MAX = 6;

const TF_OPTIONS = [
  { k: "1m", label: "1m" },
  { k: "5m", label: "5m" },
  { k: "15m", label: "15m" },
  { k: "1h", label: "1h" },
];

function fmtNum(n: any, digits = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e9) return (x / 1e9).toFixed(digits) + "B";
  if (abs >= 1e6) return (x / 1e6).toFixed(digits) + "M";
  if (abs >= 1e3) return (x / 1e3).toFixed(digits) + "K";
  return x.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPx(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (x >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (x >= 1) return x.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return x.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function pct(a: any, b: any) {
  const A = Number(a);
  const B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B) || B === 0) return 0;
  return ((A - B) / B) * 100;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function stddev(arr: number[]) {
  if (!arr || arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const v = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function ema(values: number[], period: number) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(values: number[], period = 14) {
  if (values.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

// OKX uses instId like BTC-USDT; convert to BTCUSDT for matching
function okxToBinanceSymbol(instId: string) {
  if (!instId) return null;
  return instId.replace(/-/g, "");
}
function binanceToOkxSymbol(sym: string) {
  if (!sym?.endsWith("USDT")) return null;
  const base = sym.replace("USDT", "");
  return `${base}-USDT`;
}

function Sparkline({ points = [], up }: { points?: number[]; up: boolean }) {
  const w = 64;
  const h = 18;
  if (!points.length) return <div className="h-[18px] w-[64px]" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1 || 1)) * w;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} className="block">
      <path d={d} fill="none" strokeWidth="1.5" className={up ? "stroke-emerald-300" : "stroke-rose-300"} />
    </svg>
  );
}

function Candles({ candles }: { candles: any[] }) {
  const W = 740;
  const H = 260;
  const P = 14;
  if (!candles?.length) {
    return <div className="h-[260px] w-full flex items-center justify-center text-slate-500 text-sm">No chart data</div>;
  }

  const lows = candles.map((c) => c.l);
  const highs = candles.map((c) => c.h);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;

  const toY = (v: number) => P + (H - P * 2) * (1 - (v - min) / range);
  const bw = (W - P * 2) / candles.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[260px]">
      {Array.from({ length: 5 }).map((_, i) => {
        const y = P + ((H - P * 2) * i) / 4;
        return <line key={i} x1={P} x2={W - P} y1={y} y2={y} className="stroke-slate-800" strokeWidth="1" />;
      })}

      {candles.map((c, i) => {
        const x = P + i * bw + bw / 2;
        const yH = toY(c.h);
        const yL = toY(c.l);
        const yO = toY(c.o);
        const yC = toY(c.c);
        const up = c.c >= c.o;
        const bodyTop = Math.min(yO, yC);
        const bodyBot = Math.max(yO, yC);
        const bodyH = Math.max(1.2, bodyBot - bodyTop);
        return (
          <g key={c.t}>
            <line x1={x} x2={x} y1={yH} y2={yL} className={up ? "stroke-emerald-300" : "stroke-rose-300"} strokeWidth="1.1" />
            <rect x={x - bw * 0.28} y={bodyTop} width={bw * 0.56} height={bodyH} rx="0.8" className={up ? "fill-emerald-300/70" : "fill-rose-300/70"} />
          </g>
        );
      })}
    </svg>
  );
}

function Pill({ children, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-[11px] border ${active ? "border-sky-300 text-sky-200 bg-sky-500/10" : "border-slate-700 text-slate-300 hover:bg-slate-900"}`}
    >
      {children}
    </button>
  );
}

function StatCard({ title, value, sub, tone = "neutral" }: any) {
  const toneCls = tone === "up" ? "text-emerald-300" : tone === "down" ? "text-rose-300" : "text-slate-100";
  return (
    <div className="rounded-xl bg-[#0a0c0f] border border-slate-800/80 p-3">
      <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">{title}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function IdeaRow({ badge, title, meta, edgePct, direction = "LONG", confidence = 0.5, note }: any) {
  const up = direction === "LONG";
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2 hover:bg-slate-900/40 rounded-lg">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 text-[10px] px-2 py-0.5 rounded border ${up ? "border-emerald-400/30 text-emerald-200 bg-emerald-500/10" : "border-rose-400/30 text-rose-200 bg-rose-500/10"}`}>{badge}</div>
        <div>
          <div className="text-sm text-slate-100 font-medium">{title}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{meta}</div>
          {note && <div className="text-[11px] text-slate-500 mt-1">{note}</div>}
        </div>
      </div>
      <div className="text-right min-w-[120px]">
        <div className={`text-sm font-semibold ${up ? "text-emerald-300" : "text-rose-300"}`}>{up ? "+" : ""}{edgePct.toFixed(2)}%</div>
        <div className="text-[10px] text-slate-500">conf {Math.round(confidence * 100)}%</div>
      </div>
    </div>
  );
}

export default function App() {
  // client-only clock (avoid hydration mismatch)
  const [localTime, setLocalTime] = useState("");
  useEffect(() => {
    setLocalTime(new Date().toLocaleString());
    const timer = setInterval(() => setLocalTime(new Date().toLocaleString()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [symbols, setSymbols] = useState<string[]>([]); // top N Binance symbols (USDT pairs)
  const [tickers, setTickers] = useState<Record<string, any>>({}); // Binance miniTicker
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [selected, setSelected] = useState("BTCUSDT");
  const [status, setStatus] = useState("connecting");
  const [lastEvent, setLastEvent] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"AI" | "Market" | "Chart">("AI");

  // Cross-exchange price caches (mid = (bid+ask)/2 when possible)
  const [bybitBook, setBybitBook] = useState<Record<string, any>>({});
  const [okxBook, setOkxBook] = useState<Record<string, any>>({});

  const [tf, setTf] = useState("1m");
  const [candles, setCandles] = useState<any[]>([]);
  const [chartStatus, setChartStatus] = useState("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<any>({ tries: 0, timer: null });
  const chartWsRef = useRef<WebSocket | null>(null);
  const bybitWsRef = useRef<WebSocket | null>(null);
  const okxWsRef = useRef<WebSocket | null>(null);

  // ============ TOP N LOAD (BINANCE) ============
  useEffect(() => {
    let canceled = false;
    async function loadTopN() {
      try {
        const res = await fetch(`${REST_BASE}/api/v3/ticker/24hr`);
        const data = await res.json();
        if (canceled) return;
        const usdt = data
          .filter((t: any) => t.symbol.endsWith("USDT") && !t.symbol.includes("UPUSDT") && !t.symbol.includes("DOWNUSDT"))
          .sort((a: any, b: any) => Number(b.quoteVolume) - Number(a.quoteVolume))
          .slice(0, TOP_N);

        const topSyms = usdt.map((t: any) => t.symbol);
        setSymbols(topSyms);
        if (!topSyms.includes(selected)) setSelected(topSyms[0] || "BTCUSDT");

        const map: Record<string, any> = {};
        for (const t of usdt) {
          map[t.symbol] = {
            s: t.symbol,
            c: t.lastPrice,
            o: t.openPrice,
            h: t.highPrice,
            l: t.lowPrice,
            v: t.volume,
            q: t.quoteVolume,
            p: t.priceChangePercent,
            E: Date.now(),
          };
        }
        setTickers((prev) => ({ ...prev, ...map }));
      } catch (e) {
        console.error("topN error", e);
      }
    }
    loadTopN();
    const t = setInterval(loadTopN, 60_000);
    return () => {
      canceled = true;
      clearInterval(t);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const watchSet = useMemo(() => new Set(symbols), [symbols]);

  // ============ BINANCE REALTIME MINI TICKER ============
  useEffect(() => {
    if (!symbols.length) return;
    let alive = true;

    function connect() {
      if (!alive) return;
      setStatus("connecting");
      const ws = new WebSocket(`${WS_BASE}/!miniTicker@arr`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectRef.current.tries = 0;
        setStatus("live");
      };

      ws.onmessage = (ev) => {
        try {
          const arr = JSON.parse(ev.data);
          if (!Array.isArray(arr)) return;

          setTickers((prev) => {
            const next = { ...prev };
            for (const m of arr) {
              if (!watchSet.has(m.s)) continue;
              next[m.s] = { ...next[m.s], ...m, E: m.E || Date.now() };
            }
            return next;
          });

          setHistory((prev) => {
            const next = { ...prev };
            for (const m of arr) {
              if (!watchSet.has(m.s)) continue;
              const px = Number(m.c);
              if (!Number.isFinite(px)) continue;
              const hist = next[m.s] ? [...next[m.s]] : [];
              hist.push(px);
              if (hist.length > MINI_HISTORY) hist.shift();
              next[m.s] = hist;
            }
            return next;
          });

          setLastEvent(Date.now());
        } catch {}
      };

      ws.onerror = () => setStatus("error");
      ws.onclose = () => {
        if (!alive) return;
        setStatus("reconnecting");
        const tries = reconnectRef.current.tries++;
        const delay = Math.min(1000 * 2 ** tries, 15000);
        reconnectRef.current.timer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      alive = false;
      try { wsRef.current?.close(); } catch {}
      if (reconnectRef.current.timer) clearTimeout(reconnectRef.current.timer);
    };
  }, [watchSet, symbols.length]);

  // ============ BYBIT HYBRID FEED ============
  useEffect(() => {
    if (!symbols.length) return;
    let alive = true;

    async function preloadBybit() {
      try {
        const res = await fetch(`${BYBIT_REST}/v5/market/tickers?category=spot`);
        const json = await res.json();
        const list = json?.result?.list || [];
        const map: Record<string, any> = {};
        for (const t of list) {
          const s = t.symbol;
          if (!watchSet.has(s)) continue;
          const bid = Number(t.bid1Price);
          const ask = Number(t.ask1Price);
          const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number(t.lastPrice);
          map[s] = { bid, ask, mid };
        }
        if (alive) setBybitBook(map);
      } catch (e) {
        console.warn("bybit preload error", e);
      }
    }

    function connectBybitWs() {
      try { bybitWsRef.current?.close(); } catch {}
      const ws = new WebSocket(BYBIT_WS);
      bybitWsRef.current = ws;
      ws.onopen = () => {
        const chans = symbols.map((s) => `tickers.${s}`);
        const chunkSize = 20;
        for (let i = 0; i < chans.length; i += chunkSize) {
          ws.send(JSON.stringify({ op: "subscribe", args: chans.slice(i, i + chunkSize) }));
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const d = msg?.data;
          if (!d || !d.symbol) return;
          const s = d.symbol;
          if (!watchSet.has(s)) return;
          const bid = Number(d.bid1Price);
          const ask = Number(d.ask1Price);
          const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number(d.lastPrice);
          setBybitBook((prev) => ({ ...prev, [s]: { bid, ask, mid } }));
        } catch {}
      };
      ws.onclose = () => alive && setTimeout(connectBybitWs, 2000);
    }

    preloadBybit();
    connectBybitWs();
    const t = setInterval(preloadBybit, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
      try { bybitWsRef.current?.close(); } catch {}
    };
  }, [symbols.length]);

  // ============ OKX HYBRID FEED ============
  useEffect(() => {
    if (!symbols.length) return;
    let alive = true;

    async function preloadOkx() {
      try {
        const res = await fetch(`${OKX_REST}/api/v5/market/tickers?instType=SPOT`);
        const json = await res.json();
        const list = json?.data || [];
        const map: Record<string, any> = {};
        for (const t of list) {
          const s = okxToBinanceSymbol(t.instId);
          if (!s || !watchSet.has(s)) continue;
          const bid = Number(t.bidPx);
          const ask = Number(t.askPx);
          const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number(t.last);
          map[s] = { bid, ask, mid };
        }
        if (alive) setOkxBook(map);
      } catch (e) {
        console.warn("okx preload error", e);
      }
    }

    function connectOkxWs() {
      try { okxWsRef.current?.close(); } catch {}
      const ws = new WebSocket(OKX_WS);
      okxWsRef.current = ws;
      ws.onopen = () => {
        const instIds = symbols.map(binanceToOkxSymbol).filter(Boolean);
        const chunkSize = 20;
        for (let i = 0; i < instIds.length; i += chunkSize) {
          ws.send(JSON.stringify({ op: "subscribe", args: instIds.slice(i, i + chunkSize).map((id) => ({ channel: "tickers", instId: id })) }));
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event) return;
          const arr = msg?.data;
          if (!Array.isArray(arr)) return;
          for (const t of arr) {
            const s = okxToBinanceSymbol(t.instId);
            if (!s || !watchSet.has(s)) continue;
            const bid = Number(t.bidPx);
            const ask = Number(t.askPx);
            const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number(t.last);
            setOkxBook((prev) => ({ ...prev, [s]: { bid, ask, mid } }));
          }
        } catch {}
      };
      ws.onclose = () => alive && setTimeout(connectOkxWs, 2000);
    }

    preloadOkx();
    connectOkxWs();
    const t = setInterval(preloadOkx, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
      try { okxWsRef.current?.close(); } catch {}
    };
  }, [symbols.length]);

  // ============ CHART LOAD (BINANCE) ============
  useEffect(() => {
    let canceled = false;
    async function loadKlines() {
      if (!selected) return;
      setChartStatus("loading");
      try {
        const res = await fetch(`${REST_BASE}/api/v3/klines?symbol=${selected}&interval=${tf}&limit=120`);
        const data = await res.json();
        if (canceled) return;
        const parsed = data.map((k: any) => ({ t: k[0], o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]) }));
        setCandles(parsed);
        setChartStatus("live");
      } catch (e) {
        console.error("klines error", e);
        setChartStatus("error");
      }
    }
    loadKlines();
    return () => { canceled = true; };
  }, [selected, tf]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    const sym = selected.toLowerCase();
    const ws = new WebSocket(`${WS_BASE}/${sym}@kline_${tf}`);
    chartWsRef.current = ws;
    ws.onopen = () => alive && setChartStatus("live");
    ws.onerror = () => alive && setChartStatus("error");
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const k = msg.k;
        if (!k) return;
        const nextC = { t: k.t, o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c) };
        setCandles((prev) => {
          const arr = prev ? [...prev] : [];
          const last = arr[arr.length - 1];
          if (!last || last.t !== nextC.t) {
            arr.push(nextC);
            if (arr.length > 140) arr.shift();
            return arr;
          }
          arr[arr.length - 1] = nextC;
          return arr;
        });
      } catch {}
    };
    return () => {
      alive = false;
      try { ws.close(); } catch {}
    };
  }, [selected, tf]);

  // ============ DERIVED MARKET ROWS (BINANCE) ============
  const marketRows = useMemo(() => {
    return symbols
      .map((s) => {
        const t = tickers[s];
        const last = Number(t?.c);
        const open = Number(t?.o);
        const change = pct(last, open);
        const range24 = last ? ((Number(t?.h) - Number(t?.l)) / last) * 100 : 0;
        const hist = history[s] || [];
        const vol = hist.length ? (stddev(hist) / (hist[hist.length - 1] || 1)) * 100 : 0;
        const slope = hist.length > 3 ? ((hist[hist.length - 1] - hist[0]) / (hist[0] || 1)) * 100 : 0;
        return { s, last, open, change, high: Number(t?.h), low: Number(t?.l), qvol: Number(t?.q), vol, slope, range24, hist };
      })
      .filter((r) => Number.isFinite(r.last))
      .sort((a, b) => Number(b.qvol) - Number(a.qvol));
  }, [symbols, tickers, history]);

  // Helper: get mid price on each exchange
  function midBin(sym: string) {
    const r = tickers[sym];
    return Number(r?.c) || null;
  }
  function midBy(sym: string) {
    return bybitBook[sym]?.mid || null;
  }
  function midOk(sym: string) {
    return okxBook[sym]?.mid || null;
  }

  // ============ CROSS-EXCHANGE ARB (HYBRID) ============
  const arbIdeas = useMemo(() => {
    if (!marketRows.length) return [];
    const ideas: any[] = [];
    const exList = [
      { ex: "Binance", mid: midBin },
      { ex: "Bybit", mid: midBy },
      { ex: "OKX", mid: midOk },
    ];

    for (const r of marketRows) {
      const sym = r.s;
      for (let j = 0; j < exList.length; j++) {
        for (let k = 0; k < exList.length; k++) {
          if (j === k) continue;
          const buyEx = exList[j];
          const sellEx = exList[k];
          const pBuy = buyEx.mid(sym);
          const pSell = sellEx.mid(sym);
          if (!pBuy || !pSell) continue;
          const edge = ((pSell - pBuy) / pBuy) * 100;
          if (edge > 0.06) {
            ideas.push({
              path: `${buyEx.ex} → ${sym} → ${sellEx.ex}`,
              edge,
              detail: `${buyEx.ex} mid ${fmtPx(pBuy)} → ${sellEx.ex} mid ${fmtPx(pSell)}`,
            });
          }
        }
      }
    }

    return ideas.sort((a, b) => b.edge - a.edge).slice(0, TRI_MAX);
  }, [marketRows, bybitBook, okxBook, tickers]);

  // ============ AI SPOT IDEAS (BINANCE) ============
  const spotIdeas = useMemo(() => {
    const rows = marketRows;
    if (!rows.length) return [];

    const longs = rows
      .filter((r) => r.slope > 0.6 && r.change > 1.2)
      .sort((a, b) => b.slope + b.change - (a.slope + a.change))
      .slice(0, Math.ceil(IDEAS_MAX / 2))
      .map((r) => {
        const est = clamp(r.range24 * 0.35, 0.6, 8);
        const conf = clamp((r.slope + r.change) / 15, 0.35, 0.85);
        return {
          badge: "SPOT MOM",
          title: `${r.s} breakout continuation`,
          meta: `24h +${r.change.toFixed(2)}% · microtrend +${r.slope.toFixed(2)}% · range ${r.range24.toFixed(2)}%`,
          edgePct: est,
          direction: "LONG",
          confidence: conf,
          note: "Estimate uses 24h range proxy; not fee/slippage adjusted.",
        };
      });

    const dips = rows
      .filter((r) => r.change < -2.0 && r.slope > 0.1)
      .sort((a, b) => b.slope - b.change - (a.slope - a.change))
      .slice(0, Math.floor(IDEAS_MAX / 2))
      .map((r) => {
        const est = clamp(r.range24 * 0.3, 0.5, 6);
        const conf = clamp((r.slope - r.change) / 18, 0.3, 0.8);
        return {
          badge: "SPOT MRV",
          title: `${r.s} dip-buy mean reversion`,
          meta: `24h ${r.change.toFixed(2)}% · microtrend +${r.slope.toFixed(2)}% · range ${r.range24.toFixed(2)}%`,
          edgePct: est,
          direction: "LONG",
          confidence: conf,
          note: "Watch liquidity + spread during rebounds.",
        };
      });

    return [...longs, ...dips].sort((a, b) => b.edgePct - a.edgePct).slice(0, IDEAS_MAX);
  }, [marketRows]);

  // ============ AI LEVERAGE IDEAS (BINANCE) ============
  const leverageIdeas = useMemo(() => {
    const rows = marketRows;
    if (!rows.length) return [];

    const levLong = rows
      .filter((r) => r.vol > 0.18 && r.slope > 0.7 && r.change > 0.8)
      .sort((a, b) => b.vol + b.slope - (a.vol + a.slope))
      .slice(0, 4)
      .map((r) => {
        const est = clamp(r.vol * 2.4, 0.8, 10);
        const conf = clamp((r.vol + r.slope) / 3.5, 0.35, 0.8);
        const lev = r.vol > 0.6 ? "2–3x" : r.vol > 0.35 ? "3–5x" : "5–8x";
        return {
          badge: "LEV LONG",
          title: `${r.s} momentum leverage long`,
          meta: `micro vol ${r.vol.toFixed(2)}% · slope +${r.slope.toFixed(2)}% · 24h ${r.change.toFixed(2)}% · suggested ${lev}`,
          edgePct: est,
          direction: "LONG",
          confidence: conf,
          note: "Gross edge estimate from recent micro-vol. Use tight stops.",
        };
      });

    const levShort = rows
      .filter((r) => r.vol > 0.18 && r.slope < -0.6 && r.change < -0.8)
      .sort((a, b) => b.vol + Math.abs(b.slope) - (a.vol + Math.abs(a.slope)))
      .slice(0, 4)
      .map((r) => {
        const est = clamp(r.vol * 2.1, 0.8, 9);
        const conf = clamp((r.vol + Math.abs(r.slope)) / 3.6, 0.35, 0.78);
        const lev = r.vol > 0.6 ? "2–3x" : r.vol > 0.35 ? "3–5x" : "5–7x";
        return {
          badge: "LEV SHORT",
          title: `${r.s} trend leverage short`,
          meta: `micro vol ${r.vol.toFixed(2)}% · slope ${r.slope.toFixed(2)}% · 24h ${r.change.toFixed(2)}% · suggested ${lev}`,
          edgePct: est,
          direction: "SHORT",
          confidence: conf,
          note: "Estimate ignores funding/spread. Confirm basis before sizing.",
        };
      });

    return [...levLong, ...levShort].sort((a, b) => b.edgePct - a.edgePct).slice(0, IDEAS_MAX);
  }, [marketRows]);

  // ============ AI PREDICTION MODEL (5–10m) ============
  const predictionIdeas = useMemo(() => {
    const rows = marketRows;
    if (!rows.length) return { longs: [], shorts: [] };

    const scored = rows
      .filter((r) => r.hist && r.hist.length > 20)
      .map((r) => {
        const hist = r.hist as number[];
        const last = hist[hist.length - 1];
        const fast = ema(hist.slice(-30), 9);
        const slow = ema(hist.slice(-30), 21);
        const cross = (fast - slow) / (last || 1);
        const rsiVal = rsi(hist, 14);
        const rsiSig = (rsiVal - 50) / 50;

        const nslope = clamp(r.slope / 2.5, -2, 2);
        const nvol = clamp(r.vol / 1.2, 0, 2);

        const score = 0.8 * nslope + 0.6 * cross + 0.35 * rsiSig - 0.25 * nvol;
        const probUp = sigmoid(score);
        const expMove = clamp(r.vol * 1.8 + Math.abs(r.slope) * 0.6, 0.4, 6);
        return { ...r, probUp, expMove, rsiVal, fast, slow };
      });

    const longs = scored
      .filter((r) => r.probUp > 0.6)
      .sort((a, b) => b.expMove * b.probUp - a.expMove * a.probUp)
      .slice(0, PRED_MAX)
      .map((r) => ({
        badge: "PRED LONG",
        title: `${r.s} · next 5–10m up-bias`,
        meta: `P(up) ${(r.probUp * 100).toFixed(0)}% · EMA9>EMA21 ${r.fast > r.slow ? "yes" : "no"} · RSI ${r.rsiVal.toFixed(0)} · micro vol ${r.vol.toFixed(2)}%`,
        edgePct: r.expMove,
        direction: "LONG",
        confidence: clamp(r.probUp, 0.55, 0.9),
        note: `Entry near ${fmtPx(r.last)} · horizon ~5–10m.`,
      }));

    const shorts = scored
      .filter((r) => r.probUp < 0.4)
      .sort((a, b) => b.expMove * (1 - b.probUp) - a.expMove * (1 - a.probUp))
      .slice(0, PRED_MAX)
      .map((r) => ({
        badge: "PRED SHORT",
        title: `${r.s} · next 5–10m down-bias`,
        meta: `P(down) ${((1 - r.probUp) * 100).toFixed(0)}% · EMA9<EMA21 ${r.fast < r.slow ? "yes" : "no"} · RSI ${r.rsiVal.toFixed(0)} · micro vol ${r.vol.toFixed(2)}%`,
        edgePct: r.expMove,
        direction: "SHORT",
        confidence: clamp(1 - r.probUp, 0.55, 0.9),
        note: `Entry near ${fmtPx(r.last)} · horizon ~5–10m.`,
      }));

    return { longs, shorts };
  }, [marketRows]);

  // ============ SEARCH FILTER ============
  const filteredSymbols = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return symbols;
    return symbols.filter((s) => s.includes(q));
  }, [symbols, search]);

  const selectedT = tickers[selected];
  const selectedHist = history[selected] || [];

  const theme = {
    bg: "bg-[#050607]",
    panel: "bg-[#0a0c0f] border border-slate-800/80",
    panelSoft: "bg-[#0c0f13] border border-slate-800/80",
    textDim: "text-slate-400",
  };

  return (
    <div className={`min-h-screen ${theme.bg} text-slate-100 font-[ui-monospace,system-ui] tracking-[0.01em]`}>
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#06080b]">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="text-slate-100 font-semibold tracking-[0.2em] text-sm">
            <img src="https://corporate.stankeviciusgroup.com/assets/rf/logo.png" width={50} alt="logo" />
          </div>
          <div className={`text-[11px] uppercase ${theme.textDim} tracking-[0.25em]`}>AI Insights</div>
          <div className="ml-auto flex items-center gap-4 text-[11px]">
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${status === "live" ? "bg-emerald-400" : status === "reconnecting" ? "bg-amber-400" : status === "error" ? "bg-rose-400" : "bg-slate-500"}`} />
              <span className="uppercase tracking-wider text-slate-300">{status}</span>
            </div>
            <div className={theme.textDim}>Last tick: {lastEvent ? new Date(lastEvent).toLocaleTimeString() : "—"}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-3 py-2 border-b border-slate-800/70 bg-[#07090c] flex items-center gap-2 text-xs">
        {[
          { k: "AI", label: "AI Board" },
          { k: "Market", label: "Top 10 Market" },
          { k: "Chart", label: "Chart" },
        ].map((t) => (
          <Pill key={t.k} active={tab === t.k} onClick={() => setTab(t.k)}>
            {t.label}
          </Pill>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter symbols…"
            className="w-[220px] bg-black/40 border border-slate-700 rounded-md px-2 py-1 text-xs outline-none focus:border-sky-400/70"
          />
          <div className="text-[11px] text-slate-500">Pairs: {symbols.length}</div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-0">
        {/* Left list */}
        <aside className="col-span-3 xl:col-span-2 border-r border-slate-800/80 bg-[#06070a] min-h-[calc(100vh-92px)] overflow-y-auto">
          <div className="p-3 border-b border-slate-800/80">
            <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em] mb-1`}>Top 10 (USDT)</div>
            <div className="text-[11px] text-slate-500">Sorted by quote volume</div>
          </div>

          <div className="divide-y divide-slate-800/70">
            {filteredSymbols.map((s, idx) => {
              const t = tickers[s];
              const last = t?.c;
              const open = t?.o;
              const ch = pct(last, open);
              const up = ch >= 0;
              const bgTone = selected === s ? "bg-slate-900/80" : up ? "bg-emerald-500/12" : "bg-rose-500/12";
              const borderTone = up ? "border-emerald-500/30" : "border-rose-500/30";

              return (
                <button
                  key={s}
                  onClick={() => setSelected(s)}
                  className={`w-full text-left px-3 py-2 hover:bg-slate-900/60 transition border-l-2 ${bgTone} ${borderTone}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm tracking-wide">{idx + 1}. {s}</div>
                    <div className={`text-xs ${up ? "text-emerald-300" : "text-rose-300"}`}>{up ? "+" : ""}{ch.toFixed(2)}%</div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="text-[12px] text-slate-200">{fmtPx(last)}</div>
                    <div className="text-[10px] text-slate-500">QVol {fmtNum(t?.q)}</div>
                  </div>
                  <div className="mt-1"><Sparkline points={history[s] || []} up={up} /></div>
                </button>
              );
            })}
            {!filteredSymbols.length && <div className="p-4 text-slate-500 text-sm">No matches.</div>}
          </div>
        </aside>

        {/* Main */}
        <main className="col-span-9 xl:col-span-10">
          {/* Selected header */}
          <div className="p-3 border-b border-slate-800/80 bg-[#07090c] grid grid-cols-12 gap-3">
            <div className="col-span-12 md:col-span-4">
              <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>Instrument</div>
              <div className="mt-1 flex items-end gap-3">
                <div className="text-3xl font-semibold tracking-widest text-slate-100">{selected}</div>
                <div className={`text-xs ${theme.textDim}`}>Binance Spot</div>
              </div>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>Last</div>
              <div className="text-xl mt-1 text-slate-100">{fmtPx(selectedT?.c)}</div>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>24h Chg</div>
              {(() => {
                const ch = pct(selectedT?.c, selectedT?.o);
                const up = ch >= 0;
                return (
                  <div className={`text-xl mt-1 ${up ? "text-emerald-300" : "text-rose-300"}`}>
                    {up ? "+" : ""}{ch.toFixed(2)}%
                  </div>
                );
              })()}
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>24h High</div>
              <div className="text-xl mt-1">{fmtPx(selectedT?.h)}</div>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>24h Low</div>
              <div className="text-xl mt-1">{fmtPx(selectedT?.l)}</div>
            </div>
            <div className="col-span-12">
              <div className="mt-2 flex items-center gap-2">
                <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>Microtrend</div>
                <Sparkline points={selectedHist} up={pct(selectedT?.c, selectedT?.o) >= 0} />
              </div>
            </div>
          </div>

          {tab === "AI" && (
            <div className="p-3 grid grid-cols-12 gap-3">
              <div className="col-span-12 grid grid-cols-12 gap-3">
                <div className="col-span-6 md:col-span-3"><StatCard title="Universe" value={`${symbols.length} pairs`} sub="Top USDT pairs by volume" /></div>
                <div className="col-span-6 md:col-span-3"><StatCard title="Arb Paths" value={`${arbIdeas.length}`} sub="Cross-exchange spreads" /></div>
                <div className="col-span-6 md:col-span-3"><StatCard title="Spot Ideas" value={`${spotIdeas.length}`} sub="Momentum / mean-rev" /></div>
                <div className="col-span-6 md:col-span-3"><StatCard title="Leverage Ideas" value={`${leverageIdeas.length}`} sub="Micro-vol + trend" /></div>
              </div>

              <section className={`col-span-12 xl:col-span-6 rounded-xl ${theme.panel} overflow-hidden`}>
                <div className="px-3 py-2 border-b border-slate-800/80 flex items-center">
                  <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>AI Arbitrage Board (Hybrid: Binance • Bybit • OKX)</div>
                  <div className="ml-auto text-[10px] text-slate-500">mid-price edge · before fees</div>
                </div>
                <div className="p-2 space-y-1">
                  {arbIdeas.map((a, i) => (
                    <IdeaRow
                      key={a.path + i}
                      badge="ARB"
                      title={a.path}
                      meta={a.detail}
                      edgePct={a.edge}
                      direction="LONG"
                      confidence={clamp(a.edge / 1.2, 0.35, 0.9)}
                      note="Realizable edge may drop after taker fees & transfer latency. Prefer pre-funded balances."
                    />
                  ))}
                  {!arbIdeas.length && <div className="p-6 text-slate-500 text-sm">No clear edges above threshold right now.</div>}
                </div>
              </section>

              {/* RIGHT COLUMN: Spot + Leverage + Prediction in SAME panel */}
              <section className={`col-span-12 xl:col-span-6 rounded-xl ${theme.panelSoft} overflow-hidden`}>
                <div className="px-3 py-2 border-b border-slate-800/80 flex items-center">
                  <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>AI Spot Opportunities</div>
                  <div className="ml-auto text-[10px] text-slate-500">est. swing potential</div>
                </div>
                <div className="p-2 space-y-1">
                  {spotIdeas.map((it, i) => (
                    <IdeaRow key={it.title + i} {...it} />
                  ))}
                  {!spotIdeas.length && <div className="p-6 text-slate-500 text-sm">No spot setups met filters.</div>}
                </div>

                <div className="mt-4 border-t border-slate-800/80">
                  <div className="px-3 py-2 flex items-center">
                    <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>AI Leverage Opportunities</div>
                    <div className="ml-auto text-[10px] text-slate-500">micro-vol model · not funding-adjusted</div>
                  </div>
                  <div className="p-2 space-y-1">
                    {leverageIdeas.map((it, i) => (
                      <IdeaRow key={it.title + i} {...it} />
                    ))}
                    {!leverageIdeas.length && <div className="p-6 text-slate-500 text-sm">No leverage setups met filters.</div>}
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-800/80">
                  <div className="px-3 py-2 flex items-center">
                    <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>AI Prediction (5–10m Horizon)</div>
                    <div className="ml-auto text-[10px] text-slate-500">EMA/RSI/vol logistic</div>
                  </div>
                  <div className="p-2 space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/90 px-2">Predicted Longs</div>
                    {predictionIdeas.longs.map((it, i) => (
                      <IdeaRow key={it.title + i} {...it} />
                    ))}
                    {!predictionIdeas.longs.length && <div className="p-3 text-slate-500 text-xs">No long signals above 60%.</div>}

                    <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-rose-300/90 px-2">Predicted Shorts</div>
                    {predictionIdeas.shorts.map((it, i) => (
                      <IdeaRow key={it.title + i} {...it} />
                    ))}
                    {!predictionIdeas.shorts.length && <div className="p-3 text-slate-500 text-xs">No short signals below 40%.</div>}
                  </div>
                </div>
              </section>

              <div className="col-span-12 text-[11px] text-slate-500 px-1">
                AI board uses public spot prices from Binance, Bybit, and OKX. Edges and probabilities are gross estimates before fees, spreads, funding, and execution risk.
                Treat as a scanning assistant, not financial advice.
              </div>
            </div>
          )}

          {tab === "Market" && (
            <div className="p-3">
              <div className={`rounded-xl ${theme.panel} overflow-hidden`}>
                <div className="px-3 py-2 border-b border-slate-800/80 flex items-center">
                  <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>Top 10 Market Table</div>
                </div>
                <div className="px-3 py-2 grid grid-cols-12 text-[10px] uppercase tracking-[0.24em] text-slate-400 border-b border-slate-800/80">
                  <div className="col-span-3">Symbol</div>
                  <div className="col-span-2">Last</div>
                  <div className="col-span-2">24h Chg</div>
                  <div className="col-span-2">Micro Vol</div>
                  <div className="col-span-1">Slope</div>
                  <div className="col-span-2 text-right">QVol</div>
                </div>
                <div className="divide-y divide-slate-800/60 max-h-[70vh] overflow-y-auto">
                  {marketRows.map((r) => {
                    const up = r.change >= 0;
                    return (
                      <div
                        key={r.s}
                        onClick={() => setSelected(r.s)}
                        className={`grid grid-cols-12 py-2 px-3 text-sm cursor-pointer hover:bg-slate-900/40 ${selected === r.s ? "bg-slate-900/60" : ""}`}
                      >
                        <div className="col-span-3 tracking-wide text-slate-100">{r.s}</div>
                        <div className="col-span-2 text-slate-200 tabular-nums">{fmtPx(r.last)}</div>
                        <div className={`col-span-2 tabular-nums ${up ? "text-emerald-300" : "text-rose-300"}`}>{up ? "+" : ""}{r.change.toFixed(2)}%</div>
                        <div className="col-span-2 text-slate-300 tabular-nums">{r.vol.toFixed(2)}%</div>
                        <div className={`col-span-1 tabular-nums ${r.slope >= 0 ? "text-emerald-200" : "text-rose-200"}`}>{r.slope.toFixed(1)}%</div>
                        <div className="col-span-2 text-right text-slate-400 tabular-nums">{fmtNum(r.qvol)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === "Chart" && (
            <div className="p-3 grid grid-cols-12 gap-3">
              <section className={`col-span-12 rounded-xl ${theme.panel} overflow-hidden`}>
                <div className="px-3 py-2 border-b border-slate-800/80 flex items-center gap-3">
                  <div className={`text-[10px] ${theme.textDim} uppercase tracking-[0.24em]`}>Price Chart</div>
                  <div className="ml-auto flex items-center gap-1">
                    {TF_OPTIONS.map((o) => (
                      <Pill key={o.k} active={tf === o.k} onClick={() => setTf(o.k)}>
                        {o.label}
                      </Pill>
                    ))}
                  </div>
                </div>
                <div className="p-2">
                  {chartStatus === "loading" && <div className="text-slate-500 text-sm p-6">Loading chart…</div>}
                  {chartStatus !== "loading" && <Candles candles={candles} />}
                </div>
              </section>
            </div>
          )}

          <div className="border-t border-slate-800/80 bg-[#06080b] px-3 py-2 text-[11px] text-slate-500 flex items-center gap-3">
            <div>Data: Binance, Bybit, OKX public spot feeds</div>
            <div>Universe refresh: 60s</div>
            <div className="ml-auto">Local time: {localTime || "—"}</div>
          </div>
        </main>
      </div>

      {/*
        NOTES:
        - Cross-exchange arb uses mid prices and ignores transfer latency.
        - Prediction model is a lightweight logistic blend of EMA cross + RSI + slope + vol.
        - If symbols missing on Bybit/OKX, they will be skipped.
      */}
    </div>
  );
}

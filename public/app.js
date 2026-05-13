const POLL_MS = 45000;
const NOTIFY_COOLDOWN_MS = 90000;
const UI_MAX_PER_TAB = 80;

const lastUpdated = document.getElementById("lastUpdated");
const fetchStatus = document.getElementById("fetchStatus");
const scanDurationMs = document.getElementById("scanDurationMs");
const panelReal = document.getElementById("panelReal");
const panelModel = document.getElementById("panelModel");
const panelHistory = document.getElementById("panelHistory");
const metaSummary = document.getElementById("metaSummary");
const globalError = document.getElementById("globalError");
const btnNotify = document.getElementById("btnNotify");
const notifyStatus = document.getElementById("notifyStatus");
const tabs = document.querySelectorAll(".tab");
const btnExportCsv = document.getElementById("btnExportCsv");
const btnExportJson = document.getElementById("btnExportJson");
const historyMarketSelect = document.getElementById("historyMarketSelect");
const btnHistoryRefresh = document.getElementById("btnHistoryRefresh");

let lastNotifyAt = 0;
let lastHadOpportunity = false;
let lastMarketList = [];

function formatQuoteAge(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return `${s} s`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPublicConfig(cfg) {
  const el = document.getElementById("configPanel");
  if (!el || !cfg) return;
  const rpc = cfg.rpcConfigured || {};
  const rpcBits = Object.entries(rpc)
    .map(([ch, ok]) => `${ch}: ${ok ? "sim" : "não"}`)
    .join(" · ");
  el.innerHTML = `
    <dl>
      <dt>USE_REAL_CHAIN_DATA (env)</dt><dd>${escapeHtml(String(cfg.flags?.USE_REAL_CHAIN_DATA ?? ""))}</dd>
      <dt>Efetivo (ligado)</dt><dd>${cfg.useRealChainData ? "sim" : "não"}</dd>
      <dt>DISABLE_CURATED_ONCHAIN_QUOTES</dt><dd>${cfg.disableCuratedOnchainQuotes ? "1" : "0"}</dd>
      <dt>DISABLE_DYNAMIC</dt><dd>${cfg.disableDynamic ? "1" : "0"}</dd>
      <dt>ENABLE_AGGREGATORS / Jupiter / histórico</dt><dd>${escapeHtml(String(cfg.flags?.ENABLE_AGGREGATORS ?? ""))} · ${escapeHtml(String(cfg.flags?.ENABLE_JUPITER_SOL ?? ""))} · ${escapeHtml(String(cfg.flags?.ENABLE_SCAN_HISTORY ?? ""))}</dd>
      <dt>NOTIONAL / SLIPPAGE_BPS</dt><dd>${cfg.notionalUsd} USD · ${cfg.slippageBps} bps</dd>
      <dt>Mín. lucro líquido (worthwhile)</dt><dd>${escapeHtml(String(cfg.minNetProfitUsd ?? ""))} USD · env MIN_NET_PROFIT_USD</dd>
      <dt>Mín. spread % (worthwhile)</dt><dd>${escapeHtml(String(cfg.minSpreadPercent ?? "0"))} % · env MIN_SPREAD_PERCENT</dd>
      <dt>QUOTE_MAX_AGE_SEC (stale)</dt><dd>${cfg.quoteMaxAgeSec != null ? escapeHtml(String(cfg.quoteMaxAgeSec)) + " s" : "desligado"}</dd>
      <dt>Liquidez mín. dinâmica (USD)</dt><dd>${escapeHtml(String(cfg.dynamicMinLiquidityUsd ?? "—"))}</dd>
      <dt>Webhook (POST oportunidades)</dt><dd>${cfg.webhookEnabled ? "ativo" : "inativo"} · env WEBHOOK_URL / ENABLE_WEBHOOK</dd>
      <dt>Intents: só on-chain</dt><dd>${cfg.intentsOnchainOnly ? "sim (INTENTS_ONCHAIN_ONLY)" : "não"}</dd>
      <dt>Intents: filtro por chains</dt><dd>${cfg.intentsChainsFilterActive ? "ativo (INTENTS_CHAINS)" : "não"}</dd>
      <dt>Intents: mín. lucro extra (USD)</dt><dd>${cfg.intentsMinNetUsdExtra != null ? escapeHtml(String(cfg.intentsMinNetUsdExtra)) : "—"}</dd>
      <dt>DEXSCREENER_CONCURRENCY (por mercado)</dt><dd>${escapeHtml(String(cfg.dexscreenerConcurrency ?? "—"))}</dd>
      <dt>DEXSCREENER_GLOBAL_CONCURRENCY (fila FIFO global)</dt><dd>${escapeHtml(String(cfg.dexscreenerGlobalConcurrency ?? "—"))}</dd>
      <dt>SCAN_PARALLEL</dt><dd>${escapeHtml(String(cfg.scanParallel ?? "—"))}</dd>
      <dt>RPC configurado (booleanos)</dt><dd>${escapeHtml(rpcBits)}</dd>
      <dt>RPC endpoints (contagem / rede)</dt><dd>${escapeHtml(
    Object.entries(cfg.rpcEndpointCounts || {})
      .filter(([, n]) => n > 0)
      .map(([ch, n]) => `${ch}: ${n}`)
      .join(" · ") || "—"
  )} · múltiplos URLs: vírgula no env da rede ou array em RPC_URLS_JSON</dd>
      <dt>Histórico (JSONL)</dt><dd>${cfg.scanHistoryEnabled ? "ligado" : "desligado"} · máx. ${escapeHtml(String(cfg.historyMaxScans ?? ""))} scans · ficheiro: ${escapeHtml(String(cfg.historyFile ?? ""))}</dd>
      <dt>Ruído histórico (avisos no scan)</dt><dd>janela ${escapeHtml(String(cfg.flags?.HISTORY_NOISE_WINDOW_SCANS ?? ""))} · mín. modelo ${escapeHtml(String(cfg.flags?.HISTORY_NOISE_MODEL_MIN ?? ""))} · só dyn: ${escapeHtml(String(cfg.flags?.HISTORY_NOISE_ONLY_DYNAMIC ?? ""))}</dd>
      <dt>Filtros DexScreener (dinâmicos)</dt><dd>vol24h mín. ${escapeHtml(String(cfg.flags?.DYNAMIC_MIN_H24_VOLUME_USD ?? ""))} · vol/liq máx. ${escapeHtml(String(cfg.flags?.DYNAMIC_MAX_VOL_TO_LIQ_RATIO ?? ""))} · idade par (h) ${escapeHtml(String(cfg.flags?.DYNAMIC_MIN_PAIR_AGE_HOURS ?? ""))} · allow ${escapeHtml(String(cfg.flags?.DYNAMIC_DEX_ALLOWLIST ?? ""))} · block ${escapeHtml(String(cfg.flags?.DYNAMIC_DEX_BLOCKLIST ?? ""))}</dd>
      <dt>Agregadores (1inch/0x fallback)</dt><dd>${cfg.aggregatorsEnabled ? "ativos (env + keys)" : "inativos"}</dd>
      <dt>Jupiter Solana</dt><dd>${cfg.jupiterSolEnabled ? "ativo" : "inativo"}</dd>
    </dl>
    <p class="muted" style="margin:0.5rem 0 0">${escapeHtml(cfg.docsHint || "")}</p>
  `;
}

async function loadPublicConfig() {
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    const cfg = await res.json();
    if (res.ok) renderPublicConfig(cfg);
  } catch {
    /* ignore */
  }
}

loadPublicConfig();

function formatMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("pt-BR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

function setGlobalError(msg) {
  if (!msg) {
    globalError.classList.add("hidden");
    globalError.textContent = "";
    return;
  }
  globalError.textContent = msg;
  globalError.classList.remove("hidden");
}

function isRealBlock(block) {
  return Boolean(
    block.analysis &&
      block.analysis.onChainRoundtrip === true &&
      !block.error &&
      !block.disabled
  );
}

function isModelBlock(block) {
  return !isRealBlock(block);
}

function activateTab(which) {
  tabs.forEach((t) => {
    const on = t.dataset.tab === which;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  const showReal = which === "real";
  const showModel = which === "model";
  const showHistory = which === "history";
  if (panelReal) {
    panelReal.classList.toggle("is-active", showReal);
    panelReal.toggleAttribute("hidden", !showReal);
  }
  if (panelModel) {
    panelModel.classList.toggle("is-active", showModel);
    panelModel.toggleAttribute("hidden", !showModel);
  }
  if (panelHistory) {
    panelHistory.classList.toggle("is-active", showHistory);
    panelHistory.toggleAttribute("hidden", !showHistory);
  }
  if (showHistory) {
    loadHistoryPanel();
  }
  try {
    sessionStorage.setItem("hunterTab", which);
  } catch {
    /* ignore */
  }
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

try {
  const saved = sessionStorage.getItem("hunterTab");
  if (saved === "model" || saved === "real" || saved === "history") {
    activateTab(saved);
  }
} catch {
  /* ignore */
}

function createMarketCard(block, data, mode) {
  const card = document.createElement("article");
  card.className = `card ${mode === "real" ? "card--real" : "card--model"}`;

  const title = document.createElement("h2");
  title.textContent = `${block.chain} · ${block.label}`;
  card.appendChild(title);

  const sub = document.createElement("p");
  sub.className = "muted";
  sub.style.margin = "0 0 0.75rem";
  const modeTag =
    mode === "real"
      ? block.analysis?.jupiterRoundtrip
        ? " · Jupiter (REAL)"
        : block.analysis?.aggregatorRoundtrip
          ? " · agregador 1inch/0x (REAL)"
          : " · simulação on-chain (REAL)"
      : block.dynamic
        ? " · mercado automático (modelo)"
        : " · referência DexScreener / modelo";
  sub.textContent = block.id + modeTag;
  card.appendChild(sub);

  if (block.note) {
    const n = document.createElement("p");
    n.className = "muted";
    n.style.fontSize = "0.82rem";
    n.textContent = block.note;
    card.appendChild(n);
  }

  if (Array.isArray(block.historyHints) && block.historyHints.length) {
    for (const h of block.historyHints) {
      const hi = document.createElement("p");
      hi.className = "muted";
      hi.style.fontSize = "0.82rem";
      hi.style.borderLeft = "3px solid #b8860b";
      hi.style.paddingLeft = "0.5rem";
      hi.style.marginTop = "0.35rem";
      hi.textContent = h;
      card.appendChild(hi);
    }
  }

  if (block.onChainSimFailure && !block.disabled && !block.error) {
    const warn = document.createElement("div");
    warn.className = "sim-failure";
    warn.textContent = `Simulação on-chain: ${block.onChainSimFailure.code} — ${block.onChainSimFailure.reason}`;
    card.appendChild(warn);
  }

  if (block.confidence && !block.disabled && !block.error) {
    const c = block.confidence;
    const parts = [];
    parts.push(
      `<span class="${c.rpcOk ? "tag-ok" : "tag-warn"}">${escapeHtml(c.rpcLabel)}</span>`
    );
    parts.push(`quote há ${escapeHtml(formatQuoteAge(c.quoteFetchedAt))}`);
    if (c.quoteMaxAgeSec && typeof c.quoteAgeSec === "number") {
      if (c.quotesStale) {
        parts.push(
          `<span class="tag-warn">stale: ${c.quoteAgeSec}s &gt; ${escapeHtml(String(c.quoteMaxAgeSec))}s</span>`
        );
      } else {
        parts.push(
          `<span class="muted">idade ${c.quoteAgeSec}s (máx ${escapeHtml(String(c.quoteMaxAgeSec))}s)</span>`
        );
      }
    } else if (
      typeof c.quoteAgeSec === "number" &&
      Number.isFinite(c.quoteAgeSec)
    ) {
      parts.push(`<span class="muted">idade quote ${c.quoteAgeSec}s</span>`);
    }
    if (c.priceSource) {
      parts.push(`<span class="muted">${escapeHtml(c.priceSource)}</span>`);
    }
    if (c.dexscreenerLastError) {
      parts.push(
        `<span class="tag-warn">DexScreener falhou: ${escapeHtml(c.dexscreenerLastError)}</span>`
      );
    }
    if (c.coingeckoLastError) {
      parts.push(
        `<span class="tag-warn">CoinGecko falhou: ${escapeHtml(c.coingeckoLastError)}</span>`
      );
    }
    const scanMs =
      typeof c.scanDurationMs === "number" && Number.isFinite(c.scanDurationMs)
        ? c.scanDurationMs
        : typeof data.params?.scanDurationMs === "number"
          ? data.params.scanDurationMs
          : null;
    if (scanMs != null) {
      parts.push(
        `<span class="muted">scan ${(scanMs / 1000).toFixed(2)} s</span>`
      );
    }
    const strip = document.createElement("div");
    strip.className = "confidence-strip";
    strip.title =
      "Indicadores deste mercado: erros DexScreener/CoinGecko, idade das quotes vs QUOTE_MAX_AGE_SEC (se definido).";
    strip.innerHTML = parts.join(" · ");
    card.appendChild(strip);
  }

  if (block.disabled) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = block.setupNote || "Mercado desativado.";
    card.appendChild(p);
    return card;
  }

  if (block.error) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = block.error;
    card.appendChild(p);
    return card;
  }

  const a = block.analysis;
  const ul = document.createElement("ul");
  ul.className = "prices";
  for (const p of block.prices || []) {
    const li = document.createElement("li");
    const src = p.feeSource ? ` · ${p.feeSource}` : "";
    const srcPrice = p.priceSource ? ` <span class="muted">[${p.priceSource}]</span>` : "";
    li.innerHTML = `<span>${p.dex} <span class="muted">(${p.feeBps} bps${src})</span>${srcPrice}</span><span>${formatMoney(p.price)}</span>`;
    ul.appendChild(li);
  }
  card.appendChild(ul);

  const decision = document.createElement("div");
  decision.className = `decision ${a.worthwhile ? "good" : "bad"}`;
  if (mode === "real") {
    decision.textContent = a.worthwhile
      ? "Compensa na simulação REAL (on-chain)"
      : "Não compensa na simulação REAL (on-chain)";
  } else {
    decision.textContent = a.worthwhile
      ? "Compensa no modelo fictício (referência)"
      : "Não compensa no modelo fictício (referência)";
  }
  card.appendChild(decision);

  const metrics = document.createElement("div");
  const gasLabel =
    a.gasSource === "rpc_estimateGas"
      ? "Gas (estimateGas, 2 txs)"
      : a.gasSource === "rpc" ||
          a.gasSource === "rpc_swap_limit_x2" ||
          a.gasSource === "rpc_table"
        ? "Gas (RPC, 2 txs)"
        : "Gas (tabela, 2 txs)";
  const slipLabel =
    a.slippageMode === "impact"
      ? "Impacto (liq. DexScreener)"
      : `Slippage (${data.params?.slippageBps ?? 20} bps)`;

  const poolFeeCell =
    a.feesIncludedInQuote && (!Number(a.poolFeesUsd) || a.poolFeesUsd === 0)
      ? `<div><span>Taxas de pool</span><span class="muted">inclusas no quote</span></div>`
      : `<div><span>Taxas de pool</span><span>−${formatMoney(a.poolFeesUsd)}</span></div>`;

  metrics.className = "metrics";
  metrics.innerHTML = `
      <div><span>Comprar</span><span>${a.buyDex}</span></div>
      <div><span>Vender</span><span>${a.sellDex}</span></div>
      <div><span>Spread bruto</span><span>${a.spreadPercent.toFixed(4)}%</span></div>
      <div><span>Lucro bruto</span><span>${formatMoney(a.grossProfitUsd)}</span></div>
      <div><span>${gasLabel}</span><span>−${formatMoney(a.gasCostUsd)}</span></div>
      <div><span>${slipLabel}</span><span>−${formatMoney(a.slippageUsd)}</span></div>
      ${poolFeeCell}
      <div><span>Lucro líquido</span><span>${formatMoney(a.netProfitUsd)}</span></div>
      <div><span>Notional</span><span>${formatMoney(data.params?.notionalUsd)}</span></div>
    `;
  card.appendChild(metrics);

  const ol = document.createElement("ol");
  ol.className = "explain";
  for (const line of a.explanation || []) {
    const li = document.createElement("li");
    li.textContent = line;
    ol.appendChild(li);
  }
  card.appendChild(ol);

  return card;
}

function renderPanel(container, blocks, data, mode) {
  container.innerHTML = "";
  if (blocks.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    if (mode === "real") {
      const all = data.markets || [];
      const anyModel = all.some(isModelBlock);
      if (all.length === 0) {
        p.textContent =
          "Nenhum mercado neste scan. Rode npm run seed:tokens e reinicie o servidor.";
      } else if (!anyModel) {
        p.textContent =
          "Nenhum mercado com simulação REAL neste scan (só erros, desativados ou vazios). Verifique RPC e pools curados.";
      } else {
        p.appendChild(
          document.createTextNode(
            "Não há cartões nesta aba REAL (on-chain, Jupiter ou agregador). Os spreads de referência estão na aba Modelo. Para automação, consulte "
          )
        );
        const code = document.createElement("code");
        code.textContent = "GET /api/intents";
        p.appendChild(code);
        p.appendChild(
          document.createTextNode(
            " (mercados worthwhile do último scan). Ative RPC_<REDE> no servidor para simulações reais."
          )
        );
      }
    } else {
      p.textContent = "Nenhum mercado nesta categoria.";
    }
    container.appendChild(p);
    return;
  }

  const slice = blocks.slice(0, UI_MAX_PER_TAB);
  if (blocks.length > UI_MAX_PER_TAB) {
    const note = document.createElement("p");
    note.className = "muted";
    note.style.marginBottom = "1rem";
    note.textContent = `Mostrando ${UI_MAX_PER_TAB} de ${blocks.length} mercados nesta aba. JSON completo: /api/scan`;
    container.appendChild(note);
  }

  for (const block of slice) {
    container.appendChild(createMarketCard(block, data, mode));
  }
}

function populateHistoryMarketsSelect() {
  const sel = historyMarketSelect;
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">Média de todos (por scan)</option>';
  for (const m of lastMarketList) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  const hasPrev = [...sel.options].some((o) => o.value === prev);
  sel.value = hasPrev ? prev : "";
}

function normalizeHistorySeries(points, singleMarket) {
  if (singleMarket) {
    return points
      .filter((p) => Number.isFinite(p.netProfitUsd))
      .map((p) => ({ t: p.t, y: p.netProfitUsd }))
      .sort((a, b) => a.t - b.t);
  }
  const byT = new Map();
  for (const p of points) {
    if (!Number.isFinite(p.netProfitUsd)) continue;
    if (!byT.has(p.t)) byT.set(p.t, []);
    byT.get(p.t).push(p.netProfitUsd);
  }
  const arr = [];
  for (const [t, ys] of byT) {
    arr.push({
      t,
      y: ys.reduce((a, b) => a + b, 0) / ys.length
    });
  }
  arr.sort((a, b) => a.t - b.t);
  return arr;
}

let historyRequestSeq = 0;

function drawHistoryChart(svg, points, marketKey) {
  const single = Boolean(marketKey);
  const series = normalizeHistorySeries(points, single);
  const W = 520;
  const H = 200;
  const padL = 52;
  const padR = 14;
  const padT = 18;
  const padB = 34;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  if (!svg) return;
  if (series.length === 0) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#8b98ab" font-size="13">Sem dados ainda — deixe o painel correr alguns scans com histórico ligado.</text>`;
    return;
  }
  const ys = series.map((s) => s.y);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    svg.innerHTML = "";
    return;
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const yPad = (maxY - minY) * 0.08 || 1;
  minY -= yPad;
  maxY += yPad;
  const n = series.length;
  const xAt = (i) => padL + iw * (n === 1 ? 0.5 : i / (n - 1));
  const yAt = (y) => {
    const span = maxY - minY || 1;
    return padT + ih * (1 - (y - minY) / span);
  };
  let d = "";
  for (let i = 0; i < series.length; i++) {
    const x = xAt(i);
    const y = yAt(series[i].y);
    d += (i === 0 ? "M" : "L") + `${x.toFixed(1)},${y.toFixed(1)}`;
  }
  const zeroIn = minY < 0 && maxY > 0;
  const zy = zeroIn ? yAt(0) : null;
  const label = single
    ? escapeHtml(marketKey)
    : "média de mercados (por scan)";
  const y0 = padT + ih;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" fill="none" />
    <line x1="${padL}" y1="${y0.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y0.toFixed(1)}" stroke="#1e293b" />
    ${
      zeroIn && zy != null
        ? `<line x1="${padL}" y1="${zy.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${zy.toFixed(1)}" stroke="#64748b" stroke-dasharray="5 5" />`
        : ""
    }
    <path d="${d}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <text x="${padL}" y="${H - 10}" fill="#8b98ab" font-size="11">${label} — lucro líq. USD</text>
    <text x="${padL}" y="14" fill="#64748b" font-size="10">min ${escapeHtml(Number(minY).toFixed(2))} · máx ${escapeHtml(Number(maxY).toFixed(2))}</text>
  `;
}

async function loadHistoryPanel() {
  const status = document.getElementById("historyStatus");
  const svg = document.getElementById("historyChart");
  if (!status || !svg) return;
  const seq = ++historyRequestSeq;
  status.textContent = "A carregar…";
  try {
    const mid =
      historyMarketSelect && historyMarketSelect.value
        ? historyMarketSelect.value
        : "";
    const q = new URLSearchParams({ limit: "150" });
    if (mid) q.set("marketId", mid);
    const res = await fetch(`/api/history?${q}`, { cache: "no-store" });
    const body = await res.json();
    if (seq !== historyRequestSeq) return;
    if (!res.ok) throw new Error(body.error || res.statusText);
    const points = body.points || [];
    status.textContent = `${points.length} amostras · ${new Date(body.updatedAt).toLocaleString("pt-BR")}`;
    drawHistoryChart(svg, points, mid);
  } catch (e) {
    if (seq !== historyRequestSeq) return;
    status.textContent = e.message || String(e);
    drawHistoryChart(svg, [], "");
  }
}

async function exportScan(format) {
  fetchStatus.textContent = "export…";
  setGlobalError("");
  try {
    const res = await fetch(
      `/api/scan/export?format=${encodeURIComponent(format)}&useLast=1`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText);
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    let name = format === "csv" ? "hunter-scan.csv" : "hunter-scan.json";
    const m = /filename\*=UTF-8''([^;\n]+)|filename="([^"]+)"/i.exec(cd);
    if (m) {
      try {
        name = decodeURIComponent(m[1] || m[2]);
      } catch {
        name = m[1] || m[2];
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    fetchStatus.textContent = "ok";
  } catch (e) {
    fetchStatus.textContent = "erro";
    setGlobalError(e.message || String(e));
  }
}

function renderMarkets(data) {
  const list = data.markets || [];
  const realList = list.filter(isRealBlock);
  const modelList = list.filter(isModelBlock);

  if (data.params) {
    const p = data.params;
    const parts = [
      `total ${list.length}`,
      `reais ${realList.length}`,
      `modelo ${modelList.length}`,
      p.seedTokensFileLoaded ? "seed OK" : "sem seed",
      p.dynamicDisabled ? "dinâmico off" : `até ${p.maxDynamicMarkets} dinâm.`,
      p.useRealChainData ? "RPC/CG" : "tabela",
      p.gasModel?.includes("rpc") ? "gas RPC" : "gas tabela"
    ];
    if (
      typeof p.minNetProfitUsd === "number" &&
      Number.isFinite(p.minNetProfitUsd)
    ) {
      parts.push(`mín líq ${p.minNetProfitUsd} USD`);
    }
    if (
      typeof p.minSpreadPercent === "number" &&
      Number.isFinite(p.minSpreadPercent) &&
      p.minSpreadPercent > 0
    ) {
      parts.push(`mín spread ${p.minSpreadPercent}%`);
    }
    const intents = data.intents || [];
    if (intents.length > 0) {
      parts.push(`intents ${intents.length}`);
    }
    if (metaSummary) metaSummary.textContent = parts.join(" · ");
  }

  if (list.length === 0) {
    const empty =
      '<p class="muted">Nenhum mercado. Rode <code>npm run seed:tokens</code> e reinicie o servidor.</p>';
    panelReal.innerHTML = empty;
    panelModel.innerHTML = empty;
    return;
  }

  renderPanel(panelReal, realList, data, "real");
  renderPanel(panelModel, modelList, data, "model");

  lastMarketList = (data.markets || [])
    .filter((m) => m.id && !m.disabled && !m.error)
    .map((m) => ({ id: m.id, label: `${m.chain} · ${m.label}` }));
  populateHistoryMarketsSelect();
  if (
    panelHistory &&
    !panelHistory.hasAttribute("hidden") &&
    panelHistory.classList.contains("is-active")
  ) {
    loadHistoryPanel();
  }
}

function maybeNotify(data) {
  const list = data.markets || [];
  const anyGood = list.some((m) => m.analysis && m.analysis.worthwhile);

  const now = Date.now();
  const cooled = now - lastNotifyAt > NOTIFY_COOLDOWN_MS;

  if (anyGood && (!lastHadOpportunity || cooled)) {
    if (Notification.permission === "granted") {
      const parts = list
        .filter((m) => m.analysis && m.analysis.worthwhile)
        .map((m) => {
          const tag = m.analysis.jupiterRoundtrip
            ? "Jupiter"
            : m.analysis.aggregatorRoundtrip
              ? "agregador"
              : m.analysis.onChainRoundtrip
                ? "REAL"
                : "modelo";
          return `${m.chain} ${m.label}: ${formatMoney(m.analysis.netProfitUsd)} (${tag})`;
        })
        .join(" · ");
      new Notification("HUNTER SCANNER", {
        body: parts || "Margem positiva em algum mercado.",
        tag: "hunter-scan"
      });
      lastNotifyAt = now;
    }
  }

  lastHadOpportunity = anyGood;
}

async function fetchScan() {
  fetchStatus.textContent = "atualizando…";
  setGlobalError("");
  try {
    const res = await fetch("/api/scan", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || res.statusText);
    }
    lastUpdated.textContent = new Date(data.updatedAt).toLocaleString("pt-BR");
    fetchStatus.textContent = "ok";
    if (scanDurationMs) {
      if (data.params && typeof data.params.scanDurationMs === "number") {
        scanDurationMs.textContent = `${(data.params.scanDurationMs / 1000).toFixed(2)} s`;
      } else {
        scanDurationMs.textContent = "—";
      }
    }
    renderMarkets(data);
    maybeNotify(data);
  } catch (e) {
    fetchStatus.textContent = "erro";
    setGlobalError(e.message || String(e));
  }
}

btnNotify.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    notifyStatus.textContent = "Notificações não suportadas neste navegador.";
    return;
  }
  if (Notification.permission === "granted") {
    notifyStatus.textContent = "Já ativado.";
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    notifyStatus.textContent = "Ativado.";
    new Notification("HUNTER SCANNER", {
      body:
        "Aviso quando algum mercado mostrar lucro líquido > 0 (aba REAL = on-chain; aba modelo = referência)."
    });
  } else {
    notifyStatus.textContent = "Permissão negada.";
  }
});

if ("Notification" in window) {
  if (Notification.permission === "granted") {
    notifyStatus.textContent = "Notificações ativas.";
  } else if (Notification.permission === "denied") {
    notifyStatus.textContent = "Permissão bloqueada no navegador.";
    btnNotify.disabled = true;
  }
}

if (btnExportCsv) {
  btnExportCsv.addEventListener("click", () => exportScan("csv"));
}
if (btnExportJson) {
  btnExportJson.addEventListener("click", () => exportScan("json"));
}
if (btnHistoryRefresh) {
  btnHistoryRefresh.addEventListener("click", () => loadHistoryPanel());
}
if (historyMarketSelect) {
  historyMarketSelect.addEventListener("change", () => loadHistoryPanel());
}

fetchScan();
setInterval(fetchScan, POLL_MS);

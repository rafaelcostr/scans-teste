# DEX Scanner

Scanner local de oportunidades de spread/arbitragem em DEXs: painel web, quotes DexScreener, simulação on-chain (`eth_call`) e executor paper (dry-run) — sem enviar transações reais.

> **Resumo:** o scanner compara preços entre pools, estima lucro líquido (spread − taxas − gas − slippage) e marca mercados *worthwhile*. O executor valida intents, aplica política de risco e simula ticks — útil para estudar MEV/arbitragem antes de usar capital real.

---

## O que este projeto faz

1. **Scan de mercados** — Busca pares em várias chains (Base, Arbitrum, Polygon, etc.) via DexScreener e/ou listas curadas em `data/seed-tokens.json`.
2. **Análise de margem** — Calcula spread bruto, taxas de pool, gas estimado e slippage sobre um notional configurável (`NOTIONAL_USD`).
3. **Simulação REAL (on-chain)** — Com `RPC_<REDE>`, faz `eth_call` / `estimateGas` em contratos curados (round-trip compra→venda) sem assinar transação.
4. **Intents** — Mercados que passam nos filtros viram *intents* exportáveis para um executor futuro.
5. **Painel web** — UI em `public/` com polling automático, gráficos de histórico, filtros e export CSV/JSON.
6. **Executor (dry-run)** — Fila em memória com autenticação por `EXECUTOR_API_KEY`; ticks validam risco e registram paper trades.
7. **Webhooks** — POST opcional quando há oportunidades worthwhile (com HMAC opcional).

**O que NÃO faz (neste repositório):** não envia transações on-chain, não gerencia chaves privadas de carteira nem executa trades reais com capital.

---

## Arranque rápido (Windows — duplo clique)

Na pasta do projeto:

| Ficheiro | O que faz |
|----------|-----------|
| **`INICIAR.bat`** | Menu (painel, simulação paper, testes) |
| **`INICIAR-Painel.bat`** | Só o servidor + painel |
| **`INICIAR-Simulacao-Base.bat`** | Simulação paper em Base (sem saldo na carteira) |
| **`INICIAR-Paper-Loop.bat`** | Loop contínuo paper (requer painel + `EXECUTOR_API_KEY`) |
| **`CRIAR-ENV.bat`** | Cria `.env` a partir de `.env.example` |

1. Copie `.env.example` → `.env` e preencha pelo menos `RPC_BASE` (opcional para simulação on-chain).
2. Duplo clique em **`INICIAR.bat`** → opção **1** para o painel.

Equivalente em terminal: `npm install` · `npm run menu` · `npm run start:win`

---

## Arranque (terminal)

```bash
npm install
cp .env.example .env   # ou CRIAR-ENV.bat no Windows
# Edite .env — mínimo recomendado: RPC_BASE=https://...

npm start              # servidor + painel em http://127.0.0.1:3000
npm run scan           # scan único via CLI (sem servidor)
npm test               # suite de testes Node
npm run typecheck      # verificação TypeScript (types/scan.ts)
```

Scripts adicionais: ver secção [Scripts úteis](#scripts-úteis).

---

## Arquitetura modular

O código está organizado por **responsabilidade**. Cada módulo em `lib/` deve ser alterado de forma isolada; dependências fluem de cima para baixo (entrada → scan → execução).

```
scans-teste/
├── server.js              # HTTP Express: rotas públicas + montagem do executor
├── scanner.js             # Orquestrador do scan (CLI + runScan)
├── index.js               # Entrada CLI mínima
│
├── lib/
│   ├── scan/              # (lógica de scan — ficheiros na raiz lib/)
│   │   ├── scan-intents.js
│   │   ├── scan-quality.js
│   │   ├── scan-history.js
│   │   ├── scan-history-noise.js
│   │   ├── scan-history-volatility.js
│   │   ├── scan-diagnostics.js
│   │   ├── scan-export.js
│   │   ├── scan-no-intents-hint.js
│   │   └── last-scan-cache.js
│   │
│   ├── pricing/           # Quotes e simulação de preço
│   │   ├── chain-metrics.js
│   │   ├── curated-onchain-sim.js
│   │   ├── aggregator-roundtrip.js
│   │   ├── jupiter-sol.js
│   │   ├── profit-threshold.js
│   │   ├── quote-sim-options.js
│   │   ├── dynamic-markets.js
│   │   ├── dynamic-quality.js
│   │   └── stable-model-warnings.js
│   │
│   ├── sources/           # Integrações externas
│   │   ├── dexscreener-client.js
│   │   ├── rpc-evm.js
│   │   ├── instrumented-json-rpc-provider.js
│   │   ├── coingecko-native-usd.js
│   │   └── contracts.ts
│   │
│   ├── infra/             # Resiliência e telemetria
│   │   ├── http-resilience.js
│   │   ├── rpc-resilience.js
│   │   ├── rpc-circuit-metrics.js
│   │   ├── dexscreener-telemetry.js
│   │   └── stable-signal-metrics.js
│   │
│   ├── execution/         # Executor paper + fila
│   │   ├── execution-auth.js
│   │   ├── execution-routes.js
│   │   ├── execution-queue.js
│   │   ├── execution-handler.js
│   │   ├── executor-paper-sim.js
│   │   ├── paper-trade-log.js
│   │   └── risk-policy.js
│   │
│   └── config/            # Configuração e notificações
│       ├── public-config.js
│       ├── env-validate.js
│       └── webhook-notify.js
│
├── public/                # Frontend estático (painel)
├── scripts/               # CLI auxiliar (paper loop, menu Windows, testes)
├── tests/                 # Testes por módulo (*.test.js)
├── data/                  # JSON/JSONL (histórico, seeds, paper trades)
└── types/scan.ts          # Tipos TypeScript de referência
```

### Mapa de dependências (manutenção)

| Módulo | Responsabilidade | Alterar quando… |
|--------|------------------|-----------------|
| `scanner.js` | Pipeline completo do scan | Mudar ordem de mercados, paralelismo, gates finais |
| `chain-metrics` + `sources/*` | Dados on-chain e DexScreener | Novo RPC, fallback, rate limit |
| `curated-onchain-sim` | Pools curados e Quoter | Adicionar pool/DEX em mercado fixo |
| `dynamic-markets` | Descoberta automática de pares | Critérios de seed, liquidez mínima |
| `scan-intents` + `scan-quality` | Filtros worthwhile | Limiares de lucro/spread |
| `execution-*` + `risk-policy` | Fila e validação pré-trade | Regras antes de ordem real |
| `webhook-notify` | Alertas externos | Formato do payload, deduplicação |
| `public-config` | O que o browser pode ver | Novos flags públicos (nunca segredos) |

---

## API HTTP (servidor local)

| Rota | Auth | Descrição |
|------|------|-----------|
| `GET /api/scan` | — | Executa scan completo (pesado) |
| `GET /api/config` | — | Config pública (sem RPC URLs nem chaves) |
| `GET /api/intents` | — | Intents do último scan em cache |
| `GET /api/history` | — | Histórico JSONL por mercado |
| `GET /api/scan/export` | — | Export CSV/JSON |
| `GET /api/env-example` | — | Conteúdo de `.env.example` |
| `GET /api/executor/paper-sim` | — | Relatório paper (pode re-chamar RPC) |
| `GET /api/paper/report` | — | Relatório agregado paper trades |
| `POST /api/executor/enqueue` | `EXECUTOR_API_KEY` | Enfileira intents |
| `POST /api/executor/tick` | `EXECUTOR_API_KEY` | Processa próximo job (dry-run) |
| `GET /api/executor/queue` | `EXECUTOR_API_KEY` | Estado da fila |

Header de auth do executor: `X-Executor-Key` ou `Authorization: Bearer <chave>`.

---

## Segurança e análise de superfície de ataque

Este projeto foi desenhado para **uso local / rede privada**. Não exponha o servidor diretamente à Internet sem camadas extra.

### Pontos positivos

- **Segredos só no servidor:** URLs de RPC, chaves 1inch/0x, `EXECUTOR_API_KEY` e `WEBHOOK_SECRET` nunca vão para `GET /api/config`.
- **Validação no arranque:** `lib/env-validate.js` avisa/aborta config inválida.
- **Executor protegido:** rotas `/api/executor/enqueue|tick|queue` exigem chave; `EXECUTOR_KILL_SWITCH=1` bloqueia operações.
- **Webhooks com HMAC:** `WEBHOOK_SECRET` assina o corpo (`X-Webhook-Signature: sha256=…`).
- **Dry-run only:** simulações usam `eth_call` — não há assinatura de transação neste repo.
- **Política de risco:** `risk-policy.js` limita notional, idade de quote, slippage, chains permitidas.

### Riscos e recomendações (checklist pentest)

| Risco | Severidade | Mitigação |
|-------|------------|-----------|
| **`GET /api/scan` sem auth** — scan custoso; DoS se exposto | Alta (se público) | Firewall, reverse proxy, rate limit, bind `127.0.0.1` |
| **`/api/executor/paper-sim` sem auth** — dispara chamadas RPC | Média | Não expor; ou exigir mesma auth do executor |
| **`/api/paper/*` sem auth** — vaza histórico de simulações | Baixa–Média | Rede privada ou auth no proxy |
| **SSRF via `WEBHOOK_URL`** — servidor faz POST para URL controlada | Média | Validar host allowlist; não usar URLs de terceiros |
| **Vazamento de `.env`** — commit acidental | Alta | `.gitignore`, nunca commitar `.env`; usar CI secret scan |
| **`EXECUTOR_API_KEY` curta** | Alta | ≥16 caracteres aleatórios; rotacionar |
| **Servidor escuta `0.0.0.0` por defeito** | Média | Usar `PORT` só em localhost ou proxy com TLS |
| **Sem rate limit HTTP** | Média | nginx/traefik ou middleware Express |
| **Dependências npm** | Contínua | `npm audit`, atualizar axios/ethers/express |
| **Informação em exports** | Baixa | CSV/JSON podem conter endereços de pool — tratar como dados sensíveis de estratégia |

### Testes de segurança sugeridos

1. Confirmar que `/api/config` não contém substrings de `RPC_`, chaves de agregador nem `EXECUTOR_API_KEY`.
2. Tentar `POST /api/executor/tick` sem header → esperar `401`.
3. Com `EXECUTOR_KILL_SWITCH=1`, enqueue/tick → `403`.
4. Configurar webhook para receptor local (`npm run webhook:echo`) e validar HMAC.
5. Se for expor: scan com OWASP ZAP/nuclei nas rotas GET; limitar tamanho de body (já `512kb` no JSON parser).

---

## Documentação de configuração

- `.env.example` — lista comentada de variáveis.
- `config.schema.json` — referência JSON Schema das chaves principais (IDE / auditoria).
- `lib/env-validate.js` — avisos e erros no arranque do servidor.

---

## Scripts úteis

| Comando | Descrição |
|---------|-----------|
| `npm test` | Testes Node (`tests/*.test.js`) |
| `npm run typecheck` | TypeScript (`types/scan.ts`) |
| `npm run webhook:echo` | Receptor local para testar webhooks |
| `npm run executor:tick` | Um passo da fila dry-run (requer servidor + chave) |
| `npm run executor:simulate -- --chain=base` | Simulação paper sem carteira |
| `npm run paper:loop` | Loop contínuo scan → enqueue → tick |

---

## Simulação antes de usar saldo real (paper)

Não precisa de ETH/USDC na carteira para aprender o fluxo:

1. Crie conta gratuita em Alchemy/Infura e defina no `.env`: `RPC_BASE=https://...`
2. Execute: `npm run executor:simulate -- --chain=base`
3. Ou com o servidor ligado: `npm start` → abra o painel → noutro terminal:
   `npm run executor:simulate -- --from-server`
4. Relatório em texto: `http://127.0.0.1:3000/api/executor/paper-sim?format=text&marketId=base-weth-usdc`

Isto valida o intent e **re-simula on-chain** (`eth_call`) quando há RPC — igual ao modo “REAL” do painel, mas **nunca assina transação**.

---

## Polygon e dois USDC

O simulador curado escolhe stable por pool. Para **agregadores** em Polygon, defina `AGGREGATOR_POLYGON_STABLE` (endereço do contrato USDC desejado) e opcionalmente `AGGREGATOR_POLYGON_STABLE_DECIMALS`. O default aponta para o USDC nativo (Circle) na Polygon PoS.

---

## Simulação e bloco

`QUOTE_SIM_BLOCK_TAG` permite aproximar leituras com `pending` ou altura explícita (quando o nó suporta). Isto não substitui um executor com estado de mempool completo.

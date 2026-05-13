/**
 * Contratos por fonte de dados. Implementações:
 * - DexScreener → `dexscreener-client.js`
 * - Preço nativo USD (CoinGecko) → `coingecko-native-usd.js`
 * - RPC EVM (gas, fee tier) → `rpc-evm.js` + orquestração em `chain-metrics.js`
 * - Simulação on-chain curada → `curated-onchain-sim.js`
 */

import type {
  CuratedPoolInput,
  DexScreenerPairQuote,
  MarketDiagCoingecko,
  MarketDiagDexscreener
} from "../../types/scan";

/** Fonte HTTP DexScreener (par/pair). */
export interface IDexScreenerPairSource {
  readonly sourceId: "dexscreener";
  fetchPairQuote(
    pool: CuratedPoolInput,
    dexDiag: MarketDiagDexscreener
  ): Promise<DexScreenerPairQuote>;
}

/**
 * Preço spot do ativo nativo da chain em USD (simple/price).
 * Erros reportam-se em `cgSink` (por mercado).
 */
export interface ICoinGeckoNativeUsdSource {
  readonly sourceId: "coingecko";
  fetchNativeUsd(
    chainSlug: string,
    cgSink: { coingecko: MarketDiagCoingecko } | null | undefined
  ): Promise<number | null>;
}

/** Acesso JSON-RPC + leituras de contrato para gas e fee tier V3-style. Ver `rpc-evm.js`. */
export interface IRpcEvmPoolSource {
  readonly sourceId: "rpc_evm";
}

/**
 * Simulação só leitura (Quoter / pools). Implementação: `curated-onchain-sim.js`.
 */
export interface IOnChainSimulationSource {
  readonly sourceId: "onchain_sim";
}

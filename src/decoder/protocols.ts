/**
 * Costanti dei protocolli riconosciuti — TUTTE derivate da dati di catena
 * il 22/08/2026, non trascritte a mano (la costante fee scritta "a memoria"
 * aveva un carattere sbagliato; l'indirizzo della banca battuto a memoria in uno
 * script ne aveva parecchi: non si ripete l'errore).
 * La FONTE UNICA è protocol-constants.json, condivisa con gli script delle Action.
 */
import C from './protocol-constants.json'

export const SIGMAUSD = {
  bankAddress: C.sigmausd.bankAddress,
  bankNft: C.sigmausd.bankNft,
  sigUsd: C.sigmausd.sigUsd,
  sigRsv: C.sigmausd.sigRsv,
  sigUsdDecimals: 2,
} as const

export const SPECTRUM = { n2tPoolAddress: C.spectrum.n2tPoolAddress } as const
export const ORACLE = {
  ergUsdNft: C.oracle.ergUsdNft,
  // pool v1 (quello che la banca SigmaUSD legge): gettone dei partecipanti e i due contratti dell'epoca
  ergUsdPt: C.oracle.ergUsdPt,
  v1LiveEpochAddress: C.oracle.v1LiveEpochAddress,
  v1EpochPrepAddress: C.oracle.v1EpochPrepAddress,
  v1DatapointAddress: C.oracle.v1DatapointAddress,
  // pool v2 «cooperativi»: NFT del pool, NFT del refresh, gettone degli operatori
  usd: { poolNft: C.oracle.usdPoolNft, refreshNft: C.oracle.usdRefreshNft, oracleToken: C.oracle.usdOracleToken },
  gold: { poolNft: C.oracle.goldPoolNft, refreshNft: C.oracle.goldRefreshNft, oracleToken: C.oracle.goldOracleToken },
} as const

/** Emissione e ri-emissione (EIP-27). Gli NFT sono unici per costruzione; il contratto delle
 *  ricompense ha un indirizzo per minatore, quindi si riconosce dalla FORMA dell'ErgoTree:
 *  «spendibile dopo 720 blocchi dalla creazione, con la firma di questa chiave». */
export const MINING = {
  emissionNft: C.mining.emissionNft,
  reemissionNft: C.mining.reemissionNft,
  reemissionToken: C.mining.reemissionToken,
  payToReemissionAddress: C.mining.payToReemissionAddress,
  minerRewardTree: { prefix: C.mining.minerRewardTreePrefix, suffix: C.mining.minerRewardTreeSuffix, length: C.mining.minerRewardTreeHexLength },
} as const
export const ROSEN = { hotWallet: C.rosen.hotWallet } as const

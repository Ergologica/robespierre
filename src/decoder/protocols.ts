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
export const ORACLE = { ergUsdNft: C.oracle.ergUsdNft } as const
export const ROSEN = { hotWallet: C.rosen.hotWallet } as const

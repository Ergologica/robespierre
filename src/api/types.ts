/** Sottoinsieme tipizzato delle risposte dell'Explorer API v1 che Cinabro usa davvero. */

export interface Asset { tokenId: string; amount: number | string; name?: string | null; decimals?: number | null }

export interface BoxLike {
  boxId: string
  value: number | string
  address: string
  assets?: Asset[]
  additionalRegisters?: Record<string, unknown>
  spentTransactionId?: string | null
}

export interface Tx {
  id: string
  timestamp: number
  inclusionHeight?: number
  numConfirmations?: number
  size?: number
  inputs: BoxLike[]
  outputs: BoxLike[]
}

export interface NetworkInfo { lastBlockId: string; height: number }

export interface BlockHeader {
  id: string; height: number; timestamp: number
  transactionsCount: number; miner?: { address: string; name?: string }; size: number
}

export interface AddressBalance { nanoErgs: number | string; tokens?: Asset[] }

export interface Paged<T> { items: T[]; total: number }

export interface TokenInfo {
  id: string; name?: string | null; decimals?: number | null
  emissionAmount?: number | string | null; description?: string | null; type?: string | null
}

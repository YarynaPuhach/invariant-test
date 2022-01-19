import { Token } from '@consts/static'
import { Pair } from '@invariant-labs/sdk'
import { PoolStructure } from '@invariant-labs/sdk/lib/market'
import { Tick } from '@invariant-labs/sdk/src/market'
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { PublicKey } from '@solana/web3.js'
import { PayloadType } from './types'

export interface PoolWithAddress extends PoolStructure {
  address: PublicKey
}

export interface IPoolsStore {
  tokens: Record<string, Token>
  pools: PoolWithAddress[]
  poolTicks: { [key in string]: Tick[] }
  initPool: boolean
}

export interface UpdatePool {
  index: number
  poolStructure: PoolStructure
}

export interface UpdateTick {
  index: number
  tickStructure: Tick[]
}

export interface UpdateTicks {
  poolIndex: string
  index: number
  tick: Tick
}

export const defaultState: IPoolsStore = {
  tokens: {},
  pools: [],
  poolTicks: {},
  initPool: false
}

export const poolsSliceName = 'pools'
const poolsSlice = createSlice({
  name: poolsSliceName,
  initialState: defaultState,
  reducers: {
    initPool(state, action: PayloadAction<boolean>) {
      state.initPool = action.payload
      return state
    },
    setTokens(state, action: PayloadAction<Record<string, Token>>) {
      state.tokens = action.payload
      return state
    },
    setPools(state, action: PayloadAction<PoolWithAddress[]>) {
      state.pools = action.payload
      return state
    },
    setTicks(state, action: PayloadAction<UpdateTick>) {
      state.poolTicks[action.payload.index] = action.payload.tickStructure
      return state
    },
    updatePool(state, action: PayloadAction<UpdatePool>) {
      state.pools[action.payload.index] = {
        address: state.pools[action.payload.index].address,
        ...action.payload.poolStructure
      }
      return state
    },
    updateTicks(state, action: PayloadAction<UpdateTicks>) {
      state.poolTicks[action.payload.poolIndex][
        state.poolTicks[action.payload.poolIndex].findIndex(e => e.index === action.payload.index)
      ] = action.payload.tick
    },

    getPoolsData(_state, _action: PayloadAction<Pair[]>) {}
  }
})

export const actions = poolsSlice.actions
export const reducer = poolsSlice.reducer
export type PayloadTypes = PayloadType<typeof actions>

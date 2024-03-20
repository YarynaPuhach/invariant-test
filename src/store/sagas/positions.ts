import { WRAPPED_SOL_ADDRESS } from '@consts/static'
import {
  createLiquidityPlot,
  createPlaceholderLiquidityPlot,
  getPositionsAddressesFromRange,
  solToPriorityFee
} from '@consts/utils'
import { Pair } from '@invariant-labs/sdk'
import { Staker } from '@invariant-labs/staker-sdk'
import { actions as farmsActions } from '@reducers/farms'
import { ListPoolsResponse, ListType, actions as poolsActions } from '@reducers/pools'
import {
  ClosePositionData,
  GetCurrentTicksData,
  InitPositionData,
  actions
} from '@reducers/positions'
import { actions as snackbarsActions } from '@reducers/snackbars'
import { GuardPredicate } from '@redux-saga/types'
import { PayloadAction } from '@reduxjs/toolkit'
import { stakesForPosition } from '@selectors/farms'
import { poolsArraySortedByFees, tokens } from '@selectors/pools'
import { positionsWithPoolsData, singlePositionData } from '@selectors/positions'
import { network, rpcAddress } from '@selectors/solanaConnection'
import { accounts } from '@selectors/solanaWallet'
import { NATIVE_MINT, TOKEN_PROGRAM_ID, Token } from '@solana/spl-token'
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmRawTransaction
} from '@solana/web3.js'
import { getMarketProgram } from '@web3/programs/amm'
import { getStakerProgram } from '@web3/programs/staker'
import { all, call, put, select, spawn, take, takeEvery, takeLatest } from 'typed-redux-saga'
import { getConnection } from './connection'
import { createClaimAllPositionRewardsTx } from './farms'
import { createAccount, getWallet, sleep } from './wallet'

export function* handleInitPositionWithSOL(action: PayloadAction<InitPositionData>): Generator {
  const data = action.payload

  const isNoSOLAmount =
    (data.tokenX.toString() === WRAPPED_SOL_ADDRESS && data.xAmount === 0) ||
    (data.tokenY.toString() === WRAPPED_SOL_ADDRESS && data.yAmount === 0)
  console.log(isNoSOLAmount)

  if (isNoSOLAmount) {
    return yield* call(handleInitPosition, action)
  }

  try {
    const connection = yield* call(getConnection)
    const wallet = yield* call(getWallet)
    const networkType = yield* select(network)
    const rpc = yield* select(rpcAddress)
    const marketProgram = yield* call(getMarketProgram, networkType, rpc)

    const tokensAccounts = yield* select(accounts)
    const allTokens = yield* select(tokens)

    const wrappedSolAccount = Keypair.generate()

    const createIx = SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: wrappedSolAccount.publicKey,
      lamports: yield* call(Token.getMinBalanceRentForExemptAccount, connection),
      space: 165,
      programId: TOKEN_PROGRAM_ID
    })

    const transferIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wrappedSolAccount.publicKey,
      lamports:
        allTokens[data.tokenX.toString()].address.toString() === WRAPPED_SOL_ADDRESS
          ? data.xAmount
          : data.yAmount
    })

    const initIx = Token.createInitAccountInstruction(
      TOKEN_PROGRAM_ID,
      NATIVE_MINT,
      wrappedSolAccount.publicKey,
      wallet.publicKey
    )

    const unwrapIx = Token.createCloseAccountInstruction(
      TOKEN_PROGRAM_ID,
      wrappedSolAccount.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      []
    )

    let userTokenX =
      allTokens[data.tokenX.toString()].address.toString() === WRAPPED_SOL_ADDRESS
        ? wrappedSolAccount.publicKey
        : tokensAccounts[data.tokenX.toString()]
        ? tokensAccounts[data.tokenX.toString()].address
        : null

    if (userTokenX === null) {
      userTokenX = yield* call(createAccount, data.tokenX)
    }

    let userTokenY =
      allTokens[data.tokenY.toString()].address.toString() === WRAPPED_SOL_ADDRESS
        ? wrappedSolAccount.publicKey
        : tokensAccounts[data.tokenY.toString()]
        ? tokensAccounts[data.tokenY.toString()].address
        : null

    if (userTokenY === null) {
      userTokenY = yield* call(createAccount, data.tokenY)
    }

    let initPositionTx: Transaction
    let poolSigners: Keypair[] = []

    const fee = localStorage.getItem('INVARIANT_MAINNET_PRIORITY_FEE')

    if (data.initPool) {
      const { transaction, signers } = yield* call(
        [marketProgram, marketProgram.initPoolAndPositionTx],
        {
          pair: new Pair(data.tokenX, data.tokenY, {
            fee: data.fee,
            tickSpacing: data.tickSpacing
          }),
          userTokenX,
          userTokenY,
          lowerTick: data.lowerTick,
          upperTick: data.upperTick,
          liquidityDelta: data.liquidityDelta,
          owner: wallet.publicKey,
          initTick: data.initTick,
          slippage: data.slippage,
          knownPrice: data.knownPrice
        }
      )

      if (fee) {
        initPositionTx = yield* call(
          [marketProgram, marketProgram.addPriorityFee],
          solToPriorityFee(+fee),
          transaction
        )
      } else {
        initPositionTx = transaction
      }

      poolSigners = signers
    } else {
      initPositionTx = yield* call([marketProgram, marketProgram.initPositionTx], {
        pair: new Pair(data.tokenX, data.tokenY, {
          fee: data.fee,
          tickSpacing: data.tickSpacing
        }),
        userTokenX,
        userTokenY,
        lowerTick: data.lowerTick,
        upperTick: data.upperTick,
        liquidityDelta: data.liquidityDelta,
        owner: wallet.publicKey,
        slippage: data.slippage,
        knownPrice: data.knownPrice
      })
    }

    let initialTx = new Transaction().add(createIx).add(transferIx).add(initIx)

    if (fee) {
      initialTx = yield* call(
        [marketProgram, marketProgram.addPriorityFee],
        solToPriorityFee(+fee),
        initialTx
      )
    }

    const initialBlockhash = yield* call([connection, connection.getRecentBlockhash])
    initialTx.recentBlockhash = initialBlockhash.blockhash
    initialTx.feePayer = wallet.publicKey

    const initPositionBlockhash = yield* call([connection, connection.getRecentBlockhash])
    initPositionTx.recentBlockhash = initPositionBlockhash.blockhash
    initPositionTx.feePayer = wallet.publicKey

    let unwrapTx = new Transaction().add(unwrapIx)

    if (fee) {
      unwrapTx = yield* call(
        [marketProgram, marketProgram.addPriorityFee],
        solToPriorityFee(+fee),
        unwrapTx
      )
    }

    const unwrapBlockhash = yield* call([connection, connection.getRecentBlockhash])
    unwrapTx.recentBlockhash = unwrapBlockhash.blockhash
    unwrapTx.feePayer = wallet.publicKey

    const [initialSignedTx, initPositionSignedTx, unwrapSignedTx] = yield* call(
      [wallet, wallet.signAllTransactions],
      [initialTx, initPositionTx, unwrapTx]
    )

    initialSignedTx.partialSign(wrappedSolAccount)

    if (poolSigners.length) {
      initPositionSignedTx.partialSign(...poolSigners)
    }

    const initialTxid = yield* call(
      sendAndConfirmRawTransaction,
      connection,
      initialSignedTx.serialize(),
      {
        skipPreflight: false
      }
    )

    if (!initialTxid.length) {
      yield put(actions.setInitPositionSuccess(false))

      return yield put(
        snackbarsActions.add({
          message: 'SOL wrapping failed. Please try again.',
          variant: 'error',
          persist: false,
          txid: initialTxid
        })
      )
    }

    const initPositionTxid = yield* call(
      sendAndConfirmRawTransaction,
      connection,
      initPositionSignedTx.serialize(),
      {
        skipPreflight: false
      }
    )

    if (!initPositionTxid.length) {
      yield put(actions.setInitPositionSuccess(false))

      return yield put(
        snackbarsActions.add({
          message:
            'Position adding failed. Please unwrap wrapped SOL in your wallet and try again.',
          variant: 'error',
          persist: false,
          txid: initPositionTxid
        })
      )
    } else {
      yield put(
        snackbarsActions.add({
          message: 'Position added successfully.',
          variant: 'success',
          persist: false,
          txid: initPositionTxid
        })
      )

      yield put(actions.getPositionsList())
    }

    const unwrapTxid = yield* call(
      sendAndConfirmRawTransaction,
      connection,
      unwrapSignedTx.serialize(),
      {
        skipPreflight: false
      }
    )

    yield put(actions.setInitPositionSuccess(true))

    if (!unwrapTxid.length) {
      yield put(
        snackbarsActions.add({
          message: 'Wrapped SOL unwrap failed. Try to unwrap it in your wallet.',
          variant: 'warning',
          persist: false,
          txid: unwrapTxid
        })
      )
    } else {
      yield put(
        snackbarsActions.add({
          message: 'SOL unwrapped successfully.',
          variant: 'success',
          persist: false,
          txid: unwrapTxid
        })
      )
    }
  } catch (error) {
    console.log(error)

    yield put(actions.setInitPositionSuccess(false))

    yield put(
      snackbarsActions.add({
        message: 'Failed to send. Please try again.',
        variant: 'error',
        persist: false
      })
    )
  }
}

export function* handleInitPosition(action: PayloadAction<InitPositionData>): Generator {
  try {
    const allTokens = yield* select(tokens)

    if (
      (allTokens[action.payload.tokenX.toString()].address.toString() === WRAPPED_SOL_ADDRESS &&
        action.payload.xAmount !== 0) ||
      (allTokens[action.payload.tokenY.toString()].address.toString() === WRAPPED_SOL_ADDRESS &&
        action.payload.yAmount !== 0)
    ) {
      return yield* call(handleInitPositionWithSOL, action)
    }

    const connection = yield* call(getConnection)
    const wallet = yield* call(getWallet)
    const networkType = yield* select(network)
    const rpc = yield* select(rpcAddress)
    const marketProgram = yield* call(getMarketProgram, networkType, rpc)

    const tokensAccounts = yield* select(accounts)

    let userTokenX = tokensAccounts[action.payload.tokenX.toString()]
      ? tokensAccounts[action.payload.tokenX.toString()].address
      : null

    if (userTokenX === null) {
      userTokenX = yield* call(createAccount, action.payload.tokenX)
    }

    let userTokenY = tokensAccounts[action.payload.tokenY.toString()]
      ? tokensAccounts[action.payload.tokenY.toString()].address
      : null

    if (userTokenY === null) {
      userTokenY = yield* call(createAccount, action.payload.tokenY)
    }

    let tx: Transaction
    let poolSigners: Keypair[] = []

    const fee = localStorage.getItem('INVARIANT_MAINNET_PRIORITY_FEE')

    if (action.payload.initPool) {
      const { transaction, signers } = yield* call(
        [marketProgram, marketProgram.initPoolAndPositionTx],
        {
          pair: new Pair(action.payload.tokenX, action.payload.tokenY, {
            fee: action.payload.fee,
            tickSpacing: action.payload.tickSpacing
          }),
          userTokenX,
          userTokenY,
          lowerTick: action.payload.lowerTick,
          upperTick: action.payload.upperTick,
          liquidityDelta: action.payload.liquidityDelta,
          owner: wallet.publicKey,
          initTick: action.payload.initTick,
          slippage: action.payload.slippage,
          knownPrice: action.payload.knownPrice
        }
      )

      tx = transaction
      poolSigners = signers
    } else {
      tx = yield* call([marketProgram, marketProgram.initPositionTx], {
        pair: new Pair(action.payload.tokenX, action.payload.tokenY, {
          fee: action.payload.fee,
          tickSpacing: action.payload.tickSpacing
        }),
        userTokenX,
        userTokenY,
        lowerTick: action.payload.lowerTick,
        upperTick: action.payload.upperTick,
        liquidityDelta: action.payload.liquidityDelta,
        owner: wallet.publicKey,
        slippage: action.payload.slippage,
        knownPrice: action.payload.knownPrice
      })
    }

    if (fee) {
      tx = yield* call([marketProgram, marketProgram.addPriorityFee], solToPriorityFee(+fee), tx)
    }

    const blockhash = yield* call([connection, connection.getRecentBlockhash])
    tx.recentBlockhash = blockhash.blockhash
    tx.feePayer = wallet.publicKey
    const signedTx = yield* call([wallet, wallet.signTransaction], tx)

    if (poolSigners.length) {
      signedTx.partialSign(...poolSigners)
    }
    const txid = yield* call(sendAndConfirmRawTransaction, connection, signedTx.serialize(), {
      skipPreflight: false
    })

    yield put(actions.setInitPositionSuccess(!!txid.length))

    if (!txid.length) {
      yield put(
        snackbarsActions.add({
          message: 'Position adding failed. Please try again.',
          variant: 'error',
          persist: false,
          txid
        })
      )
    } else {
      yield put(
        snackbarsActions.add({
          message: 'Position added successfully.',
          variant: 'success',
          persist: false,
          txid
        })
      )

      yield put(actions.getPositionsList())
    }
  } catch (error) {
    console.log(error)

    yield put(actions.setInitPositionSuccess(false))

    yield put(
      snackbarsActions.add({
        message: 'Failed to send. Please try again.',
        variant: 'error',
        persist: false
      })
    )
  }
}

export function* handleGetCurrentPlotTicks(action: PayloadAction<GetCurrentTicksData>): Generator {
  const allPools = yield* select(poolsArraySortedByFees)
  const allTokens = yield* select(tokens)

  const poolIndex = action.payload.poolIndex

  const xDecimal = allTokens[allPools[poolIndex].tokenX.toString()].decimals
  const yDecimal = allTokens[allPools[poolIndex].tokenY.toString()].decimals

  try {
    const networkType = yield* select(network)
    const rpc = yield* select(rpcAddress)
    const marketProgram = yield* call(getMarketProgram, networkType, rpc)

    const rawTicks = yield* call(
      [marketProgram, marketProgram.getAllTicks],
      new Pair(allPools[poolIndex].tokenX, allPools[poolIndex].tokenY, {
        fee: allPools[poolIndex].fee.v,
        tickSpacing: allPools[poolIndex].tickSpacing
      })
    )

    const ticksData = createLiquidityPlot(
      rawTicks,
      allPools[poolIndex],
      action.payload.isXtoY,
      xDecimal,
      yDecimal
    )

    yield put(actions.setPlotTicks(ticksData))
  } catch (error) {
    console.log(error)
    const data = createPlaceholderLiquidityPlot(
      action.payload.isXtoY,
      10,
      allPools[poolIndex].tickSpacing,
      xDecimal,
      yDecimal
    )
    yield put(actions.setErrorPlotTicks(data))
  }
}

export function* handleGetPositionsList() {
  try {
    const networkType = yield* select(network)
    const rpc = yield* select(rpcAddress)
    const marketProgram = yield* call(getMarketProgram, networkType, rpc)
    const wallet = yield* call(getWallet)

    const { head } = yield* call([marketProgram, marketProgram.getPositionList], wallet.publicKey)

    const list = yield* call(
      [marketProgram, marketProgram.getPositionsFromRange],
      wallet.publicKey,
      0,
      head - 1
    )

    const addresses = yield* call(
      getPositionsAddressesFromRange,
      marketProgram,
      wallet.publicKey,
      0,
      head - 1
    )

    const positions = list.map((position, index) => ({
      ...position,
      address: addresses[index]
    }))

    const pools = new Set(list.map(pos => pos.pool.toString()))

    yield* put(
      poolsActions.getPoolsDataForList({
        addresses: Array.from(pools),
        listType: ListType.POSITIONS
      })
    )

    const pattern: GuardPredicate<PayloadAction<ListPoolsResponse>> = (
      action
    ): action is PayloadAction<ListPoolsResponse> => {
      return (
        typeof action?.payload?.listType !== 'undefined' &&
        action.payload.listType === ListType.POSITIONS
      )
    }

    yield* take(pattern)

    yield* put(actions.setPositionsList(positions))
  } catch (_error) {
    yield* put(actions.setPositionsList([]))
  }
}

export function* handleClaimFeeWithSOL(positionIndex: number) {
  try {
    const connection = yield* call(getConnection)
    const networkType = yield* select(network)
    const rpc = yield* select(rpcAddress)
    const marketProgram = yield* call(getMarketProgram, networkType, rpc)
    const wallet = yield* call(getWallet)

    const allPositionsData = yield* select(positionsWithPoolsData)
    const tokensAccounts = yield* select(accounts)
    const allTokens = yield* select(tokens)

    const wrappedSolAccount = Keypair.generate()

    const createIx = SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: wrappedSolAccount.publicKey,
      lamports: yield* call(Token.getMinBalanceRentForExemptAccount, connection),
      space: 165,
      programId: TOKEN_PROGRAM_ID
    })

    const initIx = Token.createInitAccountInstruction(
      TOKEN_PROGRAM_ID,
      NATIVE_MINT,
      wrappedSolAccount.publicKey,
      wallet.publicKey
    )

    const unwrapIx = Token.createCloseAccountInstruction(
      TOKEN_PROGRAM_ID,
      wrappedSolAccount.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      []
    )

    const positionForIndex = allPositionsData[positionIndex].poolData

    let userTokenX =
      allTokens[positionForIndex.tokenX.toString()].address.toString() === WRAPPED_SOL_ADDRESS
        ? wrappedSolAccount.publicKey
        : tokensAccounts[positionForIndex.tokenX.toString()]
        ? tokensAccounts[positionForIndex.tokenX.toString()].address
        : null

    if (userTokenX === null) {
      userTokenX = yield* call(createAccount, positionForIndex.tokenX)
    }

    let userTokenY =
      allTokens[positionForIndex.tokenY.toString()].address.toString() === WRAPPED_SOL_ADDRESS
        ? wrappedSolAccount.publicKey
        : tokensAccounts[positionForIndex.tokenY.toString()]
        ? tokensAccounts[positionForIndex.tokenY.toString()].address
        : null

    if (userTokenY === null) {
      userTokenY = yield* call(createAccount, positionForIndex.tokenY)
    }

    const ix = yield* call([marketProgram, marketProgram.claimFeeInstruction], {
      pair: new Pair(positionForIndex.tokenX, positionForIndex.tokenY, {
        fee: positionForIndex.fee.v,
        tickSpacing: positionForIndex.tickSpacing
      }),
      userTokenX,
      userTokenY,
      owner: wallet.publicKey,
      index: positionIndex
    })

    let tx = new Transaction().add(createIx).add(initIx).add(ix).add(unwrapIx)

    const fee = localStorage.getItem('INVARIANT_MAINNET_PRIORITY_FEE')

    if (fee) {
      tx = yield* call([marketProgram, marketProgram.addPriorityFee], solToPriorityFee(+fee), tx)
    }

    const blockhash = yield* call([connection, connection.getRecentBlockhash])
    tx.recentBlockhash = blockhash.blockhash
    tx.feePayer = wallet.publicKey
    const signedTx = yield* call([wallet, wallet.signTransaction], tx)
    signedTx.partialSign(wrappedSolAccount)

    const txid = yield* call(sendAndConfirmRawTransaction, connection, signedTx.serialize(), {
      skipPreflight: false
    })

    if (!txid.length) {
      yield put(
        snackbarsActions.add({
          message: 'Failed to claim fee. Please try again.',
          variant: 'error',
          persist: false,
          txid
        })
      )
    } else {
      yield put(
        snackbarsActions.add({
          message: 'Fee claimed successfully.',
          variant: 'success',
          persist: false,
          txid
        })
      )
    }

    yield put(actions.getSinglePosition(positionIndex))
  } catch (error) {
    console.log(error)
    yield put(
      snackbarsActions.add({
        message: 'Failed to claim fee. Please try again.',
        variant: 'error',
        persist: false
      })
    )
  }
}

export function* handleClaimFee(action: PayloadAction<number>) {
  try {
    const allTokens = yield* select(tokens)
    const allPositionsData = yield* select(positionsWithPoolsData)
    const positionForIndex = allPositionsData[action.payload].poolData

    if (
      allTokens[positionForIndex.tokenX.toString()].address.toString() === WRAPPED_SOL_ADDRESS ||
      allTokens[positionForIndex.tokenY.toString()].address.toString() === WRAPPED_SOL_ADDRESS
    ) {
      return yield* call(handleClaimFeeWithSOL, action.payload)
    }

    const connection = yield* call(getConnection)
    const networkType = yield* select(network)
    const rpc = yield* select(rpcAddress)
    const marketProgram = yield* call(getMarketProgram, networkType, rpc)
    const wallet = yield* call(getWallet)

    const tokensAccounts = yield* select(accounts)

    let userTokenX = tokensAccounts[positionForIndex.tokenX.toString()]
      ? tokensAccounts[positionForIndex.tokenX.toString()].address
      : null

    if (userTokenX === null) {
      userTokenX = yield* call(createAccount, positionForIndex.tokenX)
    }

    let userTokenY = tokensAccounts[positionForIndex.tokenY.toString()]
      ? tokensAccounts[positionForIndex.tokenY.toString()].address
      : null

    if (userTokenY === null) {
      userTokenY = yield* call(createAccount, positionForIndex.tokenY)
    }

    const ix = yield* call([marketProgram, marketProgram.claimFeeInstruction], {
      pair: new Pair(positionForIndex.tokenX, positionForIndex.tokenY, {
        fee: positionForIndex.fee.v,
        tickSpacing: positionForIndex.tickSpacing
      }),
      userTokenX,
      userTokenY,
      owner: wallet.publicKey,
      index: action.payload
    })

    let tx = new Transaction().add(ix)

    const fee = localStorage.getItem('INVARIANT_MAINNET_PRIORITY_FEE')

    if (fee) {
      tx = yield* call([marketProgram, marketProgram.addPriorityFee], solToPriorityFee(+fee), tx)
    }

    const blockhash = yield* call([connection, connection.getRecentBlockhash])
    tx.recentBlockhash = blockhash.blockhash
    tx.feePayer = wallet.publicKey
    const signedTx = yield* call([wallet, wallet.signTransaction], tx)

    const txid = yield* call(sendAndConfirmRawTransaction, connection, signedTx.serialize(), {
      skipPreflight: false
    })

    if (!txid.length) {
      yield put(
        snackbarsActions.add({
          message: 'Failed to claim fee. Please try again.',
          variant: 'error',
          persist: false,
          txid
        })
      )
    } else {
      yield put(
        snackbarsActions.add({
          message: 'Fee claimed successfully.',
          variant: 'success',
          persist: false,
          txid
        })
      )
    }

    yield put(actions.getSinglePosition(action.payload))
  } catch (error) {
    console.log(error)
    yield put(
      snackbarsActions.add({
        message: 'Failed to claim fee. Please try again.',
        variant: 'error',
        persist: false
      })
    )
  }
}

export function* handleClosePositionWithSOL(data: ClosePositionData) {
  try {
    const connection = yield* call(getConnection)
    const networkType = yield* select(network)
    const rpc = yield* select(rpcAddress)
    const marketProgram = yield* call(getMarketProgram, networkType, rpc)
    const wallet = yield* call(getWallet)

    const allPositionsData = yield* select(positionsWithPoolsData)
    const tokensAccounts = yield* select(accounts)
    const allTokens = yield* select(tokens)

    const wrappedSolAccount = Keypair.generate()

    const createIx = SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: wrappedSolAccount.publicKey,
      lamports: yield* call(Token.getMinBalanceRentForExemptAccount, connection),
      space: 165,
      programId: TOKEN_PROGRAM_ID
    })

    const initIx = Token.createInitAccountInstruction(
      TOKEN_PROGRAM_ID,
      NATIVE_MINT,
      wrappedSolAccount.publicKey,
      wallet.publicKey
    )

    const unwrapIx = Token.createCloseAccountInstruction(
      TOKEN_PROGRAM_ID,
      wrappedSolAccount.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      []
    )

    const positionForIndex = allPositionsData[data.positionIndex].poolData

    let userTokenX =
      allTokens[positionForIndex.tokenX.toString()].address.toString() === WRAPPED_SOL_ADDRESS
        ? wrappedSolAccount.publicKey
        : tokensAccounts[positionForIndex.tokenX.toString()]
        ? tokensAccounts[positionForIndex.tokenX.toString()].address
        : null

    if (userTokenX === null) {
      userTokenX = yield* call(createAccount, positionForIndex.tokenX)
    }

    let userTokenY =
      allTokens[positionForIndex.tokenY.toString()].address.toString() === WRAPPED_SOL_ADDRESS
        ? wrappedSolAccount.publicKey
        : tokensAccounts[positionForIndex.tokenY.toString()]
        ? tokensAccounts[positionForIndex.tokenY.toString()].address
        : null

    if (userTokenY === null) {
      userTokenY = yield* call(createAccount, positionForIndex.tokenY)
    }

    const positionStakes = yield* select(
      stakesForPosition(allPositionsData[data.positionIndex].address)
    )
    const stakerProgram = yield* call(getStakerProgram, networkType, rpc)
    for (const stake of positionStakes) {
      yield* call(unsub, stakerProgram, stake.address)
    }

    const ix = yield* call([marketProgram, marketProgram.removePositionInstruction], {
      pair: new Pair(positionForIndex.tokenX, positionForIndex.tokenY, {
        fee: positionForIndex.fee.v,
        tickSpacing: positionForIndex.tickSpacing
      }),
      owner: wallet.publicKey,
      index: data.positionIndex,
      userTokenX,
      userTokenY
    })

    let tx: Transaction

    if (data.claimFarmRewards) {
      const claimTx = yield* call(createClaimAllPositionRewardsTx, data.positionIndex)

      tx = claimTx.add(createIx).add(initIx).add(ix).add(unwrapIx)
    } else {
      tx = new Transaction().add(createIx).add(initIx).add(ix).add(unwrapIx)
    }

    const fee = localStorage.getItem('INVARIANT_MAINNET_PRIORITY_FEE')

    if (fee) {
      tx = yield* call([marketProgram, marketProgram.addPriorityFee], solToPriorityFee(+fee), tx)
    }

    const blockhash = yield* call([connection, connection.getRecentBlockhash])
    tx.recentBlockhash = blockhash.blockhash
    tx.feePayer = wallet.publicKey
    const signedTx = yield* call([wallet, wallet.signTransaction], tx)
    signedTx.partialSign(wrappedSolAccount)

    const txid = yield* call(sendAndConfirmRawTransaction, connection, signedTx.serialize(), {
      skipPreflight: false
    })

    yield* call(sleep, 3000)

    if (!txid.length) {
      yield put(
        snackbarsActions.add({
          message: 'Failed to close position. Please try again.',
          variant: 'error',
          persist: false,
          txid
        })
      )
    } else {
      yield put(
        snackbarsActions.add({
          message: 'Position closed successfully.',
          variant: 'success',
          persist: false,
          txid
        })
      )
    }

    yield put(actions.getPositionsList())
    yield* put(farmsActions.getUserStakes())

    data.onSuccess()
  } catch (error) {
    console.log(error)
    yield put(
      snackbarsActions.add({
        message: 'Failed to close position. Please try again.',
        variant: 'error',
        persist: false
      })
    )
  }
}

const unsub = async (stakerProgram: Staker, key: PublicKey) => {
  try {
    await stakerProgram.program.account.userStake.unsubscribe(key)
  } catch (error) {
    console.log(error)
  }
}

export function* handleClosePosition(action: PayloadAction<ClosePositionData>) {
  try {
    const allTokens = yield* select(tokens)
    const allPositionsData = yield* select(positionsWithPoolsData)
    const positionForIndex = allPositionsData[action.payload.positionIndex].poolData

    if (
      allTokens[positionForIndex.tokenX.toString()].address.toString() === WRAPPED_SOL_ADDRESS ||
      allTokens[positionForIndex.tokenY.toString()].address.toString() === WRAPPED_SOL_ADDRESS
    ) {
      return yield* call(handleClosePositionWithSOL, action.payload)
    }

    const connection = yield* call(getConnection)
    const networkType = yield* select(network)
    const rpc = yield* select(rpcAddress)
    const marketProgram = yield* call(getMarketProgram, networkType, rpc)
    const wallet = yield* call(getWallet)

    const tokensAccounts = yield* select(accounts)

    let userTokenX = tokensAccounts[positionForIndex.tokenX.toString()]
      ? tokensAccounts[positionForIndex.tokenX.toString()].address
      : null

    if (userTokenX === null) {
      userTokenX = yield* call(createAccount, positionForIndex.tokenX)
    }

    let userTokenY = tokensAccounts[positionForIndex.tokenY.toString()]
      ? tokensAccounts[positionForIndex.tokenY.toString()].address
      : null

    if (userTokenY === null) {
      userTokenY = yield* call(createAccount, positionForIndex.tokenY)
    }

    const positionStakes = yield* select(
      stakesForPosition(allPositionsData[action.payload.positionIndex].address)
    )
    const stakerProgram = yield* call(getStakerProgram, networkType, rpc)

    for (const stake of positionStakes) {
      yield* call(unsub, stakerProgram, stake.address)
    }

    const ix = yield* call([marketProgram, marketProgram.removePositionInstruction], {
      pair: new Pair(positionForIndex.tokenX, positionForIndex.tokenY, {
        fee: positionForIndex.fee.v,
        tickSpacing: positionForIndex.tickSpacing
      }),
      owner: wallet.publicKey,
      index: action.payload.positionIndex,
      userTokenX,
      userTokenY
    })

    let tx: Transaction

    if (action.payload.claimFarmRewards) {
      const claimTx = yield* call(createClaimAllPositionRewardsTx, action.payload.positionIndex)

      tx = claimTx.add(ix)
    } else {
      tx = new Transaction().add(ix)
    }

    const fee = localStorage.getItem('INVARIANT_MAINNET_PRIORITY_FEE')

    if (fee) {
      tx = yield* call([marketProgram, marketProgram.addPriorityFee], solToPriorityFee(+fee), tx)
    }

    const blockhash = yield* call([connection, connection.getRecentBlockhash])
    tx.recentBlockhash = blockhash.blockhash
    tx.feePayer = wallet.publicKey
    const signedTx = yield* call([wallet, wallet.signTransaction], tx)

    const txid = yield* call(sendAndConfirmRawTransaction, connection, signedTx.serialize(), {
      skipPreflight: false
    })

    yield* call(sleep, 3000)

    if (!txid.length) {
      yield put(
        snackbarsActions.add({
          message: 'Failed to close position. Please try again.',
          variant: 'error',
          persist: false,
          txid
        })
      )
    } else {
      yield put(
        snackbarsActions.add({
          message: 'Position closed successfully.',
          variant: 'success',
          persist: false,
          txid
        })
      )
    }

    yield* put(actions.getPositionsList())
    yield* put(farmsActions.getUserStakes())

    action.payload.onSuccess()
  } catch (error) {
    console.log(error)
    yield put(
      snackbarsActions.add({
        message: 'Failed to close position. Please try again.',
        variant: 'error',
        persist: false
      })
    )
  }
}

export function* handleGetSinglePosition(action: PayloadAction<number>) {
  try {
    const networkType = yield* select(network)
    const rpc = yield* select(rpcAddress)
    const marketProgram = yield* call(getMarketProgram, networkType, rpc)
    const wallet = yield* call(getWallet)

    const position = yield* call(
      [marketProgram, marketProgram.getPosition],
      wallet.publicKey,
      action.payload
    )

    yield put(
      actions.setSinglePosition({
        index: action.payload,
        position
      })
    )

    yield put(actions.getCurrentPositionRangeTicks(position.id.toString()))
  } catch (error) {
    console.log(error)
  }
}

export function* handleGetCurrentPositionRangeTicks(action: PayloadAction<string>) {
  try {
    const networkType = yield* select(network)
    const rpc = yield* select(rpcAddress)
    const marketProgram = yield* call(getMarketProgram, networkType, rpc)

    const positionData = yield* select(singlePositionData(action.payload))

    if (typeof positionData === 'undefined') {
      return
    }

    const pair = new Pair(positionData.poolData.tokenX, positionData.poolData.tokenY, {
      fee: positionData.poolData.fee.v,
      tickSpacing: positionData.poolData.tickSpacing
    })

    const lowerTick = yield* call(
      [marketProgram, marketProgram.getTick],
      pair,
      positionData.lowerTickIndex
    )

    const upperTick = yield* call(
      [marketProgram, marketProgram.getTick],
      pair,
      positionData.upperTickIndex
    )

    yield put(
      actions.setCurrentPositionRangeTicks({
        lowerTick,
        upperTick
      })
    )
  } catch (error) {
    console.log(error)
  }
}

export function* initPositionHandler(): Generator {
  yield* takeEvery(actions.initPosition, handleInitPosition)
}
export function* getCurrentPlotTicksHandler(): Generator {
  yield* takeLatest(actions.getCurrentPlotTicks, handleGetCurrentPlotTicks)
}
export function* getPositionsListHandler(): Generator {
  yield* takeLatest(actions.getPositionsList, handleGetPositionsList)
}
export function* claimFeeHandler(): Generator {
  yield* takeEvery(actions.claimFee, handleClaimFee)
}
export function* closePositionHandler(): Generator {
  yield* takeEvery(actions.closePosition, handleClosePosition)
}
export function* getSinglePositionHandler(): Generator {
  yield* takeEvery(actions.getSinglePosition, handleGetSinglePosition)
}
export function* getCurrentPositionRangeTicksHandler(): Generator {
  yield* takeEvery(actions.getCurrentPositionRangeTicks, handleGetCurrentPositionRangeTicks)
}

export function* positionsSaga(): Generator {
  yield all(
    [
      initPositionHandler,
      getCurrentPlotTicksHandler,
      getPositionsListHandler,
      claimFeeHandler,
      closePositionHandler,
      getSinglePositionHandler,
      getCurrentPositionRangeTicksHandler
    ].map(spawn)
  )
}

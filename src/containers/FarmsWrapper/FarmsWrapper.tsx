import React from 'react'
import FarmTile from '@components/FarmsList/FarmTile/FarmTile'
import FarmList from '@components/FarmsList/FarmList'
import { NetworkType, tokens } from '@consts/static'
import { Grid } from '@material-ui/core'


export const FarmsWrapper:React.FC = () => {
  return (
    <Grid
        style={{
          justifyContent: 'center',
          display: 'flex',
          paddingInline: 20
        }}>
        <FarmList
          noConnectedBlockerProps={{
            onConnect: () => {},
            onDisconnect: () => {}
          }}
          title={'Active farms'}
          data={[
            {
              isActive: true,
              apyPercent: 1,
              totalStaked: 10000,
              liquidity: 100,
              farmId: 'qwerty',
              tokenX: tokens[NetworkType.DEVNET][0],
              tokenY: tokens[NetworkType.DEVNET][1]
            },
            {
              isActive: true,
              apyPercent: 1,
              totalStaked: 10000,
              liquidity: 200,
              farmId: 'qwerty',
              tokenX: tokens[NetworkType.DEVNET][2],
              tokenY: tokens[NetworkType.DEVNET][0]
            },
            {
              isActive: true,
              apyPercent: 1,
              totalStaked: 10000,
              liquidity: 300,
              farmId: 'qwerty',
              tokenX: tokens[NetworkType.DEVNET][1],
              tokenY: tokens[NetworkType.DEVNET][2]
            }
          ]}
        />
      </Grid>
  )
}
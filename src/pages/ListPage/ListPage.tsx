import React from 'react'
import { Grid } from '@material-ui/core'
import useStyles from './styles'
import WrappedPositionsList from '@containers/newDesign/WrappedPositionsList/WrappedPositionsList'

export const ListPage: React.FC = () => {
  const classes = useStyles()
  return (
    <Grid container className={classes.container}>
      <WrappedPositionsList />
    </Grid>
  )
}

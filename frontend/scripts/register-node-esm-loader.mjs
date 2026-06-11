import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./scripts/node-esm-loader.mjs', pathToFileURL('./'))

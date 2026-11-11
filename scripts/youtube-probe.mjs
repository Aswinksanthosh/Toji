#!/usr/bin/env node
// Shows what "play something on YouTube" would open for a search, without opening it.
// Run:  node scripts/youtube-probe.mjs lofi hip hop radio
import { youtubeTarget } from '../bridge/local.mjs'

const query = process.argv.slice(2).join(' ') || 'lofi hip hop radio'
const url = await youtubeTarget(query)
console.log(url.includes('/watch') ? `Would play: ${url}` : `Could not find a video, would open the results page: ${url}`)

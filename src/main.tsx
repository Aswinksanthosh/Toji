import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import { CALM } from './config'
import './index.css'
import App from './App.tsx'

// Deliberately no StrictMode: its double-invoked effects would open the
// microphone and arm the wake-word engine twice, and the second subscription
// steals the audio stream from the first.
createRoot(document.getElementById('root')!).render(
  // In calm mode framer-motion skips its movement too, not only the CSS ones.
  <MotionConfig reducedMotion={CALM ? 'always' : 'user'}>
    <App />
  </MotionConfig>,
)

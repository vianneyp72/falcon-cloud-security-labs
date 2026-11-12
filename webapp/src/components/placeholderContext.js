import { createContext } from 'react'

// Per-lab values for inline <PLACEHOLDER> fields in code blocks. Consumers
// (CodeBlock) subscribe here so every block sharing a token name stays in sync.
export const PlaceholderContext = createContext(null)

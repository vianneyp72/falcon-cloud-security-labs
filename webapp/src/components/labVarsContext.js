import { createContext } from 'react'

// Shared context for lab-variable values. Consumers (LabVariables, code-block
// wrapper) subscribe here so they re-render on `values` change WITHOUT causing
// the outer react-markdown tree to rebuild — which would otherwise remount the
// text input and yank focus mid-keystroke.
export const LabVarsContext = createContext(null)

export type ChatMark = {
  id: string
  kind: 'user' | 'assistant'
  key: string
  snippet: string
  preview?: string[]
  at: number
}
export type ChatHighlight = { key: string; snippet: string; text?: string; frags: string[] }
export type ChatPickItem = { id: string; kind: 'user' | 'assistant'; key: string; snippet: string; preview?: string[] }

declare module 'claude-code' {
  interface PluginState {
    'chat-marks': {
      marks: ChatMark[]
      highlights: Record<string, ChatHighlight>
      pick: { items: ChatPickItem[] } | null
      panel: {
        tab: 'marks' | 'keys'
        mode: 'jump' | 'delete'
        cursor: string | null
        origin: { id: string; block: 'start' | 'end' } | null
        confirmClear: boolean
      } | null
      keys: {
        armed?: string | null
        mods?: { ctrl?: boolean; alt?: boolean; shift?: boolean }
        letter?: string
        pending: { slot: string; chord: string } | null
        note: string | null
        tone: 'ok' | 'warn' | 'error' | null
      } | null
      color: string
      lang: string
    }
  }
}

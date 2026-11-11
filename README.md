# chat-marks

A highlighter and vim-style marks for the Claude Code terminal.

Long Claude Code sessions scroll away fast: the one paragraph you needed is forty screens up, between tool calls. chat-marks lets you highlight the words that matter in Claude's replies, mark messages, and jump between them with a key, without leaving the terminal.

![Highlights in a reply](docs/highlight.png)

## What it does

- **Auto marks.** When a turn ends, each of Claude's replies at least 12 rows tall gets a dim `◇`: the ones written for you to read, not the one-line progress notes between tool calls. A long reply whose top is less than half a screen under the last one is left out, since a jump to that one shows it already. A reply over two screens that turns to something different (another topic, a second concept, a separate option) is cut by Claude into parts, at most four, by calling the plugin's `section` tool where each new part begins; a part that needs what came before it to be understood is not cut off. Each part gets its own `◇` and a jump lands at its top, since Claude Code scrolls to a row's top and no further. They are worked out from the conversation each time, so there is nothing to delete: `/mark auto 20` asks for taller replies across the whole conversation at once, `/mark auto off` turns them off.
- **Highlight.** Select words in one of Claude's replies with the mouse, press your highlight key, then Enter: they get a background colour. The pane the key opens names the words on its Enter button, since Claude Code keeps telling a plugin about the last selection until your next prompt, even after you clicked it away; so a selection is never lit without that Enter, and one used once is not offered again. Or type them: `/mark hl <words>` highlights them in the latest reply holding them. Point at a highlighted block and a *Remove highlight* button shows above it; selecting part of it again, the key and Enter remove it too.
- **Highlight by keys.** Press the highlight key and type where the span starts, easymotion-s2 style: its first two letters, or, for a Chinese character, the first two letters of its [Boshiamy](https://github.com/vi000246/vim-easymotion-boshiamy) code. A character whose code is one letter alone (四 is `f`, 一 is `e`) is found by that letter and Enter. One place on screen matching is taken at once; more get hints to type. Hints then sit just past each place the span may end (a sentence's or a clause's punctuation, a line's end, a URL's or a path's end); type one, or `s` and the two letters it ends on. Every other key acts as it is pressed, no Enter; with text in the prompt the pane cannot take the keyboard, so press `ctrl+x Tab` (Claude Code's own key for focusing a plugin pane) to move there. The span is copied to the clipboard and you are asked whether to highlight it: `y` (or Enter) or `n`; with neither for five seconds the pane closes, the copy kept. Over a span already lit, `y` takes the highlight off.
- **Copy a command or an address by its number.** When the highlight-by-keys pane opens, before you type a letter, a number sits before each command meant for the prompt's `!` (a code span or a code block line that starts with `!`) and each web address shown in Claude's replies on screen. Press the number and that one is copied, and the pane closes with nothing asked: a command with its `!` and without the backticks, so it runs as soon as you paste it, an address without the punctuation closing the sentence round it. The same address twice gets one number, an address inside a command belongs to the command, and a link's address, which the reply does not show, gets none. Once you type a letter the numbers go, and a digit is the second of the two letters as before.
- **Mark.** Press your mark key and a letter appears over each long reply on screen (over every message when none of them is long). Press one to mark that message (`◆ mark`). A message already marked gets a red letter and *unmark?*: its letter takes the mark off. A click on `◆ mark` does as well. Marking an auto mark keeps it in the marks panel.
- **Jump.** Next and previous go through every auto mark, mark and highlighted block in conversation order, past the last back to the first. A mark lands at the top of its message, a highlight in the middle of the screen. For a few seconds after each jump a bar above the prompt shows where every stop lies in the whole conversation, the one you are on, and about the stretch on screen.
- **Undo.** Your undo key takes back the last change of the marks or highlights (marking, highlighting, deleting, clearing all); press it again to go further back. Jumps and settings are not changes, and a reload of the plugin forgets what came before it.
- **Marks panel**, first tab. The marks and highlights you made (not the auto marks) in one list, a letter each: press the letter to jump there. `j` / `k` move the cursor and show the conversation at that entry as you go; Enter or the letter jumps for good, your panel key again takes you back to where you opened the panel. `x` then a letter deletes one, `0` twice deletes them all; the mouse wheel and PageUp / PageDown scroll. No chat-marks pane closes on Escape (an Escape meant for a pane that lands on the prompt stops Claude's turn): each closes by the key that opened it, and Escape only hands the keys back to the prompt.
- **Settings**, second tab (`/mark keys` or `/mark settings` opens it directly). Its first row is the long-reply height: type a number of rows and Enter, or press *Off* or *Default*. The hotkeys follow: click a row (or press its letter) and an editor opens above the list: `ctrl` / `alt` / `shift` toggles and a one-letter field. Type the letter, Enter or *Save*, done. A combination Claude Code already uses is named first and taken over only on a second *Save*. Everything works from the keyboard too (Tab, Enter, typing).
- **Guide**, third tab (`/mark guide`): how each part works, with the hotkeys it answers to as you set them.
- Marks and highlights come back with `claude --resume`. The interface speaks English or Chinese (`/mark lang zh`).

![Letters over the messages on screen](docs/mark.png)

![The marks panel](docs/panel.png)

## Requirements

- A Claude Code build with mods (function hooks): 2.1.287 or later. Developed on 2.1.311.
- The fullscreen renderer: `/tui fullscreen`. The mouse selection, knowing which messages are on screen, and scrolling to a message exist only there.
- For the *Remove highlight* button, a terminal that reports mouse movement (most do).

## Install

At the prompt of a Claude Code session:

```
/plugin install chat-marks --marketplace vi000246/claude-chat-marks
```

Answer `y` to add the marketplace, then pick a scope. From a shell instead:

```
claude plugin install chat-marks --marketplace vi000246/claude-chat-marks
```

Then set your hotkeys, since none are bound until you do:

```
/mark keys
```

![The hotkeys panel](docs/keys.png)

Pick whatever suits you. The author uses `alt+m` mark, `alt+j` / `alt+k` next / previous, `alt+y` highlight, `alt+u` undo and `alt+o` marks panel.

## Commands

| Command | What it does |
|---|---|
| `/mark` | Open the panel on its marks tab |
| `/mark keys` | Open the panel on its hotkeys tab |
| `/mark next`, `/mark prev` | Jump to the next / previous mark |
| `/mark undo` | Undo the last change of the marks or highlights, as the undo key does |
| `/mark add` | Put the letters up, as the mark key does |
| `/mark hl` | Highlight the mouse selection, as the highlight key does |
| `/mark hl <words>` | Highlight those words in the latest reply holding them |
| `/mark auto <rows>`, `/mark auto off`, `/mark auto on` | How tall a reply is to be marked by itself (default 12 rows), for every session; `off` marks none |
| `/mark color #rrggbb` | The highlight background (default `#6b4f00`, a dark amber for dark terminals); `reset` for the default |
| `/mark lang en`, `/mark lang zh` | The interface language, for every session |
| `/mark-clear` | Remove every mark and highlight of this session (auto marks stay; `/mark auto off` turns them off) |

## How the hotkeys work

A plugin cannot register keyboard shortcuts of its own. chat-marks borrows six Claude Code keybinding actions and draws hidden buttons that answer them: five that only the `/diff` dialog handles (`diff:back`, `diff:nextFile`, `diff:previousFile`, `diff:nextSource`, `diff:previousSource`), and, for undo, the diff panel's *show/hide tests* (`app:toggleDiffNoiseFilter`), which no key answers by default. The hotkeys panel binds your keys to those actions in the `Global` context of `~/.claude/keybindings.json` (under `$CLAUDE_CONFIG_DIR` when that is set), so you can edit or remove them there by hand too. Two things follow:

- While the `/diff` dialog is open, those keys do the dialog's thing instead.
- Taking over one of Claude Code's own combinations (say `alt+o`, fast mode) writes `null` for it in its context, which turns the built-in shortcut off; the command for it (`/fast`) still works.

The keys inside the marks panel (`j`, `k`, `x` by default) are set in the same panel and kept by the plugin.

## What it reads and writes

- **Writes** `~/.claude/keybindings.json` (under `$CLAUDE_CONFIG_DIR` when that is set), and only when you save or clear a hotkey in the Settings tab: it adds or changes bindings in the `Global` context, and writes `null` for a Claude Code chord you chose to take over. It writes no other file.
- **Reads** that file, to show your hotkeys and name them in the panes.
- **Reads** the current session's transcript (`~/.claude/projects/<project>/<session id>.jsonl`), only to find the rows of long replies not drawn since a reload or a resume, so a jump can reach them. It keeps nothing from it but those row ids.
- **Keeps** marks, highlights, those row ids and its settings in the plugin's own store, for the newest 40 sessions.
- **Copies** to the clipboard only the span, the command or the address you pick when highlighting by keys.
- **Gives Claude** one tool, `section`, which does nothing but end one part of a long reply (its row is drawn as nothing; ctrl+o shows it), and one paragraph in the system prompt saying how tall two screens are, on the largest terminal window this machine has drawn the conversation in (kept in the plugin's store, so moving a session from a small window to a large one does not change it after the first time, and the prompt cache stays). Each cut costs one more model request, read mostly from the prompt cache. Both come only while auto marks are on; `/mark auto off` takes the paragraph out and tells a call to stop (the tool stays listed until the next session, as a tool cannot be taken back).
- Sends nothing over the network and runs no programs.

## Limits

- **A reply's height is reckoned from its text** at the terminal's width, so after a resize an auto mark or two may move. A reply not drawn since the plugin loaded or the session was resumed may not be reachable until you scroll past it.
- **A mark is a whole message, not a line.** Claude Code can scroll a message into view but not to a line inside it, so a jump to a mark lands at the top of that message. A highlighted block is drawn by the plugin and can be centred.
- Your own messages can be marked but not highlighted: the plugin cannot repaint part of the row Claude Code draws for them.
- A highlighted block is redrawn as plain text, keeping bold, italics and inline code colours. A highlight inside a table or a code block shows that block as its source text.
- The conversation order is worked out by matching message text. After `/compact`, marks on messages no longer in the conversation cannot be reached. Two identical short messages may be confused.
- Escape cannot be part of a hotkey: it leaves the capture box.

## Development

From the plugin folder:

```
node --test tests/marks-core.test.mjs tests/keys-core.test.mjs
claude plugin test .
```

## License

MIT

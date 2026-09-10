# opencode Context

A small local VS Code extension that makes opencode aware of the editor.

## Features

- **Right-click menu** (`editor/context`): add the selection, selection + code, current line, or the whole file to the opencode prompt.
- **Live selection tracking** (`onDidChangeTextEditorSelection`): the current `@file#Lx-y` is shown in the status bar and written to `~/.config/opencode/selection.json`.
- **Keybindings**: `Ctrl+Alt+K` adds the selection, `Ctrl+Alt+Shift+K` adds the selection with its code.
- **Bridge for the AI**: the `selection` opencode custom tool reads `selection.json`, so the agent can look at your live selection on demand.

## Commands

| Command | Default key | Description |
| --- | --- | --- |
| `opencode: Add Selection to opencode` | `Ctrl+Alt+K` | Append `@file#Lx-y` to the prompt |
| `opencode: Add Selection + Code to opencode` | `Ctrl+Alt+Shift+K` | Append the reference and the selected code |
| `opencode: Add File to opencode` | | Append `@file` |
| `opencode: Open opencode Terminal` | | Focus/create the opencode terminal |

## Settings

- `opencodeContext.autoShare` (default `false`): forward selection changes to the prompt automatically.
- `opencodeContext.autoShareMode`: `reference` or `referenceWithText`.
- `opencodeContext.debounceMs`: debounce for auto-share.
- `opencodeContext.port`: override the opencode server port (0 = auto-detect).
- `opencodeContext.writeBridge`: write the live selection for the `selection` tool.

## Notes

The opencode server port is discovered from the opencode terminal's `_EXTENSION_OPENCODE_PORT`
environment variable, so this works together with the official `sst-dev.opencode` extension.

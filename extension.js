const vscode = require("vscode")
const http = require("http")
const fs = require("fs")
const os = require("os")
const path = require("path")

const TERMINAL_NAME = "opencode"
const BRIDGE_DIR = path.join(os.homedir(), ".config", "opencode")
const BRIDGE_FILE = path.join(BRIDGE_DIR, "selection.json")

let statusBar
let selectionTimer
let lastAutoRef = ""

function activate(context) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.command = "opencodeContext.addSelection"
  context.subscriptions.push(statusBar)
  updateStatusBar()
  if (vscode.window.activeTextEditor) writeBridge()

  context.subscriptions.push(
    vscode.commands.registerCommand("opencodeContext.addSelection", () =>
      addToPrompt({ mode: "selection" }),
    ),
    vscode.commands.registerCommand("opencodeContext.addSelectionWithText", () =>
      addToPrompt({ mode: "selectionText" }),
    ),
    vscode.commands.registerCommand("opencodeContext.addFile", () =>
      addToPrompt({ mode: "file" }),
    ),
    vscode.commands.registerCommand("opencodeContext.openTerminal", () => openTerminal()),
    vscode.window.onDidChangeTextEditorSelection(onSelectionChange),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateStatusBar(editor)
      writeBridge(editor)
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        updateStatusBar()
        writeBridge()
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("opencodeContext")) updateStatusBar()
    }),
  )

  const refresh = setInterval(() => {
    if (vscode.window.state.focused && vscode.window.activeTextEditor) {
      writeBridge()
    }
  }, 2000)
  context.subscriptions.push({ dispose: () => clearInterval(refresh) })
}

function deactivate() {
  if (selectionTimer) clearTimeout(selectionTimer)
}

function getInfo(editor) {
  editor = editor || vscode.window.activeTextEditor
  if (!editor) return undefined

  const doc = editor.document
  const rel = vscode.workspace.asRelativePath(doc.uri, false)
  const sel = editor.selection
  const hasSel = !!sel && !sel.isEmpty

  let lines
  let ref = "@" + rel
  if (hasSel) {
    const s = sel.start.line + 1
    const e = sel.end.line + 1
    lines = s === e ? "L" + s : "L" + s + "-" + e
    ref += "#" + lines
  }

  return {
    editor,
    doc,
    rel,
    ref,
    lines,
    hasSel,
    text: hasSel ? doc.getText(sel) : "",
  }
}

function buildPayload(info, mode) {
  if (!info) return undefined
  if (mode === "file") return "@" + info.rel
  if (mode === "line") return "@" + info.rel + "#L" + (info.editor.selection.active.line + 1)
  if (!info.hasSel) return info.ref
  if (mode === "selectionText") {
    const lang = info.doc.languageId || ""
    return info.ref + "\n```" + lang + "\n" + info.text + "\n```"
  }
  return info.ref
}

async function addToPrompt(opts) {
  const info = getInfo()
  if (!info) {
    vscode.window.showWarningMessage("opencode: 没有活动的编辑器")
    return
  }
  const payload = buildPayload(info, opts.mode)
  if (!payload) return
  const ok = await sendToOpencode(payload)
  if (!ok) {
    vscode.window.showWarningMessage(
      "opencode: 未找到运行中的 opencode（请先用 Ctrl+Esc 或命令面板打开 opencode 终端）",
    )
  }
}

async function sendToOpencode(text) {
  const port = resolvePort()
  if (port) {
    const ok = await postJson(port, "/tui/append-prompt", { text })
    if (ok) {
      focusOpencodeTerminal()
      return true
    }
  }
  const term = vscode.window.activeTerminal
  if (term) {
    term.sendText(text, false)
    term.show()
    return true
  }
  return false
}

function resolvePort() {
  const override = vscode.workspace.getConfiguration("opencodeContext").get("port", 0)
  if (override && override > 0) return override
  for (const term of vscode.window.terminals) {
    const env = term.creationOptions && term.creationOptions.env
    const p = env && env["_EXTENSION_OPENCODE_PORT"]
    if (p) {
      const n = parseInt(p, 10)
      if (n > 0) return n
    }
  }
  return undefined
}

function postJson(port, pathname, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body)
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 1500,
      },
      (res) => {
        res.resume()
        resolve(res.statusCode >= 200 && res.statusCode < 300)
      },
    )
    req.on("error", () => resolve(false))
    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })
    req.write(data)
    req.end()
  })
}

function onSelectionChange(e) {
  updateStatusBar(e.textEditor)
  writeBridge(e.textEditor)

  const cfg = vscode.workspace.getConfiguration("opencodeContext")
  if (!cfg.get("autoShare", false)) return
  if (selectionTimer) clearTimeout(selectionTimer)
  const delay = cfg.get("debounceMs", 700)
  selectionTimer = setTimeout(() => autoShare(e.textEditor), delay)
}

async function autoShare(editor) {
  const info = getInfo(editor)
  if (!info || !info.hasSel) return
  if (info.ref === lastAutoRef) return
  lastAutoRef = info.ref
  const mode =
    vscode.workspace.getConfiguration("opencodeContext").get("autoShareMode", "reference") ===
    "referenceWithText"
      ? "selectionText"
      : "selection"
  const payload = buildPayload(info, mode)
  if (payload) await sendToOpencode(payload)
}

function updateStatusBar(editor) {
  if (!statusBar) return
  const info = getInfo(editor)
  if (info) {
    statusBar.text = "$(comment-discussion) " + (info.hasSel ? info.ref : "@" + info.rel)
    statusBar.tooltip = info.hasSel
      ? "opencode: 添加选区 " + info.ref
      : "opencode: 添加文件 @" + info.rel
    statusBar.command = info.hasSel
      ? "opencodeContext.addSelection"
      : "opencodeContext.addFile"
  } else {
    statusBar.text = "$(comment-discussion) opencode"
    statusBar.tooltip = "opencode: 打开终端"
    statusBar.command = "opencodeContext.openTerminal"
  }
  statusBar.show()
}

function writeBridge(editor) {
  if (!vscode.workspace.getConfiguration("opencodeContext").get("writeBridge", true)) return
  try {
    const info = getInfo(editor)
    if (!info) return
    fs.mkdirSync(BRIDGE_DIR, { recursive: true })
    const payload = {
      updatedAt: new Date().toISOString(),
      file: info.rel,
      absolutePath: info.doc.uri.fsPath,
      lines: info.lines || null,
      hasSelection: info.hasSel,
      text: info.hasSel ? info.text : "",
      ref: info.ref,
    }
    const next = JSON.stringify(payload, null, 2)
    if (fs.existsSync(BRIDGE_FILE) && fs.readFileSync(BRIDGE_FILE, "utf8") === next) return
    fs.writeFileSync(BRIDGE_FILE, next)
  } catch (_) {}
}

function focusOpencodeTerminal() {
  const term = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
  if (term) term.show()
}

async function openTerminal() {
  const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
  if (existing) {
    existing.show()
    return
  }
  const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
  const term = vscode.window.createTerminal({
    name: TERMINAL_NAME,
    location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    env: {
      _EXTENSION_OPENCODE_PORT: String(port),
      OPENCODE_CALLER: "vscode",
    },
  })
  term.show()
  term.sendText("opencode --port " + port)
}

module.exports = { activate, deactivate }

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

function normalizePath(value) {
  if (!value) {
    return ''
  }

  return value.startsWith('\\\\?\\') ? value.slice(4) : value
}

function resolveProjectRoot() {
  const candidates = [
    process.env.npm_config_local_prefix,
    process.env.INIT_CWD,
    process.env.npm_package_json
      ? path.dirname(process.env.npm_package_json)
      : '',
  ]

  for (const candidate of candidates) {
    const normalized = normalizePath(candidate)
    if (normalized) {
      return normalized
    }
  }

  return normalizePath(process.cwd())
}

const projectRoot = resolveProjectRoot()
const forwardedArgs = (() => {
  try {
    const parsed = JSON.parse(process.env.TAURI_LAUNCH_ARGS || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return process.argv.slice(2)
  }
})()

const cliEntry = path.join(
  projectRoot,
  'node_modules',
  '@tauri-apps',
  'cli',
  'tauri.js',
)
const windowsDevScript = path.join(projectRoot, 'scripts', 'tauri-dev.ps1')
const isWindowsDevCommand =
  process.platform === 'win32' && forwardedArgs[0] === 'dev'

if (!existsSync(cliEntry)) {
  console.error(`Tauri CLI entry bulunamadi: ${cliEntry}`)
  process.exit(1)
}

if (isWindowsDevCommand && !existsSync(windowsDevScript)) {
  console.error(`Windows dev launcher bulunamadi: ${windowsDevScript}`)
  process.exit(1)
}

const command = isWindowsDevCommand ? 'powershell.exe' : process.execPath
const commandArgs = isWindowsDevCommand
  ? ['-ExecutionPolicy', 'Bypass', '-File', windowsDevScript, ...forwardedArgs.slice(1)]
  : [cliEntry, ...forwardedArgs]

const child = spawn(command, commandArgs, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    INIT_CWD: projectRoot,
    PWD: projectRoot,
  },
})

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

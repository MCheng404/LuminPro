import { exec } from 'kernelsu'

export const MODULE_DIR = '/data/adb/modules/LuminMax'
export const CONFIG_DIR = `${MODULE_DIR}/config`
export const CONFIG_FILE = `${MODULE_DIR}/config/config.json`
export const BACKUP_CONFIG_FILE = `${MODULE_DIR}/config/.backup/config.json`
export const PID_FILE = `${MODULE_DIR}/pid/inotifyd.pid`
export const FLAG_FILE = `${MODULE_DIR}/pid/up.flag`
export const STOP_FLAG_FILE = `${MODULE_DIR}/pid/stop.flag`
export const LOG_FILE = `${MODULE_DIR}/service.log`
export const DEFAULT_NOW_BRI_FILE = '/sys/class/backlight/panel0-backlight/brightness'
export const DEFAULT_SYS_MAX_BRI_FILE = '/sys/class/backlight/panel0-backlight/max_brightness'

// ── 全局操作锁：防止用户快速重复点击导致 exec 队列阻塞 ──
let _busyCount = 0
const _busyListeners = new Set()

export function isBusy() {
  return _busyCount > 0
}

export function onBusyChange(fn) {
  _busyListeners.add(fn)
  return () => _busyListeners.delete(fn)
}

function _setBusy(v) {
  if (v) _busyCount++
  else if (_busyCount > 0) _busyCount--
  _busyListeners.forEach((fn) => fn(_busyCount > 0))
}

// ── Toast ──
let _toastTimer = null
export function showToast(msg) {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = msg
  toast.classList.add('show')
  if (_toastTimer) clearTimeout(_toastTimer)
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 2500)
}

// ── 带锁的命令执行 ──
// 所有用户触发的 shell 操作都应通过 runCmdLocked，自动管理全局 busy 状态
export async function runCmd(cmd, opts = {}) {
  const { silent = false } = opts
  if (!silent) _setBusy(true)
  try {
    const res = await exec(cmd)
    return res
  } catch (e) {
    console.warn(`[DEBUG] 执行命令失败 (可能是非 KSU 环境): ${cmd}`)
    return _mockResponse(cmd)
  } finally {
    if (!silent) _setBusy(false)
  }
}

// 静默执行（不触发 busy 锁），用于后台自动刷新
export async function runCmdSilent(cmd) {
  return runCmd(cmd, { silent: true })
}

function _mockResponse(cmd) {
  if (cmd.includes('cat') && cmd.includes('config.json')) {
    return {
      errno: 0,
      stdout: JSON.stringify({
        ui_max_bri: 4095,
        max_bri: 3500,
        steps_num: 100,
        log_max_size: 1024,
        auto_bri_sleep: 1,
        display_hdr_sleep: 0,
        hdr_enter_threshold: 1.1,
        hdr_exit_threshold: 1.03,
        hdr_cooldown: 8,
        sleep_time: '1900-0600',
        inotify_events: 'c',
        now_bri_file: '/sys/mock/brightness',
        max_bri_file: '/sys/mock/max_brightness',
        blacklist_apps: ['com.example.app'],
      }),
      stderr: '',
    }
  }
  if (cmd.includes('cat') && cmd.includes('inotifyd.pid'))
    return { errno: 0, stdout: '12345', stderr: '' }
  if (cmd.includes('settings get system screen_brightness_mode'))
    return { errno: 0, stdout: '1', stderr: '' }
  if (cmd.includes('[ -f') && cmd.includes('stop.flag'))
    return { errno: 0, stdout: '0', stderr: '' }
  if (cmd.includes('cat') && (cmd.includes('brightness') || cmd.includes('now_bri')))
    return { errno: 0, stdout: '1200', stderr: '' }
  if (cmd.includes('cat') && (cmd.includes('max_brightness') || cmd.includes('max_bri')))
    return { errno: 0, stdout: '4095', stderr: '' }
  if (cmd.includes('tail') && cmd.includes('service.log')) {
    return {
      errno: 0,
      stdout:
        '[04-07 15:40:01] [service] [INFO    ] LuminMax 服务启动\n[04-07 15:41:05] [up] [INFO    ] 触发提升: 当前亮度 1200 ≥ 阈値 1000\n[04-07 15:42:10] [up] [SUCCESS ] 亮度提升完成 (3500)',
      stderr: '',
    }
  }
  if (cmd.includes('cat') && cmd.includes('.md'))
    return {
      errno: 0,
      stdout: '# 调试模式\n\n当前处于 **Web 调试模式**，显示的是模拟测试数据。',
      stderr: '',
    }
  if (cmd.includes('cat') && cmd.includes('.txt'))
    return { errno: 0, stdout: '这是 NOTE.txt 的模拟内容。', stderr: '' }
  return { errno: -1, stdout: '', stderr: '' }
}

// 读取完整 JSON 配置
export async function readConfig() {
  const res = await runCmdSilent(`cat "${CONFIG_FILE}"`)
  if (res.errno !== 0 || !res.stdout.trim()) return {}
  try {
    return JSON.parse(res.stdout)
  } catch {
    return {}
  }
}

// 写入完整 JSON 配置
export async function writeConfig(obj) {
  const content = JSON.stringify(obj).replace(/'/g, "'\\''")
  return runCmd(`printf '%s' '${content}' > "${CONFIG_FILE}"`)
}

// 合并更新 JSON 配置（保留其他字段）
export async function updateConfig(updates) {
  const current = await readConfig()
  return writeConfig({ ...current, ...updates })
}

// 将文件内容写入指定路径
export async function writeFile(path, content) {
  const safeContent = String(content).replace(/'/g, "'\\''")
  return runCmd(`printf '%s' '${safeContent}' > "${path}"`)
}

// 简单防抖工具
export function debounce(fn, delay = 300) {
  let timer = null
  return (...args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

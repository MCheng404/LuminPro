import { ref, computed } from 'vue'
import {
  runCmd,
  runCmdSilent,
  readConfig,
  MODULE_DIR,
  PID_FILE,
  STOP_FLAG_FILE,
  DEFAULT_NOW_BRI_FILE,
  DEFAULT_SYS_MAX_BRI_FILE,
} from '../utils.js'

export function useStatus() {
  // 亮度
  const currentBri = ref(null)
  const sysMaxBri = ref(null)

  // 服务状态
  const inotifydPid = ref('—')
  const inotifydState = ref('—')
  const isRunning = ref(false)
  const isPaused = ref(false)
  const statusClass = computed(() => {
    if (isPaused.value) return 'status-paused'
    if (isRunning.value) return 'status-running'
    return 'status-loading'
  })
  const statusText = computed(() => {
    if (isPaused.value) return '已暂停'
    if (isRunning.value) return '运行中'
    return '未运行'
  })

  // HDR / 睡眠状态
  const hdrRatio = ref('—')
  const sleepStatus = ref('—')

  // 自动亮度
  const autoBriMode = ref(false)

  // 操作中状态（供 UI 显示 loading）
  const isToggling = ref(false)
  const isRestarting = ref(false)

  // 缓存配置字段（避免每次刷新都 readConfig）
  let _nowBriFile = null
  let _sysMaxBriFile = null
  let _sleepTime = null

  async function _ensurePaths() {
    if (_nowBriFile && _sysMaxBriFile) return
    const cfg = await readConfig()
    _nowBriFile = cfg.now_bri_file || DEFAULT_NOW_BRI_FILE
    _sysMaxBriFile = cfg.max_bri_file || DEFAULT_SYS_MAX_BRI_FILE
    _sleepTime = cfg.sleep_time || ''
  }

  function invalidatePaths() {
    _nowBriFile = null
    _sysMaxBriFile = null
    _sleepTime = null
  }

  async function load(forceFull = false) {
    await _ensurePaths()

    const needBri = forceFull || currentBri.value === null || sysMaxBri.value === null

    // 所有 Shell 命令一次并发，使用静默执行不触发 busy 锁
    const [pidStateRes, stopRes, autoBriRes, hdrRes, cBriRes, sBriRes] = await Promise.all([
      runCmdSilent(
        `PID=$(cat "${PID_FILE}" 2>/dev/null || true); printf '%s\\n' "$PID"; [ -n "$PID" ] && grep '^State:' "/proc/$PID/status" 2>/dev/null | awk '{print $2}' || true`,
      ),
      runCmdSilent(`[ -f "${STOP_FLAG_FILE}" ] && echo "1" || echo "0"`),
      runCmdSilent(`settings get system screen_brightness_mode`),
      runCmdSilent(
        `dumpsys display 2>/dev/null | sed -n 's/.*hdrSdrRatio \\([0-9.]*\\).*/\\1/p' | head -n 1`,
      ),
      needBri ? runCmdSilent(`cat "${_nowBriFile}"`) : Promise.resolve({ errno: -1, stdout: '' }),
      needBri ? runCmdSilent(`cat "${_sysMaxBriFile}"`) : Promise.resolve({ errno: -1, stdout: '' }),
    ])

    if (needBri) {
      currentBri.value = cBriRes.errno === 0 ? cBriRes.stdout.trim() : '0'
      sysMaxBri.value = sBriRes.errno === 0 ? sBriRes.stdout.trim() : '255'
    }

    const psLines = (pidStateRes.errno === 0 ? pidStateRes.stdout : '').split('\n')
    const pidStr = psLines[0]?.trim() || ''
    const stateChar = psLines[1]?.trim() || ''

    isPaused.value = stopRes.errno === 0 && stopRes.stdout.trim() === '1'
    isRunning.value = !isPaused.value && !!pidStr
    inotifydPid.value = pidStr || '离线'
    inotifydState.value = isRunning.value ? stateChar || '已退出' : '离线'

    autoBriMode.value = autoBriRes.errno === 0 && parseInt(autoBriRes.stdout.trim(), 10) === 1

    const hdrRaw = hdrRes.errno === 0 ? hdrRes.stdout.trim() : ''
    hdrRatio.value = hdrRaw && /^\d+(\.\d+)?$/.test(hdrRaw) ? parseFloat(hdrRaw).toFixed(2) : '-'

    sleepStatus.value = _calcSleep(_sleepTime)
  }

  function _calcSleep(sleepTime) {
    if (!sleepTime || !sleepTime.includes('-')) return '非休眠'
    const [s, e] = sleepTime.split('-')
    if (s.length !== 4 || e.length !== 4) return '非休眠'
    const now = new Date()
    const nV = now.getHours() * 100 + now.getMinutes()
    const sNum = parseInt(s.slice(0, 2), 10) * 100 + parseInt(s.slice(2), 10)
    const eNum = parseInt(e.slice(0, 2), 10) * 100 + parseInt(e.slice(2), 10)
    if (sNum > eNum) {
      return nV >= sNum || nV < eNum ? '休眠中' : '非休眠'
    }
    return nV >= sNum && nV < eNum ? '休眠中' : '非休眠'
  }

  async function toggleService(toast) {
    if (isToggling.value) return
    isToggling.value = true
    try {
      const res = await runCmd(`sh ${MODULE_DIR}/action.sh`)
      toast(res.errno === 0 ? res.stdout.trim() || '状态已切换' : '操作失败: ' + res.stderr)
      // 延迟刷新，给服务启动/停止留出时间
      setTimeout(async () => {
        await load(true)
      }, 800)
    } finally {
      isToggling.value = false
    }
  }

  async function restartService(toast) {
    if (isRestarting.value) return
    isRestarting.value = true
    toast('正在重启服务...')
    try {
      const res = await runCmd(`sh ${MODULE_DIR}/script/restart.sh`)
      toast(res.errno === 0 ? '服务已成功重启' : '重启失败: ' + res.stderr)
      // 延迟刷新，给服务重启留出时间
      setTimeout(async () => {
        await load(true)
      }, 1500)
    } finally {
      isRestarting.value = false
    }
  }

  async function setBrightness(newBri, toast) {
    currentBri.value = String(newBri) // 乐观更新，立即响应
    const cmd = `echo -n '${newBri}' > '${_nowBriFile}' 2>/dev/null && echo 'OK'`
    const res = await runCmd(cmd)
    if (!(res.errno === 0 && res.stdout.includes('OK'))) {
      toast('亮度设置失败，已恢复')
      await load(true)
    }
  }

  async function setAutoBrightness(enabled, toast) {
    const mode = enabled ? 1 : 0
    autoBriMode.value = enabled // 乐观更新
    const res = await runCmd(`settings put system screen_brightness_mode ${mode}`)
    if (res.errno !== 0) {
      autoBriMode.value = !enabled // 回滚
      toast('设置失败: ' + (res.stderr || '未知错误'))
    } else {
      toast(enabled ? '自动亮度已启用' : '手动亮度已启用')
    }
  }

  return {
    currentBri,
    sysMaxBri,
    inotifydPid,
    inotifydState,
    isRunning,
    isPaused,
    statusClass,
    statusText,
    hdrRatio,
    sleepStatus,
    autoBriMode,
    isToggling,
    isRestarting,
    load,
    invalidatePaths,
    toggleService,
    restartService,
    setBrightness,
    setAutoBrightness,
  }
}

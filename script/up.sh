#!/system/bin/sh
#shellcheck shell=ash
# 亮度提升脚本

MODDIR="${0%/*/*}"
CONFIG_FILE="$MODDIR/config/config.json"
JQ="$MODDIR/bin/jq"
PID_DIR="$MODDIR/pid"
stop_file="$PID_DIR/stop.flag"
log_file="$MODDIR/service.log"

DEFAULT_NOW_BRI_FILE="/sys/class/backlight/panel0-backlight/brightness"

get_cfg() {
    local key="$1" default="$2"
    local val
    if val=$("$JQ" -re ".${key}" "$CONFIG_FILE" 2>/dev/null); then
        echo "$val"
    else
        echo "$default"
    fi
}

now_bri_file="$(get_cfg now_bri_file "$DEFAULT_NOW_BRI_FILE")"
log_level="$(get_cfg log_level "info")"

_log() {
    local level="${2:-INFO}"

    case "$1" in
    "日志超限"*) ;;
    *) if [ -f "$stop_file" ]; then return; fi ;;
    esac

    case "$log_level" in
    off) return ;;
    error) case "$level" in ERROR) ;; *) return ;; esac ;;
    warn) case "$level" in ERROR | WARN) ;; *) return ;; esac ;;
    esac

    local max_size
    max_size="$(get_cfg log_max_size 500)"
    if [ -f "$log_file" ]; then
        local cur_size
        cur_size=$(du -k "$log_file" | cut -f1)
        if [ "$cur_size" -ge "$max_size" ]; then
            printf '[%s] [%s] [%s] %s\n' "$(date '+%m-%d %H:%M:%S')" "up" "WARN" "日志超限 (${cur_size}KB / ${max_size}KB)，已自动重置" >"$log_file"
        fi
    fi
    printf '[%s] [%s] [%s] %s\n' "$(date '+%m-%d %H:%M:%S')" "up" "$level" "$1" >>"$log_file"
}

if [ -f "$stop_file" ]; then
    _log "服务已暂停，跳过本次处理" "WARN"
    exit 0
fi

# 防止 up.sh 自身读写亮度节点时触发 inotify 事件导致递归调用
lock_file="$PID_DIR/up.lock"
if [ -f "$lock_file" ]; then
    old_pid=$(cat "$lock_file" 2>/dev/null)
    if [ -n "$old_pid" ] && [ -d "/proc/$old_pid" ]; then
        exit 0
    fi
    # PID 不存在，说明是遗留的锁，清理之
    _log "检测到遗留的锁文件 (PID: $old_pid 不存在)，已自动清除" "WARN"
    rm -f "$lock_file"
fi
echo $$ >"$lock_file"
# shellcheck disable=SC2064
trap "rm -f '$lock_file'" EXIT HUP INT TERM

# 读取配置
ui_max_bri="$(get_cfg ui_max_bri 0)"
max_bri="$(get_cfg max_bri 0)"
sleep_time="$(get_cfg sleep_time '')"
auto_bri_sleep="$(get_cfg auto_bri_sleep 1)"
display_hdr_sleep="$(get_cfg display_hdr_sleep 0)"
steps_num="$(get_cfg steps_num 50)"

# HDR 相关配置（双阈值滞后 + 冷却期）
hdr_enter_threshold="$(get_cfg hdr_enter_threshold 1.10)"
hdr_exit_threshold="$(get_cfg hdr_exit_threshold 1.03)"
hdr_cooldown="$(get_cfg hdr_cooldown 8)"

# 解析休眠时间
sleep_start="${sleep_time%-*}"
sleep_end="${sleep_time#*-}"

IS_SLEEP_TIME() {
    local now
    now="$(date '+%H%M')"
    [ -z "$sleep_start" ] || [ -z "$sleep_end" ] && return 1
    [ "$sleep_start" = "$sleep_end" ] && return 1
    if [ "$sleep_start" -gt "$sleep_end" ]; then
        [ "$now" -ge "$sleep_start" ] || [ "$now" -lt "$sleep_end" ]
    else
        [ "$now" -ge "$sleep_start" ] && [ "$now" -lt "$sleep_end" ]
    fi
}

target_bri="$max_bri"

# 平滑渐变调整亮度
# 参数: $1=起始亮度 $2=目标亮度 $3=步数
fade_brightness() {
    local start_bri="$1" end_bri="$2" steps="$3"
    local bri_diff step_value step

    bri_diff="$((end_bri - start_bri))"
    if [ "$bri_diff" -eq 0 ]; then
        return 0
    fi

    step_value="$((bri_diff / steps))"
    if [ "$step_value" -eq 0 ]; then
        # 差值过小，直接设定
        echo -n "$end_bri" >"$now_bri_file" 2>/dev/null
        return $?
    fi

    for step in $(seq 1 "$steps"); do
        echo -n $((start_bri + step * step_value)) >"$now_bri_file" 2>/dev/null
        sleep 0.02
    done
    echo -n "$end_bri" >"$now_bri_file" 2>/dev/null
    return $?
}

update_all() {
    local step
    start_bri="$(cat "$now_bri_file")"
    bri_diff="$((target_bri - start_bri))"
    step_value="$((bri_diff / steps_num))"

    if [ "$step_value" -eq 0 ]; then
        _log "差値过小，直接设定亮度: $target_bri" "INFO"
        echo -n "$target_bri" >"$now_bri_file" && return 0 || return 1
    fi

    _log "开始渐变调整: $start_bri → $target_bri ($steps_num 步)" "INFO"
    for step in $(seq 1 "$steps_num"); do
        echo -n $((start_bri + step * step_value)) >"$now_bri_file"
        sleep 0.02
    done
    echo -n "$target_bri" >"$now_bri_file" && return 0 || return 1
}

CHECK_BRI() {
    local cycle_num now_bri
    # shellcheck disable=SC2034
    for cycle_num in $(seq 1 10); do
        now_bri="$(cat "$now_bri_file")"
        if [ "$now_bri" -ge "$ui_max_bri" ] && [ "$now_bri" -lt "$target_bri" ]; then
            _log "触发提升: 当前亮度 $now_bri ≥ 阈値 $ui_max_bri，目标 $target_bri" "INFO"
            if update_all; then
                _log "亮度提升完成 ($target_bri)" "SUCCESS"
                return 0
            else
                _log "亮度提升失败: 无法写入亮度节点" "ERROR"
                return 1
            fi
        fi
        sleep 0.3
    done
    return 1
}

# ── HDR 状态机检测 ──────────────────────────────────────────────
# 使用双阈值滞后机制避免边界振荡：
#   - 比率 > hdr_enter_threshold → 进入 HDR 状态
#   - 比率 < hdr_exit_threshold  → 退出 HDR 状态
#   - 两者之间 → 保持当前状态不变
# 状态持久化在 hdr.state 文件中，格式: "状态|时间戳"
# 进入 HDR 时平滑恢复亮度，避免峰值亮度停留在 HDR 场景
CHECK_HDR() {
    local hdr_state_file="$PID_DIR/hdr.state"
    local current_state="inactive"
    local state_time=0

    # 读取持久化状态
    if [ -f "$hdr_state_file" ]; then
        local saved_state saved_time
        saved_state="$(cut -d'|' -f1 "$hdr_state_file" 2>/dev/null)"
        saved_time="$(cut -d'|' -f2 "$hdr_state_file" 2>/dev/null)"
        if [ "$saved_state" = "active" ] || [ "$saved_state" = "inactive" ]; then
            current_state="$saved_state"
            state_time="${saved_time:-0}"
        fi
    fi

    local now
    now="$(date +%s)"

    # 冷却期内：保持当前状态，不重新检测
    if [ "$current_state" = "active" ]; then
        local elapsed=$((now - state_time))
        if [ "$elapsed" -lt "$hdr_cooldown" ]; then
            _log "HDR 状态冷却期内 (${elapsed}s / ${hdr_cooldown}s)，保持跳过" "INFO"
            return 0
        fi
    fi

    # 读取当前 hdrSdrRatio
    local hdr_ratio
    hdr_ratio="$(dumpsys display 2>/dev/null | sed -n 's/.*hdrSdrRatio \([0-9.]*\).*/\1/p' | head -n 1)"

    # 读不到比率时视为 1.0（非 HDR），不再使用可能过时的缓存
    if ! echo "$hdr_ratio" | grep -qE '^[0-9]+\.[0-9]+$'; then
        hdr_ratio="1.00"
    fi

    local hdr_ratio_rounded
    hdr_ratio_rounded="$(awk "BEGIN{printf \"%.2f\", $hdr_ratio}")"

    local new_state="$current_state"

    # 双阈值滞后判断
    if awk "BEGIN{exit !($hdr_ratio_rounded > $hdr_enter_threshold)}" 2>/dev/null; then
        # 超过进入阈值 → 进入 HDR
        new_state="active"
    elif awk "BEGIN{exit !($hdr_ratio_rounded < $hdr_exit_threshold)}" 2>/dev/null; then
        # 低于退出阈值 → 退出 HDR
        new_state="inactive"
    fi
    # 中间区域：保持 current_state 不变

    # 状态发生变化
    if [ "$new_state" != "$current_state" ]; then
        if [ "$new_state" = "active" ]; then
            _log "HDR 状态切换: 进入 HDR (比率: $hdr_ratio_rounded > 阈值: $hdr_enter_threshold)" "WARN"
            # 进入 HDR 时，如果当前亮度已被提升，平滑恢复到触发阈值以下
            local cur_bri
            cur_bri="$(cat "$now_bri_file" 2>/dev/null)"
            if [ -n "$cur_bri" ] && [ "$cur_bri" -gt "$ui_max_bri" ] && [ "$ui_max_bri" -gt 0 ]; then
                local restore_bri=$((ui_max_bri - 1))
                [ "$restore_bri" -lt 0 ] && restore_bri=0
                _log "HDR 场景下恢复亮度: $cur_bri → $restore_bri (避免峰值亮度干扰 HDR 显示)" "INFO"
                fade_brightness "$cur_bri" "$restore_bri" "$steps_num"
            fi
        else
            _log "HDR 状态切换: 退出 HDR (比率: $hdr_ratio_rounded < 阈值: $hdr_exit_threshold)" "INFO"
        fi
        # 持久化新状态
        echo "${new_state}|${now}" >"$hdr_state_file"
    else
        # 状态未变，更新时间戳（active 状态用于冷却计时）
        if [ "$new_state" = "active" ]; then
            echo "${new_state}|${now}" >"$hdr_state_file"
        fi
    fi

    if [ "$new_state" = "active" ]; then
        _log "HDR 内容播放中 (比率: $hdr_ratio_rounded)，跳过亮度提升" "INFO"
        return 0
    fi

    return 1
}

MAIN() {
    if IS_SLEEP_TIME; then
        _log "处于休眠时段 ($sleep_start-$sleep_end)，跳过提升" "INFO"
        return
    fi

    if [ "$auto_bri_sleep" = "1" ]; then
        local mode
        mode="$(settings get system screen_brightness_mode 2>/dev/null)"
        if [ "$mode" = "1" ]; then
            _log "自动亮度已启用，跳过提升" "INFO"
            return
        fi
    fi

    # 黑名单检测（从 JSON 数组读取）
    local blacklist_len
    blacklist_len=$("$JQ" -r '.blacklist_apps | length' "$CONFIG_FILE" 2>/dev/null || echo "0")
    if [ "${blacklist_len:-0}" -gt 0 ]; then
        local current_focus current_app
        current_focus="$(dumpsys window | grep mCurrentFocus | sed 's/.*u[0-9][0-9]* //' | sed 's/}.*//')"
        current_app="${current_focus%%/*}"
        if [ -n "$current_focus" ] &&
            "$JQ" -re --arg f "$current_focus" --arg a "$current_app" \
                '.blacklist_apps | map(. == $f or . == $a) | any' \
                "$CONFIG_FILE" >/dev/null 2>&1; then
            _log "当前前台 ($current_focus) 在黑名单中，跳过提升" "INFO"
            return
        fi
    fi

    # HDR 状态机检测（双阈值滞后 + 冷却期 + 进入时恢复亮度）
    if [ "$display_hdr_sleep" = "1" ]; then
        if CHECK_HDR; then
            return
        fi
    fi

    CHECK_BRI
}

MAIN
exit 0

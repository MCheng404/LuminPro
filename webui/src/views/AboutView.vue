<script setup>
import { inject, ref, onMounted } from 'vue'
import Button from '@/components/ui/Button.vue'
import { runCmd, MODULE_DIR } from '../utils.js'
import { ExternalLink, Github, BookOpen, ChevronLeft, Loader2 } from 'lucide-vue-next'

const showToast = inject('showToast')
const config = inject('config')

const moduleInfo = ref({})
const sheetVisible = ref(false)
const sheetLoading = ref(false)
const sheetContent = ref('')
const sheetTitle = ref('')

async function loadModuleInfo() {
  try {
    const res = await runCmd(`cat ${MODULE_DIR}/module.prop`)
    if (res.errno === 0) {
      const lines = res.stdout.trim().split('\n')
      lines.forEach((line) => {
        const [key, ...val] = line.split('=')
        if (key && val.length) moduleInfo.value[key.trim()] = val.join('=').trim()
      })
    }
  } catch {}
}

async function openDoc(title, file) {
  sheetTitle.value = title
  sheetVisible.value = true
  sheetLoading.value = true
  sheetContent.value = ''
  try {
    const res = await runCmd(`cat ${MODULE_DIR}/${file}`)
    sheetContent.value = res.errno === 0 ? res.stdout : '读取失败'
  } catch {
    sheetContent.value = '读取失败'
  } finally {
    sheetLoading.value = false
  }
}

function closeSheet() {
  sheetVisible.value = false
}

onMounted(() => {
  loadModuleInfo()
})
</script>

<template>
  <div style="display: contents">
    <section class="card" id="about-section">
      <div class="card-header">
        <h2>关于</h2>
      </div>

      <div class="about-module-info">
        <div class="about-module-icon">💡</div>
        <div class="about-module-text">
          <h3>{{ moduleInfo.name || 'LuminMax' }}</h3>
          <p>版本 {{ moduleInfo.version || '20260908' }}</p>
          <p class="about-author">作者: {{ moduleInfo.author || 'Maocat（二改）& 酷安@Yule' }}</p>
        </div>
      </div>

      <div class="about-desc">
        <p>
          LuminMax 是一个基于 KernelSU 的屏幕亮度强化模块，通过事件驱动架构突破前台亮度上限，
          将屏幕拉至硬件峰值亮度。支持 HDR 场景智能休眠、应用黑名单、按活动屏蔽等功能。
        </p>
      </div>

      <div class="about-links">
        <a
          class="about-link-item"
          href="https://github.com/MCheng404/LuminPro"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Github :size="18" />
          <span>GitHub 仓库</span>
          <ExternalLink :size="14" class="about-link-arrow" />
        </a>
        <button class="about-link-item" @click="openDoc('使用说明', 'README.md')">
          <BookOpen :size="18" />
          <span>使用说明</span>
        </button>
        <button class="about-link-item" @click="openDoc('更新日志', 'changelog.md')">
          <BookOpen :size="18" />
          <span>更新日志</span>
        </button>
      </div>

      <div class="about-actions">
        <Button variant="outline" @click="config.resetWebUI(showToast)">重置 WebUI 设置</Button>
      </div>

      <p class="about-footer">Made with ❤ by Maocat</p>
    </section>

    <!-- 文档底部弹层 -->
    <Teleport to="body">
      <div class="doc-sheet-overlay" :class="{ show: sheetVisible }" @click="closeSheet">
        <div class="doc-sheet" @click.stop>
          <div class="doc-sheet-header">
            <button class="doc-sheet-close" @click="closeSheet">
              <ChevronLeft :size="20" />
            </button>
            <span class="doc-sheet-title">{{ sheetTitle }}</span>
          </div>
          <div class="doc-sheet-body">
            <div v-if="sheetLoading" class="doc-sheet-loading">加载中...</div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-else class="doc-sheet-content" v-html="sheetContent"></div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

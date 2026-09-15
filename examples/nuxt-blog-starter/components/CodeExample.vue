<template>
  <div :data-block-uid="block_uid" class="my-4"
    data-block-container="{add:'horizontal'}">
    <div class="rounded-lg overflow-hidden bg-gray-900">
      <!-- Tab bar (only when 2+ tabs) -->
      <div v-if="tabs.length > 1" data-tab-bar class="flex bg-gray-800 border-b border-gray-700">
        <button v-for="(tab, i) in tabs" :key="tab['@id']"
          :data-block-selector="`${tab['@id']} ${tab['@id']}#code`"
          data-linkable-allow
          @click="activeTab = i"
          :class="['px-4 py-2 text-sm font-medium transition-colors',
            activeTab === i ? 'text-white bg-gray-900 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200']">
          <span data-edit-text="label">{{ tab.label || tab.language || `Tab ${i + 1}` }}</span>
        </button>
      </div>
      <!-- Each tab is a child block -->
      <div v-for="(tab, i) in tabs" :key="tab['@id']"
        :data-block-uid="tab['@id']"
        data-block-add="right"
        :style="{ display: activeTab === i ? 'block' : 'none' }"
        class="relative group">
        <button @click="copyCode(tab)"
          class="absolute top-2 right-2 px-2 py-1 text-xs text-gray-400 bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-white z-10">
          {{ copiedId === tab['@id'] ? 'Copied!' : 'Copy' }}
        </button>
        <pre class="p-4 overflow-x-auto text-sm leading-relaxed m-0 text-gray-100"
          data-edit-text="code"
          style="white-space: pre-wrap;"
          ><code class="hljs" v-html="highlight(tab)"></code></pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import bash from 'highlight.js/lib/languages/bash';
import 'highlight.js/styles/github-dark.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('bash', bash);

const props = defineProps({
  block_uid: { type: String, required: true },
  block: { type: Object, required: true },
});

const activeTab = ref(0);
const copiedId = ref(null);

const tabs = computed(() => props.block.tabs || []);

function highlight(tab) {
  const code = tab.code || '';
  const language = tab.language;
  if (!code) return '';
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language }).value;
  }
  return hljs.highlightAuto(code).value;
}

async function copyCode(tab) {
  await navigator.clipboard.writeText(tab.code || '');
  copiedId.value = tab['@id'];
  setTimeout(() => { copiedId.value = null; }, 2000);
}
</script>

<template>
    <header>
<nav class="bg-white border-b border-gray-200 dark:bg-gray-900 relative">
    <div class="flex flex-wrap items-center justify-between max-w-screen-xl mx-auto p-4">
        <NuxtLink to="/" class="flex items-center space-x-3 rtl:space-x-reverse">
            <img src="/inka-mark.svg" alt="" aria-hidden="true" class="w-8 h-8" />
            <span class="self-center text-2xl font-semibold whitespace-nowrap dark:text-white">Inka</span>
        </NuxtLink>
        <div class="flex items-center md:order-2 space-x-1 md:space-x-2 rtl:space-x-reverse">
            <div class="relative flex items-center">
                <button v-if="!searchOpen" @click="openSearch" type="button"
                    class="p-2 text-gray-500 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
                    aria-label="Search">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                    </svg>
                </button>
                <form v-else class="flex items-center" @submit.prevent="submitSearch">
                    <input ref="searchInput" v-model="searchQuery" type="text" placeholder="Search..."
                        class="w-48 md:w-64 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        @keydown.escape="closeSearch" @blur="onSearchBlur" />
                </form>
            </div>
            <NuxtLink :to="`${adminUrl}/login`" data-linkable-allow class="text-gray-800 dark:text-white hover:bg-gray-50 focus:ring-4 focus:ring-gray-300 font-medium rounded-lg text-sm px-4 py-2 md:px-5 md:py-2.5 dark:hover:bg-gray-700 focus:outline-none dark:focus:ring-gray-800">Login</NuxtLink>
            <button @click="mobileMenuOpen = !mobileMenuOpen" type="button" class="inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600">
                <span class="sr-only">Open main menu</span>
                <svg class="w-5 h-5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 17 14">
                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M1 1h15M1 7h15M1 13h15"/>
                </svg>
            </button>
        </div>
        <div :class="{ hidden: !mobileMenuOpen }" class="items-center justify-between w-full md:flex md:w-auto md:order-1">
            <ul class="flex flex-col mt-4 font-medium md:flex-row md:mt-0 md:space-x-8 rtl:space-x-reverse">
                <li v-for="item in nav" :key="getId(item)" class="flex items-center">
                    <NuxtLink
                        :to="getUrl(item)"
                        class="block py-2 px-3 font-medium border-b border-gray-100 md:border-0 md:p-0 dark:border-gray-700"
                        :class="openPanel === getId(item)
                            ? 'text-blue-600 dark:text-blue-500'
                            : 'text-gray-900 hover:text-blue-600 dark:text-white md:dark:hover:text-blue-500'"
                    >{{ item.title }}</NuxtLink>
                    <button
                        v-if="item.items && item.items.length"
                        type="button"
                        class="p-1 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-500 cursor-pointer"
                        :aria-expanded="openPanel === getId(item)"
                        :aria-label="`Show ${item.title} sections`"
                        @click="togglePanel(item)"
                    >
                        <svg class="w-4 h-4 transition-transform" :class="{ 'rotate-180': openPanel === getId(item) }"
                             fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                        </svg>
                    </button>
                </li>
            </ul>
        </div>
    </div>
    <div
        v-for="item in nav"
        :key="`panel-${getId(item)}`"
        :hidden="openPanel !== getId(item)"
        class="absolute left-0 right-0 z-50 bg-gray-100 border-t border-gray-200 shadow-lg dark:bg-gray-800 dark:border-gray-700"
    >
        <div class="max-w-screen-xl mx-auto px-4 py-6">
            <div class="flex items-center justify-between mb-6">
                <NuxtLink :to="getUrl(item)" class="text-xl font-semibold text-gray-900 dark:text-white hover:text-blue-600">
                    {{ item.title }}
                </NuxtLink>
                <button @click="openPanel = null" class="text-gray-500 hover:text-gray-900 dark:hover:text-white" aria-label="Close menu">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div v-for="child in item.items" :key="getId(child)" class="border-l-2 border-gray-300 pl-4">
                    <NuxtLink :to="getUrl(child)" class="block font-bold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-500 mb-2">
                        {{ child.title }}
                    </NuxtLink>
                    <ul v-if="child.items && child.items.length" class="space-y-1">
                        <li v-for="grandchild in child.items" :key="getId(grandchild)">
                            <NuxtLink :to="getUrl(grandchild)" class="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-500">
                                {{ grandchild.title }}
                            </NuxtLink>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</nav>
</header>
</template>

<script setup>
const runtimeConfig = useRuntimeConfig();
const adminUrl = runtimeConfig.public.adminUrl;

// Site-wide navigation, fetched once and shared across the app.
// Independent of page data — works in both view mode (ploneApi
// could also return it bundled, but we read from the dedicated
// composable so the source is the same in edit mode too).
const nav = await useSiteNav();

const openPanel = ref(null);
const mobileMenuOpen = ref(false);

// Search state
const searchOpen = ref(false);
const searchQuery = ref('');
const searchInput = ref(null);

function openSearch() {
    searchOpen.value = true;
    nextTick(() => searchInput.value?.focus());
}

function closeSearch() {
    searchOpen.value = false;
    searchQuery.value = '';
}

function onSearchBlur() {
    if (!searchQuery.value) {
        closeSearch();
    }
}

function submitSearch() {
    const query = searchQuery.value.trim();
    if (query) {
        navigateTo(`/search?SearchableText=${encodeURIComponent(query)}`);
        closeSearch();
    }
}

// Purely a disclosure toggle now. It no longer navigates: the section title
// beside it is a real link, and the button is only rendered when there are
// children to disclose.
function togglePanel(item) {
    const id = getId(item);
    openPanel.value = openPanel.value === id ? null : id;
}

function getUrl(item) {
    return item['@id'].replace(runtimeConfig.public.backendBaseUrl, '');
}

function getId(item) {
    return item['@id'].replace(runtimeConfig.public.backendBaseUrl, '');
}
</script>

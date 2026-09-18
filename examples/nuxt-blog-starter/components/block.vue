<template comments>
  <div v-if="block['@type'] == 'slate'" class="slate-block" :data-block-uid="block_uid" data-edit-text="value">
    <RichText v-for="node in block['value']" :key="node" :node="node" />
  </div>

  <div v-else-if="block['@type'] == 'suggest'" :data-block-uid="block_uid" class="suggest">
    <label :for="block_uid + '-input'" data-edit-text="label">{{ block.label }}</label>
    <input :id="block_uid + '-input'" name="answer" type="text" :value="block.value"
      aria-autocomplete="list" autocomplete="off">
    <ul class="suggest__list" hidden></ul>
  </div>
  <div v-else-if="block['@type'] == 'introduction'" :data-block-uid="block_uid"
       data-edit-text="value" class="text-xl text-gray-600 leading-relaxed my-6 border-t border-b border-gray-200 py-4">
    <RichText v-for="node in block.value || []" :key="node" :node="node" />
  </div>

  <h1 v-else-if="block['@type'] == 'title'" :data-block-uid="block_uid" data-edit-text="/title">{{ data.title }}
  </h1>

  <p v-else-if="block['@type'] == 'description'" :data-block-uid="block_uid"
     data-edit-text="/description"
     class="text-lg text-gray-500 mb-6">{{ data.description }}</p>

  <div v-else-if="block['@type'] == 'image'" :data-block-uid="block_uid"
       :class="!contained && ['image-size-' + (block.size || 'l'), 'image-align-' + (block.align || 'center')]">
    <template v-for="props in [imageProps(block)]">
      <template v-if="props.url">
        <a v-if="block.href" :href="getUrl(block.href)" class="image-link" data-edit-link="href">
          <NuxtImg data-edit-media="url" :src="props.url" :width="props.width" :alt="block.alt" />
        </a>
        <NuxtImg v-else data-edit-media="url" data-edit-link="href" :src="props.url" :width="props.width" :alt="block.alt" />
      </template>
      <img v-else-if="isInListing" data-edit-media="url" src="/placeholder.svg"
        :alt="block.alt" class="w-full h-48 object-cover rounded bg-gray-200" />
      <div v-else data-edit-media="url" class="w-full h-48 bg-gray-100 rounded flex items-center justify-center text-gray-400">
      </div>
    </template>
  </div>

  <!-- leadimage: only render the wrapper when there's an actual image to
       show. With no image (e.g. a template definition page that hosts a
       leadimage placeholder for the host content to populate), an empty
       wrapper would collapse to zero height and be invisible / unclickable
       — better to omit it entirely so the page reflows naturally. -->
  <div v-else-if="block['@type'] == 'leadimage' && (data.image || data.preview_image)"
       :data-block-uid="block_uid" class="mb-6">
    <template v-for="props in [imageProps(data.image || data.preview_image)]">
      <NuxtImg v-if="props.url" :src="props.url" :data-edit-media="data.image ? '/image' : '/preview_image'"
        class="w-full rounded-lg object-cover max-h-96" loading="lazy" decoding="async" />
    </template>
  </div>

  <!-- dateField block: renders a configurable page-level date field -->
  <div v-else-if="block['@type'] == 'dateField'" :data-block-uid="block_uid"
       class="text-sm text-gray-500 my-2">
    <span :data-edit-text="`/${block.dateField || 'effective'}`">
      {{ formatDateField(data[block.dateField || 'effective'], block.showTime) }}
    </span>
  </div>

  <template v-else-if="block['@type'] == 'hero'" comments>
  <!-- hydra edit-text=heading(.hero-heading) edit-text=subheading(.hero-subheading) edit-media=image(.hero-image) edit-text=buttonText(.hero-button) edit-link=buttonLink(.hero-button) -->
  <div :data-block-uid="block_uid"
       class="hero-block p-5 bg-gray-100 rounded-lg">
    <!-- Image - uses class for selector, no data-edit-media.
         Data-driven (issue #296): no data ⇒ no element. The `v-else` grey box that
         used to sit here was the "always-render" hack — an inline target for an
         empty field, at the cost of an empty div in view markup. -->
    <img v-if="block.image" class="hero-image w-full h-auto max-h-64 object-cover mb-4 rounded"
         :src="getImageUrl(block.image)"
         alt="Hero image" />
    <h1 v-if="block.heading" class="hero-heading text-3xl font-bold mb-2">{{ block.heading }}</h1>
    <p v-if="block.subheading" class="hero-subheading text-xl text-gray-600 mb-4">{{ block.subheading }}</p>
    <div v-if="block.description" class="hero-description mb-4" data-edit-text="description">
      <RichText v-for="node in block.description" :key="node" :node="node" />
    </div>
    <!-- Button - uses class for selectors. One element hosts TWO fields
         (buttonText + buttonLink), so it exists when the button exists: it has a
         label or a target. This is the case a per-block `hideButton` papers over. -->
    <a v-if="block.buttonText || block.buttonLink"
       class="hero-button inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 no-underline"
       :href="getUrl(block.buttonLink)">
      {{ block.buttonText }}
    </a>
  </div>
  </template>

  <div v-else-if="block['@type'] == 'gridBlock'" :data-block-uid="block_uid"
       class="mt-6 mb-6 rounded-lg focus:outline-none" :style="gridBgStyle(block)">
    <div :class="['grid-row grid gap-4 grid-cols-1', ...gridColsClass(block)]">
      <template v-for="entry in gridChildren" :key="entry.id">
        <!-- Listing child: async expand in Suspense, with shared paging -->
        <Suspense v-if="entry.isListing" :key="`grid-listing-${entry.id}-pg${gridPageFromUrl}-${JSON.stringify(entry.block)}`">
          <ListingBlock :id="entry.id" :block="entry.block" :paging="gridPaging" :seen="entry.seen"
            :api-url="effectiveApiUrl" :context-path="effectiveContextPath">
            <template #default="{ items }">
              <template v-for="item in items" :key="item['@uid']">
                <template v-if="item.readOnly"><!-- hydra block-readonly --></template>
                <Block :block_uid="item['@uid']" :block="item" :data="data" :contained="true" :is-in-listing="true"
                       class="grid-cell p-4"
                       :style="!block.styles?.backgroundColor ? { backgroundColor: '#f1f5f9' } : {}" />
              </template>
            </template>
          </ListingBlock>
          <template #fallback>
            <div class="animate-pulse bg-gray-200 dark:bg-gray-700 h-48 rounded grid-cell p-4"></div>
          </template>
        </Suspense>
        <!-- Static child: filtered by paging window -->
        <template v-else v-for="item in entry.items" :key="item['@uid']">
          <Block :block_uid="item['@uid']" :block="item" :data="data" :contained="true"
                 class="grid-cell p-4"
                 :style="!block.styles?.backgroundColor ? { backgroundColor: '#f1f5f9' } : {}" />
        </template>
      </template>
    </div>
    <!-- Combined paging. effectiveGridPaging is pure: the static chain's paging for
         a manual grid, or the ListingBlock-published gridPaging for a listing grid. -->
    <Paging v-if="effectiveGridPaging.totalPages > 1" :paging="effectiveGridPaging" :build-url="gridBuildPagingUrl" />
  </div>

  <!-- Columns container block -->
  <div v-else-if="block['@type'] == 'columns'" :data-block-uid="block_uid" class="columns-block my-4">
    <!-- Title for columns block (always rendered for inline editing) -->
    <h3 data-edit-text="title" class="columns-title mb-2 font-semibold">{{ block.title }}</h3>

    <!-- Top images row - horizontal layout for images above columns -->
    <div v-if="block.top_images?.items?.length" class="top-images-row flex gap-4 mb-4">
      <Block v-for="item in expand(block.top_images.items, block.blocks || {})"
             :key="item['@uid']" :block_uid="item['@uid']" :block="item" :data="data" :contained="true" data-block-add="right" />
    </div>

    <!-- Columns row - one column per row on mobile, side by side as the
         viewport grows (responsiveColsClass), so a 3/4-column layout stacks
         instead of overflowing the screen on a phone. -->
    <div :class="['columns-row grid gap-4 grid-cols-1', ...responsiveColsClass((block.blocks_layout?.columns || []).length)]">
      <div v-for="columnId in (block.blocks_layout?.columns || [])" :key="columnId"
           :data-block-uid="columnId" data-block-add="right"
           class="column p-3 border border-dashed border-gray-300 rounded">
        <!-- Column title -->
        <h4 v-if="block.blocks?.[columnId]?.title" data-edit-text="title"
            class="column-title mb-2 text-sm font-medium">{{ block.blocks[columnId].title }}</h4>
        <!-- Column content blocks -->
        <Block v-for="item in expand(block.blocks?.[columnId]?.blocks_layout?.items || [], block.blocks?.[columnId]?.blocks || {})"
               :key="item['@uid']" :block_uid="item['@uid']" :block="item" :data="data" :contained="true" />
      </div>
    </div>
  </div>

  <!-- Generic section container — accepts any block type. Used by the
       container UX feature tests (wrap, unwrap, edge-drag, convert).
       Inner .section-body wrapper matches the vanilla test-frontend so
       cross-renderer tests can use the same selector. -->
  <!-- Callout: a labelled admonition (note/tip/warning/important); the body is
       the `items` region of child blocks, rendered recursively like section. -->
  <aside v-else-if="block['@type'] == 'callout'" :data-block-uid="block_uid"
         :class="`callout callout--${block.variation || 'note'}`"
         style="border-left: 4px solid #2563eb; background: #eff6ff; padding: 12px 16px; border-radius: 4px; margin: 1em 0;">
    <div class="callout__label" style="font-weight: 700; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.05em; margin-bottom: 4px;">
      {{ block.variation || 'note' }}
    </div>
    <Block v-for="childId in (block.blocks_layout?.items || [])"
           :key="childId"
           :block_uid="childId"
           :block="block.blocks?.[childId]"
           :data="data"
           :contained="true"
           class="my-1" />
  </aside>

  <div v-else-if="block['@type'] == 'section'" :data-block-uid="block_uid">
    <div class="section-body p-3 border border-dashed border-gray-500 rounded">
      <Block v-for="childId in (block.blocks_layout?.items || [])"
             :key="childId"
             :block_uid="childId"
             :block="block.blocks?.[childId]"
             :data="data"
             :contained="true"
             class="my-2" />
    </div>
  </div>

  <!-- Context navigation: delegates to ContextNavigationBlock which does
       the async listing-child expansion + level-from-URL-depth derivation
       inline (no recursive Block render for navItems). Wrapped in
       <Suspense> because expandListingBlocks fetches asynchronously. -->
  <Suspense v-else-if="block['@type'] == 'contextNavigation'">
    <!-- Key on child ids+types so the async setup re-runs when children change structurally
         (e.g. a seeded 'empty' is typed into a navItem in place). Without this the async
         setup's one-time result goes stale and the nav keeps showing the old children.
         ariaLabel/href edits stay reactive via props, so they don't force a re-mount. -->
    <ContextNavigationBlock :block-id="block_uid"
                            :key="(block.blocks_layout?.items || []).map((id) => (block.blocks?.[id]?.['@type'] || '?') + id).join('|')"
                            :block="block"
                            :api-url="effectiveApiUrl"
                            :context-path="effectiveContextPath" />
    <template #fallback>
      <nav :data-block-uid="block_uid" class="context-navigation">
        <ul role="list" class="context-navigation-list"></ul>
      </nav>
    </template>
  </Suspense>

  <div v-else-if="block['@type'] == 'teaser'"
    class="teaser-block max-w-sm bg-white border border-gray-200 rounded-lg shadow dark:bg-gray-800 dark:border-gray-700"
    :data-block-uid="block._blockUid || block_uid"
    :data-block-readonly="block.overwrite ? undefined : ''">
    <!-- Preview image: use block.preview_image if set, otherwise use target's image -->
    <!-- data-edit-link prevents navigation in edit mode, data-edit-media enables image picker overlay -->
    <NuxtLink :to="getUrl(block.href)" v-if="block.preview_image || hrefHasImage(block)" data-edit-link="href">
      <NuxtImg class="rounded-t-lg" data-edit-media="preview_image" v-if="block.preview_image" v-for="props in [imageProps(block.preview_image)]" :src="props.url" alt="" />
      <NuxtImg class="rounded-t-lg" data-edit-media="preview_image" v-else-if="hrefHasImage(block)" v-for="props in [imageProps(block.href[0])]" :src="props.url" alt="" />
    </NuxtLink>
    <div v-else data-edit-media="preview_image" class="rounded-t-lg bg-gray-200 flex items-center justify-center" style="height: 200px; cursor: pointer;">
      <span class="text-gray-400">Click to add image</span>
    </div>
    <div class="p-5">
      <!-- data-block-readonly on the wrapper controls editability — hydra.js respects it -->
      <!-- Key forces Vue to recreate element when overwrite changes (clears stale contenteditable text) -->
      <NuxtLink :to="getUrl(block.href)" v-if="getTeaserTitle(block)" data-edit-link="href">
        <div data-edit-text="head_title">{{ block.head_title }}</div>
        <h5 class="mb-2 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white"
          :key="`title-${block.overwrite}`"
          data-edit-text="title">{{ getTeaserTitle(block) }}</h5>
      </NuxtLink>
      <p class="mb-3 font-normal text-gray-700 dark:text-gray-400"
        :key="`description-${block.overwrite}`"
        data-edit-text="description"
        v-if="getTeaserDescription(block)">{{ getTeaserDescription(block) }}</p>
      <NuxtLink :to="getUrl(block.href)" data-edit-link="href"
        class="inline-flex items-center px-3 py-2 text-sm font-medium text-center text-white bg-blue-700 rounded-lg hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800">
        Read more
        <svg class="rtl:rotate-180 w-3.5 h-3.5 ms-2" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none"
          viewBox="0 0 14 10">
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M1 5h12m0 0L9 1m4 4L9 9" />
        </svg>
      </NuxtLink>
    </div>
  </div>

  <section ref="carouselRef" v-else-if="block['@type'] == 'slider'" :data-block-uid="block_uid" data-block-container="{allowed:['Slide'],add:'horizontal'}"
    class="max-w-4xl mx-auto" >
    <div class="relative w-full">
      <!-- Carousel wrapper -->
      <div class="relative h-56 overflow-hidden rounded-lg md:h-96">
        <template v-for="(entry, entryIdx) in sliderChildren" :key="entry.slide['@uid']">
          <!-- Listing child: async expand, each result becomes a slide -->
          <Suspense v-if="entry.isListing" @resolve="onListingResolved">
            <ListingBlock :id="entry.slide['@uid']" :block="entry.slide"
              :paging="{ start: 0, size: 1000 }"
              :api-url="effectiveApiUrl" :context-path="effectiveContextPath">
              <template #default="{ items }">
                <template v-for="(item, itemIdx) in trackItems(entry.slide['@uid'], items)" :key="item['@uid']">
                  <template v-if="item.readOnly"><!-- hydra block-readonly --></template>
                  <div class="slide bg-center items-center absolute inset-0"
                    :class="slideClasses(slideOffset(entryIdx) + itemIdx)"
                    :data-block-uid="item['@uid']" data-block-readonly
                    data-carousel-item data-block-add="right">
                    <Block :block_uid="undefined" :block="item" :data="data" :contained="true" :is-in-listing="true" />
                  </div>
                </template>
              </template>
            </ListingBlock>
            <template #fallback>
              <div class="slide absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-700" data-carousel-item></div>
            </template>
          </Suspense>
          <!-- Static slide -->
          <div v-else :data-block-uid="entry.slide['@uid']"
            class="slide bg-center items-center absolute inset-0"
            :class="[
              slideClasses(slideOffset(entryIdx)),
              { 'bg-gray-700': !entry.slide.preview_image, 'bg-blend-multiply': !entry.slide.preview_image, 'bg-no-repeat': !entry.slide.preview_image, 'bg-cover': entry.slide.preview_image }
            ]"
            data-carousel-item
            :style="entry.slide.preview_image ? imageProps(entry.slide, true).class : ''"
            data-block-add="right">
            <!-- Clickable overlay for editing the slide's image. WHICH field that
                 is depends on the slide: a teaser-ish slide carries
                 preview_image, but a slide that is an image block carries `url`,
                 and hardcoding preview_image left image slides with no edit
                 target at all — uneditable wherever a slider held one. -->
            <div :data-edit-media="entry.slide['@type'] === 'image' ? 'url' : 'preview_image'"
                 class="absolute inset-0 cursor-pointer" style="z-index: 1;"></div>
            <div
              class="max-w-sm p-6 bg-slate-200/90 border border-gray-200 m-12 rounded-lg shadow dark:bg-gray-800 dark:border-gray-700 absolute"
              :class="{ 'right-0': entry.slide.flagAlign == 'right' }" style="z-index: 2;">
              <!-- Annotate the field only when the slide has it. A slider holds
                   blocks, and they disagree about their fields: an `image` slide
                   is {url, alt} and its schema declares no head_title at all, so
                   annotating one unconditionally advertised a field that does not
                   exist. Hydra rightly refuses to make it editable, and the author
                   is left with a "Click to edit" placeholder that never does.
                   (Issue #296: no data ⇒ no element. The mock frontend's slide
                   renderer already guards this the same way.) -->
              <div v-if="entry.slide.head_title" data-edit-text="head_title">{{ entry.slide.head_title }}</div>
              <h5 :id="`heading-${entry.slide['@uid']}`"
                class="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white" data-edit-text="title">
                {{ entry.slide.title }}</h5>
              <p class="mb-3 font-normal text-gray-700 dark:text-gray-400" data-edit-text="description">
                {{ entry.slide.description }}</p>
              <NuxtLink v-if="entry.slide.href" :to="getUrl(entry.slide.href[0])" data-edit-text="buttonText" data-edit-link="href"
                class="inline-flex items-center px-3 py-2 text-sm font-medium text-center text-white bg-blue-700 rounded-lg hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                :aria-describedby="`heading-${entry.slide['@uid']}`">
                {{ entry.slide.buttonText }}</NuxtLink>
              <!-- Same rule as head_title above. Without a href there is still a
                   button worth showing if it has a label, but a slide with
                   neither gets no <a> at all — an image slide has no buttonText
                   in its schema either, so the annotation was another promise of
                   editing that could not be kept. The literal 'Read More' hid
                   this by making an empty field look full. -->
              <a v-else-if="entry.slide.buttonText" href="#" data-edit-text="buttonText" data-edit-link="href"
                class="inline-flex items-center px-3 py-2 text-sm font-medium text-center text-white bg-blue-700 rounded-lg hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                :aria-describedby="`heading-${entry.slide['@uid']}`">
                {{ entry.slide.buttonText }}</a>
            </div>
          </div>
        </template>
      </div>
      <!-- Slider indicators -->
      <div class="absolute z-30 flex -translate-x-1/2 bottom-5 left-1/2 space-x-3 rtl:space-x-reverse">
        <button v-for="(entry, index) in sliderChildren" :key="entry.slide['@uid']" type="button" class="w-3 h-3 rounded-full" aria-current="true"
          :aria-label="`Slide ${index + 1}`" :data-carousel-slide-to="index" :data-block-selector="entry.slide['@uid']"></button>
      </div>
      <!-- Slider controls -->
      <button type="button"
        class="absolute top-0 start-0 z-30 flex items-center justify-center h-full px-4 cursor-pointer group focus:outline-none"
        data-carousel-prev data-block-selector="-1">
        <span
          class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/30 dark:bg-gray-800/30 group-hover:bg-white/50 dark:group-hover:bg-gray-800/60 group-focus:ring-4 group-focus:ring-white dark:group-focus:ring-gray-800/70 group-focus:outline-none">
          <svg class="w-4 h-4 text-white dark:text-gray-800 rtl:rotate-180" aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 6 10">
            <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M5 1 1 5l4 4" />
          </svg>
          <span class="sr-only">Previous</span>
        </span>
      </button>
      <button type="button"
        class="absolute top-0 end-0 z-30 flex items-center justify-center h-full px-4 cursor-pointer group focus:outline-none"
        data-carousel-next data-block-selector="+1">
        <span
          class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/30 dark:bg-gray-800/30 group-hover:bg-white/50 dark:group-hover:bg-gray-800/60 group-focus:ring-4 group-focus:ring-white dark:group-focus:ring-gray-800/70 group-focus:outline-none">
          <svg class="w-4 h-4 text-white dark:text-gray-800 rtl:rotate-180" aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 6 10">
            <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="m1 9 4-4-4-4" />
          </svg>
          <span class="sr-only">Next</span>
        </span>
      </button>
    </div>
  </section>



  <div v-else-if="block['@type'] == 'separator'" :data-block-uid="block_uid"
       :class="['my-6', {
           'mx-auto max-w-xs': block.styles?.align === 'center',
           'mr-auto max-w-xs': block.styles?.align === 'left'
       }]">
    <hr v-if="!block.styles?.noLine" class="border-gray-300" />
    <div v-else class="py-4"></div>
  </div>



  <AccordionBlock v-else-if="block['@type'] == 'accordion'" :block_uid="block_uid" :block="block" :data="data" />



  <!-- Listing block: async expansion with own paging (or shared paging from container) -->
  <Suspense v-else-if="LISTING_TYPES.includes(block['@type'])" :key="`listing-${block_uid}-pg${injectedPages[block_uid] || 0}-${JSON.stringify(block)}`">
    <ListingBlock :id="block_uid" :block="block" :paging="paging"
      :api-url="effectiveApiUrl" :context-path="effectiveContextPath">
      <template #default="{ items }">
        <template v-for="item in items" :key="item['@uid']">
          <template v-if="item.readOnly"><!-- hydra block-readonly --></template>
          <Block :block_uid="item['@uid']" :block="item" :data="data" :contained="contained" :is-in-listing="true" />
        </template>
      </template>
    </ListingBlock>
    <template #fallback>
      <div style="display: contents" class="animate-pulse">
        <div v-for="i in 3" :key="i" :data-block-uid="block_uid"
             class="bg-gray-200 dark:bg-gray-700 h-48 rounded"></div>
      </div>
    </template>
  </Suspense>

  <!-- Search block: container with facets (object_list) and listing child -->
  <!-- Variations: facetsLeftSide, facetsRightSide, facetsTopSide (default) -->
  <div v-else-if="block['@type'] == 'search'" :data-block-uid="block_uid" class="search-block">
    <!-- Headline -->
    <h2 v-if="block.headline" data-edit-text="headline" class="text-2xl font-bold mb-4">{{ block.headline }}</h2>

    <!-- Search controls -->
    <div v-if="block.showSearchInput" class="search-controls mb-4">
      <form class="search-form flex gap-2" @submit.prevent="handleSearchSubmit">
        <!-- The input says WHAT to type, the button says WHICH block that
             reveals (data-block-selector-input): the quick-answer region only
             exists once a question has been asked, so the editor reveals it by
             asking. -->
        <input type="text" name="SearchableText" placeholder="Search..." :value="currentSearchText"
          :data-block-selector="quickAnswerUid(block) || null"
          :data-block-selector-input="quickAnswerUid(block) && block.quickAnswerSample ? block.quickAnswerSample : null"
          class="search-input-field flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
        <button type="submit"
          :data-block-selector="quickAnswerUid(block) || null"
          class="search-submit-button px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Search
        </button>
      </form>
    </div>

    <!-- Rendered only once a question has been asked (URL-driven, like the
         search itself). -->
    <div v-if="quickAnswerUid(block) && block.blocks?.[quickAnswerUid(block)] && currentSearchText"
      :data-block-uid="quickAnswerUid(block)" class="quick-answer my-4 p-3 bg-blue-50 rounded-lg">
      <div data-edit-text="answer">{{ block.blocks[quickAnswerUid(block)].answer || '' }}</div>
    </div>

    <!-- Facets on top (default or facetsTopSide) -->
    <template v-if="!block.variation || block.variation === 'facetsTopSide'">
      <!-- Facets horizontal -->
      <h3 v-if="block.facetsTitle" data-edit-text="facetsTitle" class="font-semibold mb-3 text-gray-700">{{ block.facetsTitle }}</h3>
      <div v-if="block.facets?.length" class="search-facets mb-4 p-4 bg-gray-50 rounded-lg flex flex-wrap gap-4">
        <template v-for="(facet, idx) in expand(block.facets, null, '@id')" :key="facet['@uid'] || idx">
          <!-- Non-facet types (slate, image) rendered as generic blocks -->
          <template v-if="facet.type === 'slate' || facet.type === 'image'">
            <div :data-block-uid="facet['@uid']" data-block-add="bottom" class="p-3 border border-gray-200 rounded min-w-48">
              <Block :block="facet" :block_uid="facet['@uid']" :data="data" :api-url="effectiveApiUrl" />
            </div>
          </template>
          <!-- Facet types -->
          <div v-else :data-block-uid="facet['@uid']" :data-block-type="facet.type" data-block-add="bottom"
               class="facet-item p-3 border border-gray-200 rounded min-w-48">
            <div data-edit-text="title" class="facet-label font-medium text-sm mb-2">{{ facet.title }}</div>
            <template v-if="facet.type === 'selectFacet'">
              <select class="facet-select w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      :data-field="getFacetField(facet)" @change="handleFacetSelectChange" data-linkable-allow>
                <option value="">Select...</option>
                <option v-for="opt in getFacetOptions(facet)" :key="opt.value" :value="opt.value">{{ opt.title }}</option>
              </select>
            </template>
            <template v-else-if="facet.type === 'daterangeFacet'">
              <div class="facet-daterange flex gap-2 mt-1">
                <input type="date" class="px-2 py-1 border border-gray-300 rounded text-sm" />
                <span class="text-gray-400">—</span>
                <input type="date" class="px-2 py-1 border border-gray-300 rounded text-sm" />
              </div>
            </template>
            <template v-else-if="facet.type === 'toggleFacet'">
              <div class="facet-toggle mt-1">
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" class="rounded border-gray-300" />
                  {{ getFacetOptions(facet)?.[0]?.title || 'Toggle' }}
                </label>
              </div>
            </template>
            <template v-else>
              <div class="facet-checkboxes space-y-1" data-linkable-allow>
                <label v-for="opt in getFacetOptions(facet)" :key="opt.value" class="flex items-center gap-2 text-sm">
                  <input type="checkbox" :value="opt.value" class="facet-checkbox rounded border-gray-300"
                         :data-field="getFacetField(facet)" :checked="isFacetChecked(facet, opt.value)"
                         @change="handleFacetCheckboxChange" />
                  {{ opt.title }}
                </label>
              </div>
            </template>
          </div>
        </template>
      </div>

      <!-- Sort and results count -->
      <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
        <p v-if="block.showTotalResults && getListingTotalResults(block)" class="text-gray-600">
          {{ getListingTotalResults(block) }} results
        </p>
        <div v-if="block.showSortOn && block.sortOnOptions?.length" class="search-sort">
          <label class="text-sm text-gray-600 mr-2">Sort by:</label>
          <select class="px-3 py-1 border border-gray-300 rounded text-sm" @change="handleSortChange" data-linkable-allow>
            <option v-for="opt in block.sortOnOptions" :key="opt" :value="opt">{{ opt }}</option>
          </select>
        </div>
      </div>

      <!-- Results -->
      <div class="search-results">
        <Block v-for="item in expand(block.blocks_layout?.listing || [], block.blocks || {})"
               :key="item['@uid']" :block_uid="item['@uid']" :block="item" :data="data" />
      </div>
    </template>

    <!-- Facets on left or right side -->
    <template v-else-if="block.variation === 'facetsLeftSide' || block.variation === 'facetsRightSide'">
      <div class="flex flex-col md:flex-row gap-6" :class="{ 'md:flex-row-reverse': block.variation === 'facetsRightSide' }">
        <!-- Sidebar: facets -->
        <aside v-if="block.facets?.length" class="search-facets w-full md:w-64 shrink-0">
          <div class="p-4 bg-gray-50 rounded-lg sticky top-4">
            <h3 v-if="block.facetsTitle" data-edit-text="facetsTitle" class="font-semibold mb-3 text-gray-700">{{ block.facetsTitle }}</h3>
            <template v-for="(facet, idx) in expand(block.facets, null, '@id')" :key="facet['@uid'] || idx">
              <!-- Non-facet types (slate, image) rendered as generic blocks -->
              <template v-if="facet.type === 'slate' || facet.type === 'image'">
                <div :data-block-uid="facet['@uid']" data-block-add="bottom"
                     class="mb-4 pb-4 border-b border-gray-200 last:border-0 last:mb-0 last:pb-0">
                  <Block :block="facet" :block_uid="facet['@uid']" :data="data" :api-url="effectiveApiUrl" />
                </div>
              </template>
              <!-- Facet types -->
              <div v-else :data-block-uid="facet['@uid']" :data-block-type="facet.type" data-block-add="bottom"
                   class="facet-item mb-4 pb-4 border-b border-gray-200 last:border-0 last:mb-0 last:pb-0">
                <div data-edit-text="title" class="facet-label font-medium text-sm mb-2">{{ facet.title }}</div>
                <template v-if="facet.type === 'selectFacet'">
                  <select class="facet-select w-full px-3 py-2 border border-gray-300 rounded text-sm"
                          :data-field="getFacetField(facet)" @change="handleFacetSelectChange" data-linkable-allow>
                    <option value="">Select...</option>
                    <option v-for="opt in getFacetOptions(facet)" :key="opt.value" :value="opt.value">{{ opt.title }}</option>
                  </select>
                </template>
                <template v-else-if="facet.type === 'daterangeFacet'">
                  <div class="facet-daterange flex gap-2 mt-1">
                    <input type="date" class="px-2 py-1 border border-gray-300 rounded text-sm" />
                    <span class="text-gray-400">—</span>
                    <input type="date" class="px-2 py-1 border border-gray-300 rounded text-sm" />
                  </div>
                </template>
                <template v-else-if="facet.type === 'toggleFacet'">
                  <div class="facet-toggle mt-1">
                    <label class="flex items-center gap-2 text-sm">
                      <input type="checkbox" class="rounded border-gray-300" />
                      {{ getFacetOptions(facet)?.[0]?.title || 'Toggle' }}
                    </label>
                  </div>
                </template>
                <template v-else>
                  <div class="facet-checkboxes space-y-1" data-linkable-allow>
                    <label v-for="opt in getFacetOptions(facet)" :key="opt.value" class="flex items-center gap-2 text-sm">
                      <input type="checkbox" :value="opt.value" class="facet-checkbox rounded border-gray-300"
                             :data-field="getFacetField(facet)" :checked="isFacetChecked(facet, opt.value)"
                             @change="handleFacetCheckboxChange" />
                      {{ opt.title }}
                    </label>
                  </div>
                </template>
              </div>
            </template>
          </div>
        </aside>

        <!-- Main: results -->
        <div class="search-results flex-1">
          <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
            <p v-if="block.showTotalResults && getListingTotalResults(block)" class="text-gray-600">
              {{ getListingTotalResults(block) }} results
            </p>
            <div v-if="block.showSortOn && block.sortOnOptions?.length" class="search-sort">
              <label class="text-sm text-gray-600 mr-2">Sort by:</label>
              <select class="px-3 py-1 border border-gray-300 rounded text-sm" @change="handleSortChange" data-linkable-allow>
                <option v-for="opt in block.sortOnOptions" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </div>
          </div>
          <Block v-for="item in expand(block.blocks_layout?.listing || [], block.blocks || {})"
                 :key="item['@uid']" :block_uid="item['@uid']" :block="item" :data="data" />
        </div>
      </div>
    </template>
  </div>

  <component v-else-if="block['@type'] == 'heading'" :is="block.tag || 'h2'"
    :data-block-uid="block_uid" data-edit-text="heading"
    :class="{ 'text-center': block.alignment === 'center', 'text-right': block.alignment === 'right' }">
    {{ block.heading }}
  </component>

  <div v-else-if="block['@type'] == 'slateTable'" class="data-table" :data-block-uid="block_uid">
    <table>
      <tr v-for="(row) in expand(block.table?.rows, null, 'key')" :key="row['@uid']" :data-block-uid="row['@uid']" data-block-add="bottom">
        <component
          v-for="(cell) in expand(row.cells, null, 'key')"
          :key="cell['@uid']"
          :is="(cell.type == 'header') ? 'th' : 'td'"
          :data-block-uid="cell['@uid']"
          data-block-add="right"
          data-edit-text="value"
        >
          <!-- data-edit-text on the CELL (one editable value field), like the
               slate block's wrapper — not on each node, which exposed N fields
               per cell and broke the DOM→slate round-trip. -->
          <RichText v-for="(node, idx) in cell.value" :key="idx" :node="node" />
        </component>
      </tr>
    </table>
  </div>

  <!-- objectBlocks: fields grouped under a widget:'object' (#245). The headline
       (slate) and href (link) live directly on block.content; the body is a
       blocks_layout region nested at block.content.blocks_layout.body over the
       object's own blocks dict (block.content.blocks). Field paths use the
       `content/...` object-descent form. -->
  <div v-else-if="block['@type'] == 'objectBlocks'" :data-block-uid="block_uid" class="object-blocks-block my-4">
    <h3 v-if="(block.content?.headline || []).length" class="ob-headline" data-edit-text="content/headline">
      <RichText v-for="node in block.content?.headline || []" :key="node" :node="node" />
    </h3>
    <a v-if="block.content?.href !== undefined" class="ob-link"
       data-edit-link="content/href" :href="block.content?.href || '#'">Object link</a>
    <div class="object-blocks-body">
      <Block v-for="item in expand(block.content?.blocks_layout?.body || [], block.content?.blocks || {})"
             :key="item['@uid']" :block_uid="item['@uid']" :block="item" :data="data"
             :contained="true" data-block-add="bottom" />
    </div>
  </div>

  <div v-else-if="block['@type'] == 'button'" :data-block-uid="block_uid"
       :class="['my-4', {
           'text-center': block.inneralign === 'center',
           'text-right': block.inneralign === 'right'
       }]">
    <!-- data-edit-link marks the link editable AND tells hydra.js to
         intercept the click in edit mode so it selects/edits instead of
         navigating away. -->
    <NuxtLink :to="getUrl(block.href)"
      class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 dark:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none dark:focus:ring-blue-800"
      data-edit-link="href">
      <span data-edit-text="title">{{ block.title || 'Read more' }}</span>
    </NuxtLink>
  </div>

  <div v-else-if="block['@type'] == 'video'" :data-block-uid="block_uid" class="my-4">
    <div v-if="getYouTubeId(block.url)" class="relative w-full pb-[56.25%]">
      <iframe class="absolute inset-0 w-full h-full rounded-lg"
          :src="`https://www.youtube.com/embed/${getYouTubeId(block.url)}`"
          frameborder="0" allowfullscreen></iframe>
    </div>
    <video v-else-if="block.url"
           class="w-full h-auto max-w-full rounded-lg"
           data-edit-media="url"
           :controls="block.controls !== false"
           :autoplay="!!block.autoplay"
           :loop="!!block.loop"
           :muted="!!block.muted || !!block.autoplay"
           playsinline>
      <source :src="getVideoSrc(block.url)" type="video/mp4">
    </video>
  </div>

  <section v-else-if="block['@type'] == 'highlight'" :data-block-uid="block_uid"
           class="relative overflow-hidden rounded-lg my-6 isolate">
    <!-- data-edit-media on BOTH branches: the field has to be pickable when it
         is empty (that is how you set one) as well as when it is filled. -->
    <div v-if="imageProps(block.image).url"
         class="absolute inset-0 bg-cover bg-center z-0"
         data-edit-media="image"
         :style="{ backgroundImage: `url(${imageProps(block.image).url})` }" />
    <div v-else class="absolute inset-0 z-0" data-edit-media="image"
         :class="highlightGradient(block.styles?.descriptionColor)"></div>
    <div class="absolute inset-0 bg-black/50 z-10"></div>
    <div class="relative z-20 py-16 px-4 mx-auto max-w-screen-xl text-center lg:py-24">
      <h2 data-edit-text="title" class="mb-4 text-4xl font-extrabold text-white md:text-5xl lg:text-6xl">
        {{ block.title }}</h2>
      <div data-edit-text="description" class="mb-8 text-lg text-gray-200 lg:text-xl sm:px-16 lg:px-48">
        <RichText v-for="node in (block.description || block['value'] || [])" :key="node" :node="node" />
      </div>
      <NuxtLink v-if="block.cta_title" :to="getUrl(block.cta_link)"
          data-edit-text="cta_title" data-edit-link="cta_link"
          class="py-3 px-5 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800">
        {{ block.cta_title }}
      </NuxtLink>
    </div>
  </section>

  <!-- Table of Contents block -->
  <nav v-else-if="block['@type'] == 'toc'" :data-block-uid="block_uid" class="toc-block my-6 p-4 bg-gray-50 rounded-lg">
    <h3 class="text-lg font-semibold mb-2">Table of Contents</h3>
    <ul v-if="tocEntries.length" class="list-disc pl-5 space-y-1">
      <li v-for="e in tocEntries" :key="e.id" :style="{ marginLeft: (e.level - 2) * 1.5 + 'em' }">
        <a :href="`#${e.id}`" class="text-blue-600 hover:underline">{{ e.text }}</a>
      </li>
    </ul>
    <p v-else class="text-gray-400 italic">No headings found</p>
  </nav>

  <!-- Default listing item: title + description -->
  <div v-else-if="block['@type'] == 'default'" :data-block-uid="block_uid"
       class="default-item-block py-4 border-b border-gray-200 hover:bg-gray-50 transition-colors">
    <NuxtLink :to="getUrl(block.href)" class="text-decoration-none" data-edit-link="href">
      <h4 class="mb-1 text-lg font-semibold text-gray-900 dark:text-white" data-edit-text="title">{{ block.title }}</h4>
    </NuxtLink>
    <p v-if="block.description" class="text-gray-600 dark:text-gray-400 text-sm" data-edit-text="description">{{ block.description }}</p>
  </div>

  <!-- Summary listing item: image thumbnail + title + description -->
  <div v-else-if="block['@type'] == 'summary'" :data-block-uid="block_uid"
       class="summary-item-block py-4 border-b border-gray-200 flex items-start gap-4 hover:bg-gray-50 transition-colors">
    <template v-if="block.image" v-for="props in [imageProps(block.image)]" :key="props.url">
      <NuxtImg v-if="props.url" :src="props.url" alt="" data-edit-media="image"
        class="w-32 h-24 object-cover rounded shrink-0" />
    </template>
    <div class="flex-1">
      <time v-if="block.date" class="block text-xs font-bold uppercase tracking-wide text-gray-800 mb-1">{{ new Date(block.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }}</time>
      <NuxtLink :to="getUrl(block.href)" class="text-decoration-none" data-edit-link="href">
        <h4 class="mb-1 text-lg font-semibold text-gray-900 dark:text-white" data-edit-text="title">{{ block.title }}</h4>
      </NuxtLink>
      <p v-if="block.description" class="text-gray-600 dark:text-gray-400 text-sm" data-edit-text="description">{{ block.description }}</p>
    </div>
  </div>

  <!-- Form block: renders subblocks as form fields, POSTs to /@submit-form -->
  <div v-else-if="block['@type'] == 'form'" :data-block-uid="block_uid" class="form-block my-6">
    <h3 v-if="block.title" data-edit-text="title" class="text-xl font-semibold mb-4">{{ block.title }}</h3>
    <div v-if="formState[block_uid]?.success" class="form-success p-4 bg-green-50 text-green-800 rounded-lg mb-4">
      {{ block.send_message || 'Form submitted successfully.' }}
    </div>
    <form v-else @submit.prevent="handleFormSubmit($event, block)" novalidate class="space-y-4">
      <template v-for="field in expand(block.subblocks, null, 'field_id')" :key="field['@uid']">
        <div :data-block-uid="field['@uid']" :data-block-type="field.field_type" data-block-add="bottom"
             class="form-field">
          <!-- Text -->
          <template v-if="field.field_type === 'text'">
            <label class="block text-sm font-medium text-gray-700 mb-1" data-edit-text="label">
              {{ field.label }}<span v-if="field.required" class="text-red-500 ml-0.5">*</span>
            </label>
            <p v-if="field.description" class="text-xs text-gray-500 mb-1">{{ field.description }}</p>
            <input type="text" :name="field.field_id" :value="getFormValue(block_uid, field.field_id)"
                   @input="setFormValue(block_uid, field.field_id, $event.target.value)"
                   :class="['w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                            formFieldError(block_uid, field.field_id) ? 'border-red-500' : 'border-gray-300']" />
            <p v-if="formFieldError(block_uid, field.field_id)" class="form-error text-red-500 text-xs mt-1">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Textarea -->
          <template v-else-if="field.field_type === 'textarea'">
            <label class="block text-sm font-medium text-gray-700 mb-1" data-edit-text="label">
              {{ field.label }}<span v-if="field.required" class="text-red-500 ml-0.5">*</span>
            </label>
            <p v-if="field.description" class="text-xs text-gray-500 mb-1">{{ field.description }}</p>
            <textarea :name="field.field_id" rows="4" :value="getFormValue(block_uid, field.field_id)"
                      @input="setFormValue(block_uid, field.field_id, $event.target.value)"
                      :class="['w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                               formFieldError(block_uid, field.field_id) ? 'border-red-500' : 'border-gray-300']"></textarea>
            <p v-if="formFieldError(block_uid, field.field_id)" class="form-error text-red-500 text-xs mt-1">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Number -->
          <template v-else-if="field.field_type === 'number'">
            <label class="block text-sm font-medium text-gray-700 mb-1" data-edit-text="label">
              {{ field.label }}<span v-if="field.required" class="text-red-500 ml-0.5">*</span>
            </label>
            <p v-if="field.description" class="text-xs text-gray-500 mb-1">{{ field.description }}</p>
            <input type="number" :name="field.field_id" :value="getFormValue(block_uid, field.field_id)"
                   @input="setFormValue(block_uid, field.field_id, $event.target.value)"
                   :class="['w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                            formFieldError(block_uid, field.field_id) ? 'border-red-500' : 'border-gray-300']" />
            <p v-if="formFieldError(block_uid, field.field_id)" class="form-error text-red-500 text-xs mt-1">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Select (List) -->
          <template v-else-if="field.field_type === 'select'">
            <label class="block text-sm font-medium text-gray-700 mb-1" data-edit-text="label">
              {{ field.label }}<span v-if="field.required" class="text-red-500 ml-0.5">*</span>
            </label>
            <p v-if="field.description" class="text-xs text-gray-500 mb-1">{{ field.description }}</p>
            <select :name="field.field_id" :value="getFormValue(block_uid, field.field_id)"
                    @change="setFormValue(block_uid, field.field_id, $event.target.value)"
                    :class="['w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                             formFieldError(block_uid, field.field_id) ? 'border-red-500' : 'border-gray-300']">
              <option value="">Select...</option>
              <option v-for="opt in field.input_values" :key="opt" :value="opt">{{ opt }}</option>
            </select>
            <p v-if="formFieldError(block_uid, field.field_id)" class="form-error text-red-500 text-xs mt-1">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Single Choice (Radio) -->
          <template v-else-if="field.field_type === 'single_choice'">
            <fieldset>
              <legend class="block text-sm font-medium text-gray-700 mb-1" data-edit-text="label">
                {{ field.label }}<span v-if="field.required" class="text-red-500 ml-0.5">*</span>
              </legend>
              <p v-if="field.description" class="text-xs text-gray-500 mb-1">{{ field.description }}</p>
              <div class="space-y-1">
                <label v-for="opt in field.input_values" :key="opt" class="flex items-center gap-2 text-sm">
                  <input type="radio" :name="field.field_id" :value="opt"
                         :checked="getFormValue(block_uid, field.field_id) === opt"
                         @change="setFormValue(block_uid, field.field_id, opt)" class="border-gray-300" />
                  {{ opt }}
                </label>
              </div>
              <p v-if="formFieldError(block_uid, field.field_id)" class="form-error text-red-500 text-xs mt-1">{{ formFieldError(block_uid, field.field_id) }}</p>
            </fieldset>
          </template>
          <!-- Multiple Choice (Checkboxes) -->
          <template v-else-if="field.field_type === 'multiple_choice'">
            <fieldset>
              <legend class="block text-sm font-medium text-gray-700 mb-1" data-edit-text="label">
                {{ field.label }}<span v-if="field.required" class="text-red-500 ml-0.5">*</span>
              </legend>
              <p v-if="field.description" class="text-xs text-gray-500 mb-1">{{ field.description }}</p>
              <div class="space-y-1">
                <label v-for="opt in field.input_values" :key="opt" class="flex items-center gap-2 text-sm">
                  <input type="checkbox" :name="field.field_id" :value="opt"
                         :checked="(getFormValue(block_uid, field.field_id) || []).includes(opt)"
                         @change="toggleMultiChoice(block_uid, field.field_id, opt, $event.target.checked)"
                         class="rounded border-gray-300" />
                  {{ opt }}
                </label>
              </div>
              <p v-if="formFieldError(block_uid, field.field_id)" class="form-error text-red-500 text-xs mt-1">{{ formFieldError(block_uid, field.field_id) }}</p>
            </fieldset>
          </template>
          <!-- Checkbox -->
          <template v-else-if="field.field_type === 'checkbox'">
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" :name="field.field_id"
                     :checked="!!getFormValue(block_uid, field.field_id)"
                     @change="setFormValue(block_uid, field.field_id, $event.target.checked)"
                     class="rounded border-gray-300" />
              <span data-edit-text="label">{{ field.label }}<span v-if="field.required" class="text-red-500 ml-0.5">*</span></span>
            </label>
            <p v-if="field.description" class="text-xs text-gray-500 mt-0.5">{{ field.description }}</p>
            <p v-if="formFieldError(block_uid, field.field_id)" class="form-error text-red-500 text-xs mt-1">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Date -->
          <template v-else-if="field.field_type === 'date'">
            <label class="block text-sm font-medium text-gray-700 mb-1" data-edit-text="label">
              {{ field.label }}<span v-if="field.required" class="text-red-500 ml-0.5">*</span>
            </label>
            <p v-if="field.description" class="text-xs text-gray-500 mb-1">{{ field.description }}</p>
            <input type="date" :name="field.field_id" :value="getFormValue(block_uid, field.field_id)"
                   @input="setFormValue(block_uid, field.field_id, $event.target.value)"
                   :class="['w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                            formFieldError(block_uid, field.field_id) ? 'border-red-500' : 'border-gray-300']" />
            <p v-if="formFieldError(block_uid, field.field_id)" class="form-error text-red-500 text-xs mt-1">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Email (from) -->
          <template v-else-if="field.field_type === 'from'">
            <label class="block text-sm font-medium text-gray-700 mb-1" data-edit-text="label">
              {{ field.label }}<span v-if="field.required" class="text-red-500 ml-0.5">*</span>
            </label>
            <p v-if="field.description" class="text-xs text-gray-500 mb-1">{{ field.description }}</p>
            <input type="email" :name="field.field_id" :value="getFormValue(block_uid, field.field_id)"
                   @input="setFormValue(block_uid, field.field_id, $event.target.value)"
                   :class="['w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                            formFieldError(block_uid, field.field_id) ? 'border-red-500' : 'border-gray-300']" />
            <p v-if="formFieldError(block_uid, field.field_id)" class="form-error text-red-500 text-xs mt-1">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Attachment -->
          <template v-else-if="field.field_type === 'attachment'">
            <label class="block text-sm font-medium text-gray-700 mb-1" data-edit-text="label">
              {{ field.label }}<span v-if="field.required" class="text-red-500 ml-0.5">*</span>
            </label>
            <p v-if="field.description" class="text-xs text-gray-500 mb-1">{{ field.description }}</p>
            <input type="file" :name="field.field_id"
                   @change="setFormValue(block_uid, field.field_id, $event.target.files?.[0]?.name || '')"
                   class="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
            <p v-if="formFieldError(block_uid, field.field_id)" class="form-error text-red-500 text-xs mt-1">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Static text -->
          <template v-else-if="field.field_type === 'static_text'">
            <div class="text-sm text-gray-600">
              <strong v-if="field.label" data-edit-text="label">{{ field.label }}</strong>
              <p v-if="field.description">{{ field.description }}</p>
            </div>
          </template>
          <!-- Hidden -->
          <template v-else-if="field.field_type === 'hidden'">
            <input type="hidden" :name="field.field_id" :value="field.value || ''" />
            <!-- A hidden field has no visual form, so the block had no size: the
                 author saw nothing on the page and had nothing to click, even
                 though the field is theirs to configure. Shown — marked as
                 hidden — only while editing, so a visitor's page carries no
                 trace of it. -->
            <div v-if="showHiddenFields" class="hidden-field-standin">
              <span class="hidden-field-badge">Hidden</span>
              <span data-edit-text="label">{{ field.label }}</span>
            </div>
          </template>
        </div>
      </template>
      <div class="flex gap-3 pt-2">
        <button type="submit" data-edit-text="submit_label"
                class="form-submit px-5 py-2.5 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 focus:ring-4 focus:ring-blue-300">
          {{ block.submit_label || 'Submit' }}
        </button>
        <button v-if="block.show_cancel" type="reset" data-edit-text="cancel_label"
                class="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
          {{ block.cancel_label || 'Cancel' }}
        </button>
      </div>
    </form>
  </div>

  <!-- Code example block: tabbed code with syntax highlighting -->
  <CodeExample v-else-if="block['@type'] == 'codeExample'" :block_uid="block_uid" :block="block" />

  <!-- Cookie consent: a bar, plus two halves built outside the block's element -->
  <CookieConsent v-else-if="block['@type'] == 'cookieConsent'" :block_uid="block_uid" :block="block" />

  <!-- Empty block - placeholder for deleted blocks in containers -->
  <div v-else-if="block['@type'] == 'empty'" :data-block-uid="block_uid" class="empty-block min-h-[60px]">
  </div>

  <!-- Event Metadata block: renders page-level event fields (start, end, location, contact) -->
  <div v-else-if="block['@type'] == 'eventMetadata'" :data-block-uid="block_uid"
       class="event-metadata my-6 p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm">
    <dl class="grid grid-cols-1 gap-2">
      <div v-if="data.start" class="flex gap-2">
        <dt class="font-semibold text-gray-600 min-w-24">When</dt>
        <dd>
          <span data-edit-text="/start">{{ formatDate(data.start) }}</span>
          <span v-if="data.end"> – <span data-edit-text="/end">{{ formatDate(data.end) }}</span></span>
        </dd>
      </div>
      <div v-if="data.location" class="flex gap-2">
        <dt class="font-semibold text-gray-600 min-w-24">Where</dt>
        <dd data-edit-text="/location">{{ data.location }}</dd>
      </div>
      <div v-if="data.event_url" class="flex gap-2">
        <dt class="font-semibold text-gray-600 min-w-24">Website</dt>
        <dd><a data-edit-link="/event_url" :href="data.event_url" class="text-blue-600 underline">{{ data.event_url }}</a></dd>
      </div>
      <div v-if="data.contact_name || data.contact_email || data.contact_phone" class="flex gap-2">
        <dt class="font-semibold text-gray-600 min-w-24">Contact</dt>
        <dd>
          <span v-if="data.contact_name" data-edit-text="/contact_name">{{ data.contact_name }}</span>
          <span v-if="data.contact_email"> · <a data-edit-link="/contact_email" :href="`mailto:${data.contact_email}`">{{ data.contact_email }}</a></span>
          <span v-if="data.contact_phone" data-edit-text="/contact_phone"> · {{ data.contact_phone }}</span>
        </dd>
      </div>
    </dl>
  </div>

  <!-- Social Links: auto-detects icons from URL domains -->
  <div v-else-if="block['@type'] == 'socialLinks'" :data-block-uid="block_uid"
       class="flex items-center justify-center gap-4 py-2">
    <span class="text-sm text-gray-500 dark:text-gray-400">Follow us:</span>
    <a v-for="link in expand(block.links || [], null, '@id')" :key="link['@uid']"
       :data-block-uid="link['@uid']" data-block-add="right"
       :href="link.url" target="_blank" rel="noopener"
       data-edit-link="url"
       :title="socialInfo(link.url).name"
       class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
      <span v-html="socialInfo(link.url).svg" />
    </a>
  </div>

  <!-- Maps block: Google Maps embed -->
  <div v-else-if="block['@type'] == 'maps'" :data-block-uid="block_uid"
       :class="['maps-block my-4', { 'mx-auto max-w-2xl': block.align === 'center', 'float-left mr-4': block.align === 'left', 'float-right ml-4': block.align === 'right' }]">
    <h3 v-if="block.title" data-edit-text="title" class="text-lg font-semibold mb-2">{{ block.title }}</h3>
    <iframe v-if="block.url" :src="block.url" data-edit-link="url"
      :class="{ 'w-full': block.align === 'full' || block.align === 'center', 'w-96': block.align === 'left' || block.align === 'right' }"
      height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
    <p v-else class="text-gray-400 italic">No map URL configured</p>
  </div>

  <div v-else :data-block-uid="block_uid" :data-unknown-block-type="block['@type']"
       class="my-2 px-3 py-2 border border-dashed border-gray-300 rounded text-gray-500 italic text-sm"
       style="min-height: 2.5rem;">
    [not implemented]
  </div>

</template>
<script setup>
import { ref, reactive, watch, watchEffect, nextTick, computed, toRefs, inject, onMounted, unref } from 'vue';
import { isEditMode } from '@hydra-js/hydra.js';
import { staticBlocks, expandTemplatesSync } from '@hydra-js/helpers';
import RichText from './richtext.vue';

// Inject page-level context for nested components
const injectedApiUrl = inject('apiUrl', '');
const injectedContextPath = inject('contextPath', '/');
const injectedTemplates = inject('templates', {});
// No default: templateState MUST be provided once at the page root and shared by
// every Block (top-level + nested). A default {} would give each component its own
// state, breaking nested-container recognition (the merge throws if it's missing).
const templateState = inject('templateState');
const injectedPages = inject('pages', {});

const props = defineProps({
  block_uid: {
    type: String,
    default: undefined
  },
  block: {
    type: Object,
    required: true
  },
  data: {
    type: Object,
    required: true
  },
  contained: {
    type: Boolean,
    required: false,
  },
  apiUrl: {
    type: String,
    required: false,
    default: ''
  },
  // Shared paging object (for combined paging in containers like gridBlock).
  // When null, listing blocks create and own their own paging.
  paging: {
    type: Object,
    default: null,
  },
  isInListing: {
    type: Boolean,
    default: false,
  }
});

// Use toRefs to maintain reactivity (destructuring props directly can lose reactivity in Vue 3)
const { block_uid, block, data, contained, apiUrl, isInListing } = toRefs(props);

const placeholderImage = '/placeholder.svg';


// Use prop apiUrl if provided, otherwise injected value
const effectiveApiUrl = computed(() => apiUrl.value || injectedApiUrl);
const effectiveContextPath = computed(() => {
  const pageId = data.value?.['@id'] || injectedContextPath;
  if (typeof pageId === 'string' && pageId.startsWith('http')) {
    return new URL(pageId).pathname;
  }
  return pageId;
});


const route = useRoute();

// Format an ISO date string for display (date + time)
function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Format a page-level date field, optionally including time
function formatDateField(dateStr, showTime) {
  if (!dateStr) return '';
  const opts = { year: 'numeric', month: 'long', day: 'numeric' };
  if (showTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return new Date(dateStr).toLocaleDateString(undefined, opts);
}

// Social links: map URL domains to SVG icons (24x24)
const SOCIAL_ICONS = {
  'github.com': {
    name: 'GitHub',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>',
  },
  'discord.gg': {
    name: 'Discord',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/></svg>',
  },
  'discord.com': {
    name: 'Discord',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/></svg>',
  },
  'plone.org': {
    name: 'Plone',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="16" text-anchor="middle" font-size="12" font-weight="bold" fill="currentColor">P</text></svg>',
  },
  'youtube.com': {
    name: 'YouTube',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
  },
  'mastodon.social': {
    name: 'Mastodon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.184 1.27-.39 1.774-.753a.057.057 0 0 0 .023-.043v-1.809a.052.052 0 0 0-.02-.041.053.053 0 0 0-.046-.01 20.282 20.282 0 0 1-4.709.547c-2.73 0-3.463-1.284-3.674-1.818a5.593 5.593 0 0 1-.319-1.433.053.053 0 0 1 .066-.054 19.648 19.648 0 0 0 4.636.536c.397 0 .794 0 1.192-.013 1.99-.059 4.088-.163 5.985-.67a.175.175 0 0 0 .023-.006c2.298-.665 4.48-2.688 4.623-7.828.006-.238.046-2.476.046-2.717 0-.833.31-5.907-.046-7.172zM19.903 13.24h-2.558v-5.9c0-1.243-.525-1.875-1.575-1.875-1.16 0-1.74.749-1.74 2.23v3.227h-2.544V7.695c0-1.481-.58-2.23-1.74-2.23-1.05 0-1.576.632-1.576 1.875v5.9H5.612V7.514c0-1.243.317-2.232.954-2.965.657-.733 1.517-1.108 2.584-1.108 1.234 0 2.17.474 2.795 1.423L12 4.958l.055.906c.625-.95 1.56-1.423 2.795-1.423 1.066 0 1.926.375 2.583 1.108.637.733.955 1.722.955 2.965v5.726z"/></svg>',
  },
  'x.com': {
    name: 'X',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  },
  'twitter.com': {
    name: 'X',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  },
  'bsky.app': {
    name: 'Bluesky',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.785 2.627 3.6 3.494 6.67 3.06-4.576.78-5.865 3.36-3.397 5.94 3.006 3.144 5.434-1.056 6.103-3.26.079-.26.114-.39.114-.26 0-.13.035 0 .114.26.669 2.204 3.097 6.404 6.103 3.26 2.468-2.58 1.179-5.16-3.397-5.94 3.07.434 5.885-.433 6.67-3.06.246-.828.624-5.79.624-6.479 0-.688-.139-1.86-.902-2.203-.66-.299-1.664-.621-4.3 1.24C12.046 4.747 9.087 8.686 8 10.8z"/></svg>',
  },
};
const DEFAULT_LINK_ICON = {
  name: 'Link',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
};

function socialInfo(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return SOCIAL_ICONS[hostname] || { ...DEFAULT_LINK_ICON, name: hostname };
  } catch {
    return DEFAULT_LINK_ICON;
  }
}

// Expand child blocks: wraps expandTemplatesSync with injected context
// For blocks dicts: expand(layout, blocks)
// For object_list arrays: expand(items, null, '@id')
// unref: `templates` is provided as a computed ref ([...slug].vue); the Vue-free
// merge does Object.keys(templates), which on a raw ref yields ComputedRefImpl
// internals → "template not found" 500. Unwrap to the plain object.
const expand = (layout, blocks, idField) => expandTemplatesSync(layout, {
  blocks, templateState, templates: unref(injectedTemplates),
  ...(idField && { idField }),
});

// Grid block: combined paging across all children (mirrors README Grid pattern)
// Reactive so ListingBlock can update totalPages etc. via Object.assign
const GRID_PAGE_SIZE = 6;
const gridPageFromUrl = computed(() => {
  const pages = injectedPages.value || injectedPages;
  return pages[block_uid.value] || 0;
});
const gridPaging = reactive({ start: 0, size: GRID_PAGE_SIZE });

const gridBuildPagingUrl = (page) => {
  if (page === 0) return effectiveContextPath.value;
  // Strip a trailing slash so a root context ("/") gives "/@pg_…" not "//@pg_…"
  // (the latter is protocol-relative — navigateTo would read it as an external host).
  return `${effectiveContextPath.value.replace(/\/+$/, '')}/@pg_${block_uid.value}_${page}`;
};

// Process grid children: listings marked for Suspense, static blocks filtered by paging window
// staticBlocks and expandListingBlocks return { items, paging } — chain paging.seen for position tracking
const LISTING_TYPES = ['listing', 'relatedItemsListing', 'searchShortcuts', 'rssFeed'];
// PURE computed — no side effects. staticBlocks/expandListingBlocks return
// { items, paging }; chain paging.seen for position tracking and surface the
// final static paging for the manual-grid case below.
const gridData = computed(() => {
  const layout = block.value.blocks_layout?.items || [];
  const blocks = block.value.blocks || {};
  const start = gridPageFromUrl.value * GRID_PAGE_SIZE;
  let seen = 0;
  let staticPaging = null;
  let hasListing = false;
  const children = layout.map(id => {
    const child = blocks[id];
    if (!child) return null;
    if (LISTING_TYPES.includes(child['@type'])) {
      hasListing = true;
      return { id, block: child, isListing: true, seen };
    }
    const result = staticBlocks([id], { blocks, paging: { start, size: GRID_PAGE_SIZE }, seen });
    seen = result.paging.seen;
    staticPaging = result.paging;
    return { id, block: child, isListing: false, items: result.items };
  }).filter(Boolean);
  return { children, staticPaging, hasListing };
});
const gridChildren = computed(() => gridData.value.children);
// The grid's paging comes from ONE of two sources, kept SEPARATE so neither is a
// side-effect of rendering the other (mutating gridPaging inside the children
// computed left the pager reading a stale, totalPages-less object on first paint,
// so it never rendered — and hydra had no +N control to reveal an off-page child):
//  - a manual-only grid: the static chain's final paging (staticBlocks already
//    computes totalPages/prev/next) IS the grid's paging, derived purely here;
//  - a grid WITH a listing: the trailing ListingBlock publishes the combined
//    total into the reactive `gridPaging` sink (it receives `seen`), so use that.
const effectiveGridPaging = computed(() => {
  if (gridData.value.hasListing) return gridPaging;
  const p = gridData.value.staticPaging;
  return p ? { ...p, size: GRID_PAGE_SIZE } : { start: gridPaging.start, size: GRID_PAGE_SIZE, totalPages: 0 };
});
// Keep the reactive sink's `start` current for the listing case (ListingBlock
// reads it to window its query). A watchEffect is the right home for this write —
// a computed must stay pure.
watchEffect(() => { gridPaging.start = gridPageFromUrl.value * GRID_PAGE_SIZE; });

// Slider: expand templates and detect listing blocks among slides
const sliderChildren = computed(() => {
  const slides = expand(block.value?.slides || [], null, '@id');
  return slides.map(slide => {
    if (LISTING_TYPES.includes(slide['@type'])) {
      return { slide, isListing: true };
    }
    return { slide, isListing: false };
  });
});

// Slider state: Vue-reactive carousel (no Flowbite — its imperative DOM classes
// conflict with Vue's reactive rendering on parent re-renders).
const carouselPosition = ref(0);
const carouselRef = ref(null);

// Map from listing slide @uid to resolved item count (for flat index calculation)
const listingItemCounts = reactive({});
function onListingResolved() {
  // Suspense @resolve callback — no action needed since trackItems() handles counts
}

// Total flat slide count (listing items expanded + static slides).
// Before listings resolve, each listing counts as 1 (its fallback placeholder).
const totalSlides = computed(() => {
  let count = 0;
  for (const entry of sliderChildren.value) {
    if (entry.isListing) {
      count += listingItemCounts[entry.slide['@uid']] || 1;
    } else {
      count++;
    }
  }
  return count;
});

// Compute the flat slide offset for a given entry index (sum of all prior entries' slide counts).
function slideOffset(entryIdx) {
  let offset = 0;
  for (let i = 0; i < entryIdx; i++) {
    const e = sliderChildren.value[i];
    if (e.isListing) {
      offset += listingItemCounts[e.slide['@uid']] || 1;
    } else {
      offset++;
    }
  }
  return offset;
}

// Track listing item counts when scoped slot renders (called from template).
// Uses nextTick to avoid mutating reactive state during render (Vue warns about this).
function trackItems(uid, items) {
  if (listingItemCounts[uid] !== items.length) {
    nextTick(() => { listingItemCounts[uid] = items.length; });
  }
  return items;
}

// CSS classes for a slide at the given flat index relative to carouselPosition.
// Mirrors Flowbite's 3-slide layout: left (-translate-x-full), center (translate-x-0), right (translate-x-full).
function slideClasses(index) {
  const pos = carouselPosition.value;
  const total = totalSlides.value;
  if (total === 0) return 'hidden';

  const prev = (pos - 1 + total) % total;
  const next = (pos + 1) % total;
  const t = useTransitions ? ' transition-transform transform duration-700 ease-linear' : '';

  if (index === pos) return `translate-x-0 z-30${t}`;
  if (index === prev) return `-translate-x-full z-10${t}`;
  if (index === next) return `translate-x-full z-20${t}`;
  return 'hidden';
}

// In edit mode, skip CSS transitions — admin data updates trigger Vue re-renders
// that conflict with in-progress CSS transform transitions, causing slides to
// animate to wrong positions. In visitor mode, transitions work fine.
const useTransitions = !isEditMode();

// Editing is a browser fact — isEditMode() reads window.name / ?_edit, and the
// server has neither — so this stays false through the first render and matches
// the HTML the server sent. Flipping it after mount is what adds the stand-in,
// which is why a visitor's page never contains one at all.
const showHiddenFields = ref(false);
onMounted(() => {
  showHiddenFields.value = isEditMode();
});

// Next/prev handlers — simple reactive position update, Vue handles the rest
function carouselNext() {
  const total = totalSlides.value;
  if (total > 0) {
    carouselPosition.value = (carouselPosition.value + 1) % total;
  }
}
function carouselPrev() {
  const total = totalSlides.value;
  if (total > 0) {
    carouselPosition.value = (carouselPosition.value - 1 + total) % total;
  }
}

// Navigate to a specific slide by its block UID (for indicator/direct selector clicks).
//
// The flat index depends on how many items each listing slide expanded to, and
// trackItems fills those counts on nextTick — so a request that arrives before
// a listing resolves counts it as 1 and lands short of the target. Remember the
// request and re-apply it whenever the counts change, so selecting a slide that
// sits after a listing settles on the right one instead of stopping wherever
// the counts happened to be.
const carouselTargetUid = ref(null);

function flatIndexOf(uid) {
  let idx = 0;
  for (const entry of sliderChildren.value) {
    if (entry.slide['@uid'] === uid) return idx;
    idx += entry.isListing ? listingItemCounts[entry.slide['@uid']] || 1 : 1;
  }
  return null;
}

function applyCarouselTarget() {
  const uid = carouselTargetUid.value;
  if (!uid) return;
  const idx = flatIndexOf(uid);
  if (idx !== null) carouselPosition.value = idx;
}

function carouselGoTo(uid) {
  carouselTargetUid.value = uid;
  applyCarouselTarget();
}

// Counts arrive asynchronously; re-apply the pending target when they do.
watch(listingItemCounts, applyCarouselTarget, { deep: true });

// On mount: attach click handlers for next/prev buttons and indicators
onMounted(() => {
  if (block.value?.['@type'] !== 'slider' || !process.client) return;
  const section = carouselRef.value;
  if (!section) return;

  // Use event delegation on the section — individual button elements may be replaced
  // by Vue re-renders (from admin data updates), losing directly-attached handlers.
  section.addEventListener('click', (event) => {
    const target = event.target.closest('[data-carousel-next], [data-carousel-prev], [data-carousel-slide-to]');
    if (!target) return;
    if (target.hasAttribute('data-carousel-next')) {
      carouselNext();
    } else if (target.hasAttribute('data-carousel-prev')) {
      carouselPrev();
    } else if (target.hasAttribute('data-carousel-slide-to')) {
      const uid = target.getAttribute('data-block-selector');
      if (uid) carouselGoTo(uid);
    }
  });
});

// Watch for slide count changes — when new slide added, show it
watch(
  () => block.value?.slides?.length,
  (newCount, oldCount) => {
    if (oldCount !== undefined && newCount > oldCount) {
      // New slide added at end — navigate to it.
      // Need to recalculate total since listing counts haven't changed.
      const total = totalSlides.value + (newCount - oldCount);
      carouselPosition.value = total - 1;
    }
  }
);

// Grid block helpers
const gridBgStyle = (block) => {
  const bg = block.styles?.backgroundColor;
  if (!bg || bg === 'white') return {};
  const colorMap = { grey: '#f1f5f9', blue: '#1d4ed8', red: '#b91c1c', green: '#15803d' };
  return { backgroundColor: colorMap[bg] || bg };
};

// Responsive column count for a row of N equal cells: one column on a phone
// (the base `grid-cols-1` on the element), then progressively more as the
// viewport grows, capped at the real count. Shared by the grid block and the
// columns block so both stack on mobile instead of overflowing the screen.
const responsiveColsClass = (count) => {
  const cols = Math.min(count || 4, 4);
  return [`sm:grid-cols-${Math.min(cols, 2)}`, `md:grid-cols-${Math.min(cols, 3)}`, `lg:grid-cols-${cols}`];
};

const gridColsClass = (block) => responsiveColsClass(block.blocks_layout?.items?.length);

// Helper to extract YouTube video ID from various URL formats
const getYouTubeId = (url) => {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/);
  return match?.[1] || null;
};

// Helper for the <video> src on Plone-hosted mp4s. A video block whose `url`
// is a Plone @id (starts with `/`) needs the API base URL prepended and a
// /@@download/file suffix to resolve to the actual binary; otherwise the
// browser tries to fetch the @id off the frontend host and 404s.
const getVideoSrc = (url) => {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  const runtimeConfig = useRuntimeConfig();
  const backendBaseUrl = runtimeConfig.public.backendBaseUrl;
  return `${backendBaseUrl}${url}/@@download/file`;
};

// Helper to get image URL from various formats (string, array, or object with @id)
// Also adds @@images/image suffix for Plone internal paths
const getImageUrl = (value) => {
  if (!value) return '';
  const runtimeConfig = useRuntimeConfig();
  const backendBaseUrl = runtimeConfig.public.backendBaseUrl;

  // Extract URL from array or object format (like getUrl does)
  let url = value;
  if (Array.isArray(value) && value.length) {
    url = value[0];
  }
  if (url?.['@id']) {
    url = url['@id'];
  }
  if (typeof url !== 'string') {
    return '';
  }

  // Add a SCALE suffix (`@@images/image/great`) for Plone internal paths, NOT the
  // bare `@@images/image` original. The bare form names `image` as a file, which
  // collides with the `image/<scale>` directory form other <img> srcsets use — IPX's
  // disk cache can't have `image` be both (EEXIST/ENOTDIR) and the bare original is
  // the large slow variant that hangs the SSG prerender. A named scale keeps `image`
  // a directory everywhere.
  const needsImageSuffix = !url.includes('@@images');
  const isRelativePath = url.startsWith('/');
  const isBackendUrl = backendBaseUrl && url.startsWith(backendBaseUrl);

  if (needsImageSuffix && (isRelativePath || isBackendUrl)) {
    // SVGs have no raster scales (Plone returns 0 bytes for a named scale → IPX 400),
    // so serve the original. Rasters use a named scale, never the bare `@@images/image`
    // original (which is slow/hangs and collides file-vs-dir with the scale form).
    const isSvg = /\.svg($|[?#])/i.test(url);
    return url + (isSvg ? '/@@images/image' : '/@@images/image/great');
  }
  return url;
};

// Map highlight descriptionColor styles to Tailwind gradient classes
const highlightGradient = (colorClass) => {
  const gradients = {
    'highlight-custom-color-1': 'bg-gradient-to-r from-blue-800 to-blue-600',
    'highlight-custom-color-2': 'bg-gradient-to-r from-emerald-800 to-emerald-600',
    'highlight-custom-color-3': 'bg-gradient-to-r from-purple-800 to-purple-600',
    'highlight-custom-color-4': 'bg-gradient-to-r from-amber-800 to-amber-600',
    'highlight-custom-color-5': 'bg-gradient-to-r from-rose-800 to-rose-600',
  };
  return gradients[colorClass] || gradients['highlight-custom-color-1'];
};

// Teaser helpers: use block data if overwrite is set OR if hrefObj has no content data
// This ensures listing-expanded teasers (which have block data but empty hrefObj) display correctly
// When overwrite is enabled but custom value not set yet, fall back to href value for editing
const getTeaserTitle = (block) => {
  const hrefObj = block.href?.[0];
  const hrefObjHasContentData = hrefObj?.title !== undefined;
  const useBlockData = block.overwrite || !hrefObjHasContentData;
  if (useBlockData) {
    // When customizing, use block title or fall back to href title for initial editing
    return block.title || hrefObj?.title || '';
  }
  return hrefObj?.title || '';
};

// A teaser target has a usable image only when its summary carries image_scales
// for its image_field. Plone can serialize hasPreviewImage:true for a target
// that has no deliverable image (image_scales absent) — trusting that flag emits
// an <img> for a nonexistent /@@images/preview_image, which 404s and fails the
// strict SSG prerender. image_scales is the real signal.
const hrefHasImage = (block) => {
  const h = block?.href?.[0];
  const field = h?.image_field;
  return !!(h && field && h.image_scales?.[field]?.[0]);
};

const getTeaserDescription = (block) => {
  const hrefObj = block.href?.[0];
  const hrefObjHasContentData = hrefObj?.title !== undefined;
  const useBlockData = block.overwrite || !hrefObjHasContentData;
  if (useBlockData) {
    // When customizing, use block description or fall back to href description for initial editing
    return block.description || hrefObj?.description || '';
  }
  return hrefObj?.description || '';
};

// Search block helpers
const getListingTotalResults = (searchBlock) => {
  // Get total results from the listing child block (shared blocks dict)
  const listingUid = searchBlock.blocks_layout?.listing?.[0];
  if (!listingUid) return null;
  const listingBlock = searchBlock.blocks?.[listingUid];
  return listingBlock?._paging?.totalItems || listingBlock?.items_total || null;
};

// The quick-answer region a search block declares (a block that exists only
// once a question has been asked) — see the reveal attributes in the template.
const quickAnswerUid = (block) => block?.blocks_layout?.quickAnswer?.[0] || '';

// Get current search text from URL (for preserving in input field)
const currentSearchText = computed(() => {
  return useRoute().query.SearchableText || '';
});

// Extract TOC entries from page blocks (heading blocks + slate blocks with heading nodes)
const tocEntries = computed(() => {
  const result = [];
  const blocks = data.value?.blocks;
  const layout = data.value?.blocks_layout?.items;
  if (!blocks || !layout) return result;
  for (const id of layout) {
    const b = blocks[id];
    if (!b) continue;
    if (b['@type'] === 'heading' && b.heading) {
      result.push({ id, level: parseInt((b.tag || 'h2').slice(1)), text: b.heading });
    } else if (b['@type'] === 'slate' && b.value?.[0]?.type?.match(/^h[1-6]$/)) {
      const level = parseInt(b.value[0].type.slice(1));
      const text = b.plaintext || b.value[0].children?.map(c => c.text).join('') || '';
      if (text.trim()) result.push({ id, level, text });
    }
  }
  return result;
});

const handleSearchSubmit = (event) => {
  const formData = new FormData(event.target);
  const searchText = formData.get('SearchableText');
  const route = useRoute();
  const query = { ...route.query };
  if (searchText) {
    query.SearchableText = searchText;
  } else {
    delete query.SearchableText;
  }
  navigateTo({ path: route.path, query });
};

const handleSortChange = (event) => {
  const route = useRoute();
  navigateTo({ path: route.path, query: { ...route.query, sort_on: event.target.value } });
};

// Querystring metadata — fetched once globally, cached in Nuxt payload.
// Same pattern as Volto's withQueryString HOC. lazy:true keeps this
// component synchronous so event handlers work correctly.
const runtimeConfig = useRuntimeConfig();
const { data: querystringData } = useFetch(
  `${runtimeConfig.public.backendBaseUrl}/++api++/@querystring`,
  { key: 'querystring', headers: { Accept: 'application/json' }, lazy: true },
);
const querystringIndexes = computed(() => querystringData.value?.indexes || {});

// Get facet field value (handles object { label, value } or plain string)
const getFacetField = (facet) => {
  if (typeof facet.field === 'object') {
    return facet.field?.value || '';
  }
  return facet.field || '';
};

// Get facet options from @querystring index values (dynamic, not hardcoded)
const getFacetOptions = (facet) => {
  const field = getFacetField(facet);
  const index = querystringIndexes.value[field];
  if (!index?.values) return [];
  return Object.entries(index.values).map(([value, info]) => ({
    value,
    title: info?.title || value,
  }));
};

// Check if a facet value is currently selected (from URL params)
const isFacetChecked = (facet, value) => {
  const field = getFacetField(facet);
  const route = useRoute();
  const paramKey = `facet.${field}`;
  const current = route.query[paramKey];
  if (Array.isArray(current)) return current.includes(value);
  return current === value;
};

// Handle facet checkbox change
const handleFacetCheckboxChange = (event) => {
  const checkbox = event.target;
  const field = checkbox.dataset.field;
  const value = checkbox.value;
  const route = useRoute();
  const paramKey = `facet.${field}`;
  const query = { ...route.query };

  const current = query[paramKey];
  const currentValues = Array.isArray(current) ? [...current] : current ? [current] : [];

  if (checkbox.checked) {
    if (!currentValues.includes(value)) currentValues.push(value);
  } else {
    const idx = currentValues.indexOf(value);
    if (idx !== -1) currentValues.splice(idx, 1);
  }

  if (currentValues.length === 0) {
    delete query[paramKey];
  } else if (currentValues.length === 1) {
    query[paramKey] = currentValues[0];
  } else {
    query[paramKey] = currentValues;
  }

  navigateTo({ path: route.path, query });
};

// Handle facet select change
const handleFacetSelectChange = (event) => {
  const select = event.target;
  const field = select.dataset.field;
  const value = select.value;
  const route = useRoute();
  const query = { ...route.query };
  const paramKey = `facet.${field}`;

  if (value) {
    query[paramKey] = value;
  } else {
    delete query[paramKey];
  }

  navigateTo({ path: route.path, query });
};

// Form block: per-block state for errors, success, and user input values.
// Values are tracked in reactive state because admin FORM_DATA updates can
// re-render the iframe, which would lose DOM-only input values.
const formState = ref({});
const formValues = ref({});

const formFieldError = (blockUid, fieldId) => {
  return formState.value[blockUid]?.errors?.[fieldId] || '';
};

const getFormValue = (blockUid, fieldId) => {
  return formValues.value[blockUid]?.[fieldId] ?? '';
};

const setFormValue = (blockUid, fieldId, value) => {
  if (!formValues.value[blockUid]) {
    formValues.value[blockUid] = {};
  }
  formValues.value[blockUid][fieldId] = value;
};

const toggleMultiChoice = (blockUid, fieldId, opt, checked) => {
  const current = getFormValue(blockUid, fieldId) || [];
  const arr = Array.isArray(current) ? [...current] : [];
  if (checked) {
    if (!arr.includes(opt)) arr.push(opt);
  } else {
    const idx = arr.indexOf(opt);
    if (idx >= 0) arr.splice(idx, 1);
  }
  setFormValue(blockUid, fieldId, arr);
};

const validateFormValues = (blockUid, fields) => {
  const errors = {};
  const vals = formValues.value[blockUid] || {};
  for (const field of fields) {
    if (!field.required) continue;
    if (field.field_type === 'static_text' || field.field_type === 'hidden') continue;
    const value = vals[field.field_id];
    const hasValue = Array.isArray(value) ? value.length > 0 : (value !== '' && value !== undefined && value !== false);
    if (!hasValue) {
      errors[field.field_id] = `${field.label} is required.`;
    }
  }
  // Email format validation for 'from' fields
  for (const field of fields) {
    if (field.field_type !== 'from') continue;
    const value = vals[field.field_id];
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[field.field_id] = 'Please enter a valid email address.';
    }
  }
  return errors;
};

const handleFormSubmit = async (event, formBlock) => {
  const fields = formBlock.subblocks || [];
  const uid = block_uid.value;

  // Validate from reactive state
  const errors = validateFormValues(uid, fields);
  if (Object.keys(errors).length > 0) {
    formState.value = { ...formState.value, [uid]: { errors } };
    return;
  }

  // Collect submission data from reactive state
  const vals = formValues.value[uid] || {};
  const submitData = fields
    .filter(f => f.field_type !== 'static_text')
    .map(f => ({
      field_id: f.field_id,
      label: f.label,
      value: vals[f.field_id] ?? '',
    }));

  const apiUrl = effectiveApiUrl.value;
  const contextPath = effectiveContextPath.value;
  const response = await fetch(`${apiUrl}${contextPath}/@submit-form`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ block_id: uid, data: submitData }),
  });
  if (response.ok || response.status === 204) {
    formState.value = { ...formState.value, [uid]: { success: true } };
  }
};

</script>

<style>
/* Rendered only while editing (see showHiddenFields). */
.hidden-field-standin {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  border: 1px dashed #9ca3af;
  border-radius: 0.375rem;
  color: #4b5563;
  font-size: 0.875rem;
}
.hidden-field-badge {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.6875rem;
  font-weight: 600;
  color: #6b7280;
}
</style>

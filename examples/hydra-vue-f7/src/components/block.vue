<template>
  <!-- Slate (rich text) -->
  <div v-if="block['@type'] == 'slate'" :data-block-uid="block_uid" data-edit-text="value"><RichText v-for="(node, idx) in block['value']" :key="node.nodeId || idx" :node="node" /></div>

  <!-- Title -->
  <h1 v-else-if="block['@type'] == 'title'" :data-block-uid="block_uid" data-edit-text="/title">
    {{ data.title }}
  </h1>

  <!-- Description -->
  <p v-else-if="block['@type'] == 'description'" :data-block-uid="block_uid" data-edit-text="/description"
     class="description">
    {{ data.description }}
  </p>

  <!-- Introduction — standalone slate value at block.value, not page fields -->
  <div v-else-if="block['@type'] == 'introduction'" :data-block-uid="block_uid" class="introduction-block">
    <div data-edit-text="value">
      <RichText v-for="node in block.value || []" :key="node" :node="node" />
    </div>
  </div>

  <!-- Image -->
  <f7-block v-else-if="block['@type'] == 'image'" :data-block-uid="block_uid"
            :class="['image-size-' + (block.size || 'l'), 'image-align-' + (block.align || 'center')]">
    <a v-if="block.href" :href="getUrl(block.href)" data-edit-link="href">
      <img v-for="props in [imageProps(block)]" :key="props.url" data-edit-media="url"
           :src="props.url" :srcset="props.srcset || undefined" :sizes="props.sizes || undefined"
           :alt="block.alt || ''" />
    </a>
    <img v-else v-for="props in [imageProps(block)]" :key="props.url" data-edit-media="url" data-edit-link="href"
         :src="props.url" :srcset="props.srcset || undefined" :sizes="props.sizes || undefined"
         :alt="block.alt || ''" />
  </f7-block>

  <!-- Lead Image -->
  <div v-else-if="block['@type'] == 'leadimage'" :data-block-uid="block_uid" class="leadimage-block">
    <img v-if="getImageUrl(data.preview_image)" data-edit-media="preview_image"
         :src="getImageUrl(data.preview_image)" alt="" loading="lazy" />
  </div>

  <!-- Date Field -->
  <div v-else-if="block['@type'] == 'dateField'" :data-block-uid="block_uid" class="datefield-block">
    <span :data-edit-text="`/${block.dateField || 'effective'}`">
      {{ formatDate(data[block.dateField || 'effective'], block.showTime) }}
    </span>
  </div>

  <!-- Hero -->
  <div v-else-if="block['@type'] == 'hero'" :data-block-uid="block_uid" class="hero-block">
    <img v-if="block.image" class="hero-image" data-edit-media="image" :src="getImageUrl(block.image)" alt="Hero image" />
    <div v-else class="hero-image hero-placeholder" data-edit-media="image"></div>
    <h1 class="hero-heading" data-edit-text="heading">{{ block.heading }}</h1>
    <p class="hero-subheading" data-edit-text="subheading">{{ block.subheading }}</p>
    <div class="hero-description" data-edit-text="description">
      <RichText v-for="node in (block.description || [])" :key="node" :node="node" />
    </div>
    <f7-button v-if="block.buttonText" fill :href="getUrl(block.buttonLink)" data-edit-link="buttonLink" data-edit-text="buttonText">
      {{ block.buttonText }}
    </f7-button>
  </div>

  <!-- Teaser -->
  <f7-card v-else-if="block['@type'] == 'teaser'"
           :data-block-uid="block._blockUid || block_uid"
           :data-block-readonly="block.overwrite ? undefined : ''">
    <template v-if="block.preview_image || block.href?.[0]?.hasPreviewImage">
      <f7-card-header valign="bottom">
        <a :href="getUrl(block.href)" data-edit-link="href">
          <img v-if="block.preview_image" data-edit-media="preview_image"
               v-for="props in [imageProps(block.preview_image)]" :key="props.url"
               :src="props.url" :srcset="props.srcset || undefined" :sizes="props.sizes || undefined"
               alt="" style="width:100%" />
          <img v-else-if="block.href?.[0]?.hasPreviewImage" data-edit-media="preview_image"
               v-for="props in [imageProps(block.href[0])]" :key="props.url"
               :src="props.url" :srcset="props.srcset || undefined" :sizes="props.sizes || undefined"
               alt="" style="width:100%" />
        </a>
      </f7-card-header>
    </template>
    <div v-else data-edit-media="preview_image" style="height:200px; background:#e5e5e5; display:flex; align-items:center; justify-content:center; cursor:pointer;">
      <span style="color:#999">Click to add image</span>
    </div>
    <f7-card-content>
      <div v-if="block.head_title" data-edit-text="head_title">{{ block.head_title }}</div>
      <h3 v-if="getTeaserTitle(block)" :key="`title-${block.overwrite}`" data-edit-text="title">
        <a :href="getUrl(block.href)" data-edit-link="href">{{ getTeaserTitle(block) }}</a>
      </h3>
      <p v-if="getTeaserDescription(block)" :key="`description-${block.overwrite}`" data-edit-text="description">{{ getTeaserDescription(block) }}</p>
    </f7-card-content>
    <f7-card-footer>
      <f7-link :href="getUrl(block.href)" data-edit-link="href">Read more</f7-link>
    </f7-card-footer>
  </f7-card>

  <!-- Columns (using F7 grid) -->
  <div v-else-if="block['@type'] == 'columns'" :data-block-uid="block_uid"
       data-block-container="{allowed:['Column'],add:'horizontal'}"
       class="columns-block">
    <h3 v-if="block.title" data-edit-text="title">{{ block.title }}</h3>
    <div class="row">
      <div v-for="columnId in (block.blocks_layout?.columns || [])" :key="columnId"
           class="col" :data-block-uid="columnId" data-block-add="right">
        <h4 v-if="block.blocks?.[columnId]?.title" data-edit-text="title">{{ block.blocks[columnId].title }}</h4>
        <Block v-for="item in expand(block.blocks?.[columnId]?.blocks_layout?.items || [], block.blocks?.[columnId]?.blocks || {})"
               :key="item['@uid']" :block_uid="item['@uid']" :block="item" :data="data" />
      </div>
    </div>
  </div>

  <!-- Grid Block -->
  <f7-block v-else-if="block['@type'] == 'gridBlock'" :data-block-uid="block_uid"
            data-block-container="{}"
            :class="['grid', 'grid-cols-' + (block.blocks_layout?.items?.length || 1), 'grid-gap']">
    <template v-for="childId in (block.blocks_layout?.items || [])" :key="childId">
      <!-- Listing child -->
      <ListingBlock v-if="block.blocks?.[childId]?.['@type'] === 'listing'"
                    :id="childId" :block="block.blocks[childId]" :data="data"
                    :api-url="apiBase?.value || apiBase || ''" :context-path="contextPath?.value || contextPath || '/'" />
      <!-- Static child -->
      <Block v-else v-for="item in expand([childId], block.blocks || {})"
             :key="item['@uid']" :block_uid="item['@uid']" :block="item" :data="data" />
    </template>
  </f7-block>

  <!-- Accordion -->
  <f7-list strong inset-md accordion-list v-else-if="block['@type'] == 'accordion'" :data-block-uid="block_uid">
    <f7-list-item v-for="(panel, panelIdx) in expand(block.panels || [], null, '@id')"
                  :key="panel['@uid']" accordion-item
                  :accordion-item-opened="panelIdx === 0"
                  :data-block-uid="panel['@uid']">
      <template #title><span data-edit-text="title">{{ panel.title }}</span></template>
      <f7-accordion-content>
        <f7-block>
          <Block v-for="item in expand(panel.blocks_layout?.items || [], panel.blocks || {})"
                 :key="item['@uid']" :block_uid="item['@uid']" :block="item" :data="data" />
        </f7-block>
      </f7-accordion-content>
    </f7-list-item>
  </f7-list>

  <!-- Slider (using Swiper via F7) -->
  <section v-else-if="block['@type'] == 'slider'" :data-block-uid="block_uid"
           data-block-container="{allowed:['Slide'],add:'horizontal'}">
    <swiper-container :pagination="true" :space-between="50"
                      :speed="block.autoplayDelay && block.autoplayEnabled ? block.autoplayDelay : ''">
      <swiper-slide v-for="slide in expand(block.slides || [], null, '@id')"
                    :key="slide['@uid']" :data-block-uid="slide['@uid']" data-block-add="right">
        <f7-card>
          <f7-card-header v-if="slide.preview_image" valign="bottom"
                          :style="{ backgroundImage: `url(${getImageUrl(slide.preview_image)})`, backgroundSize: 'cover', minHeight: '200px' }">
            <div data-edit-media="preview_image" style="position:absolute; inset:0; cursor:pointer; z-index:1;"></div>
          </f7-card-header>
          <f7-card-content>
            <div v-if="slide.head_title" data-edit-text="head_title">{{ slide.head_title }}</div>
            <h3 v-if="slide.title" data-edit-text="title">{{ slide.title }}</h3>
            <p v-if="slide.description" data-edit-text="description">{{ slide.description }}</p>
          </f7-card-content>
          <f7-card-footer v-if="slide.href">
            <f7-button fill small :href="getUrl(slide.href)" data-edit-link="href" data-edit-text="buttonText">
              {{ slide.buttonText || 'Read More' }}
            </f7-button>
          </f7-card-footer>
        </f7-card>
      </swiper-slide>
    </swiper-container>
  </section>

  <!-- Listing -->
  <div v-else-if="block['@type'] === 'listing'" :data-block-uid="block_uid" class="listing-block">
    <ListingBlock :id="block_uid" :block="block" :data="data" :api-url="apiBase?.value || apiBase || ''" :context-path="contextPath?.value || contextPath || '/'" />
  </div>

  <!-- Search -->
  <div v-else-if="block['@type'] == 'search'" :data-block-uid="block_uid" class="search-block">
    <h2 v-if="block.headline" data-edit-text="headline">{{ block.headline }}</h2>

    <!-- Search input (F7 searchbar) -->
    <div v-if="block.showSearchInput" class="search-controls" style="margin-bottom:1rem">
      <f7-searchbar
        :value="currentSearchText"
        placeholder="Search..."
        :clear-button="true"
        :disable-button="false"
        @searchbar:search="handleSearchbarSearch"
        @submit.prevent="handleSearchSubmit"
      />
    </div>

    <!-- Rendered only once a question has been asked (URL-driven, like the
         search itself). The editor reveals it by asking: mounted() stamps the
         searchbar's inner input with data-block-selector-input. -->
    <div v-if="quickAnswerUid && quickAnswerChild && currentSearchText"
         :data-block-uid="quickAnswerUid" class="quick-answer"
         style="margin:1rem 0; padding:0.75rem; background:#eef3fb; border-radius:0.5rem">
      <div data-edit-text="answer">{{ quickAnswerChild.answer || '' }}</div>
    </div>

    <!-- Facets on top (default or facetsTopSide) -->
    <template v-if="!block.variation || block.variation === 'facetsTopSide'">
      <h3 v-if="block.facetsTitle" data-edit-text="facetsTitle" style="font-weight:600; margin-bottom:0.75rem">{{ block.facetsTitle }}</h3>
      <div v-if="block.facets?.length" class="search-facets" style="display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1rem; padding:1rem; background:#f9fafb; border-radius:0.5rem">
        <template v-for="(facet, idx) in expand(block.facets || [], null, '@id')" :key="facet['@uid'] || idx">
          <template v-if="facet.type === 'slate' || facet.type === 'image'">
            <div :data-block-uid="facet['@uid']" data-block-add="bottom" style="padding:0.75rem; border:1px solid #e5e7eb; border-radius:0.25rem; min-width:12rem">
              <Block :block="facet" :block_uid="facet['@uid']" :data="data" />
            </div>
          </template>
          <div v-else :data-block-uid="facet['@uid']" :data-block-type="facet.type" data-block-add="bottom"
               style="padding:0.75rem; border:1px solid #e5e7eb; border-radius:0.25rem; min-width:12rem">
            <div data-edit-text="title" style="font-weight:500; font-size:0.875rem; margin-bottom:0.5rem">{{ facet.title }}</div>
            <template v-if="facet.type === 'selectFacet'">
              <select :data-field="getFacetField(facet)" @change="handleFacetSelectChange" data-linkable-allow
                      style="width:100%; padding:0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.875rem">
                <option value="">Select...</option>
                <option v-for="opt in getFacetOptions(facet)" :key="opt.value" :value="opt.value">{{ opt.title }}</option>
              </select>
            </template>
            <template v-else-if="facet.type === 'daterangeFacet'">
              <div style="display:flex; gap:0.5rem; margin-top:0.25rem">
                <input type="date" style="padding:0.25rem 0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.875rem" />
                <span style="color:#9ca3af">&mdash;</span>
                <input type="date" style="padding:0.25rem 0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.875rem" />
              </div>
            </template>
            <template v-else-if="facet.type === 'toggleFacet'">
              <div style="margin-top:0.25rem; display:flex; align-items:center; gap:0.5rem">
                <f7-toggle />
                <span style="font-size:0.875rem">{{ getFacetOptions(facet)?.[0]?.title || 'Toggle' }}</span>
              </div>
            </template>
            <template v-else>
              <div data-linkable-allow>
                <label v-for="opt in getFacetOptions(facet)" :key="opt.value"
                       style="display:flex; align-items:center; gap:0.5rem; font-size:0.875rem; margin-bottom:0.25rem">
                  <input type="checkbox" :value="opt.value" class="facet-checkbox"
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
      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem">
        <p v-if="block.showTotalResults && getListingTotalResults(block)" style="color:#4b5563">
          {{ getListingTotalResults(block) }} results
        </p>
        <div v-if="block.showSortOn && block.sortOnOptions?.length">
          <label style="font-size:0.875rem; color:#4b5563; margin-right:0.5rem">Sort by:</label>
          <select @change="handleSortChange" data-linkable-allow
                  style="padding:0.25rem 0.75rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.875rem">
            <option v-for="opt in block.sortOnOptions" :key="opt" :value="opt">{{ opt }}</option>
          </select>
        </div>
      </div>

      <div class="search-results">
        <Block v-for="item in expand(block.blocks_layout?.listing || [], block.blocks || {})"
               :key="item['@uid']" :block_uid="item['@uid']" :block="item" :data="data" />
      </div>
    </template>

    <!-- Facets on left or right side -->
    <template v-else-if="block.variation === 'facetsLeftSide' || block.variation === 'facetsRightSide'">
      <div style="display:flex; gap:1.5rem" :style="{ flexDirection: block.variation === 'facetsRightSide' ? 'row-reverse' : 'row' }">
        <!-- Sidebar: facets -->
        <aside v-if="block.facets?.length" class="search-facets" style="width:16rem; flex-shrink:0">
          <div style="padding:1rem; background:#f9fafb; border-radius:0.5rem; position:sticky; top:1rem">
            <h3 v-if="block.facetsTitle" data-edit-text="facetsTitle" style="font-weight:600; margin-bottom:0.75rem; color:#374151">{{ block.facetsTitle }}</h3>
            <template v-for="(facet, idx) in expand(block.facets || [], null, '@id')" :key="facet['@uid'] || idx">
              <template v-if="facet.type === 'slate' || facet.type === 'image'">
                <div :data-block-uid="facet['@uid']" data-block-add="bottom"
                     style="margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid #e5e7eb">
                  <Block :block="facet" :block_uid="facet['@uid']" :data="data" />
                </div>
              </template>
              <div v-else :data-block-uid="facet['@uid']" :data-block-type="facet.type" data-block-add="bottom"
                   style="margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid #e5e7eb">
                <div data-edit-text="title" style="font-weight:500; font-size:0.875rem; margin-bottom:0.5rem">{{ facet.title }}</div>
                <template v-if="facet.type === 'selectFacet'">
                  <select :data-field="getFacetField(facet)" @change="handleFacetSelectChange" data-linkable-allow
                          style="width:100%; padding:0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.875rem">
                    <option value="">Select...</option>
                    <option v-for="opt in getFacetOptions(facet)" :key="opt.value" :value="opt.value">{{ opt.title }}</option>
                  </select>
                </template>
                <template v-else-if="facet.type === 'daterangeFacet'">
                  <div style="display:flex; gap:0.5rem; margin-top:0.25rem">
                    <input type="date" style="padding:0.25rem 0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.875rem" />
                    <span style="color:#9ca3af">&mdash;</span>
                    <input type="date" style="padding:0.25rem 0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.875rem" />
                  </div>
                </template>
                <template v-else-if="facet.type === 'toggleFacet'">
                  <div style="margin-top:0.25rem">
                    <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.875rem">
                      <input type="checkbox" />
                      {{ getFacetOptions(facet)?.[0]?.title || 'Toggle' }}
                    </label>
                  </div>
                </template>
                <template v-else>
                  <div data-linkable-allow>
                    <label v-for="opt in getFacetOptions(facet)" :key="opt.value"
                           style="display:flex; align-items:center; gap:0.5rem; font-size:0.875rem; margin-bottom:0.25rem">
                      <input type="checkbox" :value="opt.value" class="facet-checkbox"
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
        <div class="search-results" style="flex:1">
          <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem">
            <p v-if="block.showTotalResults && getListingTotalResults(block)" style="color:#4b5563">
              {{ getListingTotalResults(block) }} results
            </p>
            <div v-if="block.showSortOn && block.sortOnOptions?.length">
              <label style="font-size:0.875rem; color:#4b5563; margin-right:0.5rem">Sort by:</label>
              <select @change="handleSortChange" data-linkable-allow
                      style="padding:0.25rem 0.75rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.875rem">
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

  <!-- Slate Table -->
  <f7-block v-else-if="block['@type'] == 'slateTable'" :data-block-uid="block_uid" class="table-block data-table" strong inset-md>
    <table class="data-table-table">
      <tr v-for="row in expand(block.table?.rows || [], null, 'key')"
          :key="row['@uid']" :data-block-uid="row['@uid']" data-block-add="bottom">
        <component v-for="cell in expand(row.cells || [], null, 'key')"
                   :key="cell['@uid']"
                   :is="cell.type === 'header' ? 'th' : 'td'"
                   :data-block-uid="cell['@uid']" data-block-add="right">
          <RichText v-for="(node, idx) in (cell.value || [])" :key="idx" :node="node" data-edit-text="value" />
        </component>
      </tr>
    </table>
  </f7-block>

  <!-- Heading -->
  <component v-else-if="block['@type'] == 'heading'" :is="block.tag || 'h2'"
             :data-block-uid="block_uid" data-edit-text="heading">
    {{ block.heading }}
  </component>

  <!-- Separator -->
  <hr v-else-if="block['@type'] == 'separator'" :data-block-uid="block_uid" />

  <!-- Button -->
  <div v-else-if="block['@type'] == 'button'" :data-block-uid="block_uid" class="button-block"
       :style="{ textAlign: block.inneralign || 'left' }">
    <f7-button fill :href="getUrl(block.href)" data-edit-link="href" data-edit-text="title">
      {{ block.title || 'Button' }}
    </f7-button>
  </div>

  <!-- Highlight -->
  <section v-else-if="block['@type'] == 'highlight'" :data-block-uid="block_uid" class="highlight-block"
           :style="{ position: 'relative', overflow: 'hidden', borderRadius: '8px', padding: '0' }">
    <!-- data-edit-media on BOTH branches, matching hydra-nextjs: the backdrop is
         the only element this image ever produces, and it has to be pickable
         when EMPTY (that is how an author sets one) as well as when filled. -->
    <div v-if="imageProps(block.image).url" data-edit-media="image"
         :style="{ position: 'absolute', inset: '0', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url(${imageProps(block.image).url})` }" />
    <div v-else data-edit-media="image"
         :style="{ position: 'absolute', inset: '0', background: highlightGradient(block.styles?.descriptionColor) }" />
    <div :style="{ position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.5)' }" />
    <div :style="{ position: 'relative', zIndex: '1', padding: '4rem 2rem', textAlign: 'center', color: 'white' }">
      <h2 data-edit-text="title" style="margin-bottom:1rem; font-size:2rem; font-weight:800;">{{ block.title }}</h2>
      <div data-edit-text="description" style="margin-bottom:2rem; font-size:1.1rem;">
        <RichText v-for="node in (block.description || block['value'] || [])" :key="node" :node="node" />
      </div>
      <f7-button v-if="block.cta_title" fill :href="getUrl(block.cta_link)"
         data-edit-text="cta_title" data-edit-link="cta_link">
        {{ block.cta_title }}
      </f7-button>
    </div>
  </section>

  <!-- Video -->
  <div v-else-if="block['@type'] == 'video'" :data-block-uid="block_uid" class="video-block">
    <iframe v-if="getYouTubeId(block.url)"
            :src="`https://www.youtube.com/embed/${getYouTubeId(block.url)}`"
            allowfullscreen style="width:100%; aspect-ratio:16/9; border:none" />
    <video v-else-if="block.url" :src="block.url" controls style="width:100%" />
    <p v-else>No video URL set</p>
  </div>

  <!-- Maps -->
  <div v-else-if="block['@type'] == 'maps'" :data-block-uid="block_uid" class="maps-block">
    <h3 v-if="block.title" data-edit-text="title">{{ block.title }}</h3>
    <iframe v-if="block.url" :src="block.url" data-edit-link="url"
            :title="block.title || 'Map'" allowfullscreen loading="lazy"
            style="width:100%; height:450px; border:none" />
    <p v-else>No map URL configured</p>
  </div>

  <!-- Table of Contents -->
  <nav v-else-if="block['@type'] == 'toc'" :data-block-uid="block_uid" class="toc-block">
    <h3>Table of Contents</h3>
    <ul v-if="tocEntries.length" style="list-style:disc; padding-left:1.25rem">
      <li v-for="e in tocEntries" :key="e.id" :style="{ marginLeft: (e.level - 2) * 1.5 + 'em' }">
        <a :href="`#${e.id}`">{{ e.text }}</a>
      </li>
    </ul>
    <p v-else style="color:#9ca3af; font-style:italic">No headings found</p>
  </nav>

  <!-- Form -->
  <div v-else-if="block['@type'] == 'form'" :data-block-uid="block_uid" class="form-block">
    <h3 v-if="block.title" data-edit-text="title">{{ block.title }}</h3>
    <div v-if="formState[block_uid]?.success" style="padding:1rem; background:#f0fdf4; color:#166534; border-radius:0.5rem; margin-bottom:1rem">
      {{ block.send_message || 'Form submitted successfully.' }}
    </div>
    <form v-else @submit.prevent="handleFormSubmit($event, block)" novalidate>
      <template v-for="field in expand(block.subblocks, null, 'field_id')" :key="field['@uid']">
        <div :data-block-uid="field['@uid']" :data-block-type="field.field_type" data-block-add="bottom"
             style="margin-bottom:1rem">
          <!-- Text -->
          <template v-if="field.field_type === 'text'">
            <label data-edit-text="label">{{ field.label }}<span v-if="field.required" style="color:red"> *</span></label>
            <p v-if="field.description" style="font-size:0.85em; color:#666">{{ field.description }}</p>
            <f7-input type="text" :name="field.field_id" :placeholder="field.placeholder || ''" outline
                      :value="getFormValue(block_uid, field.field_id)"
                      @input="setFormValue(block_uid, field.field_id, $event.target.value)"
                      :style="formFieldError(block_uid, field.field_id) ? 'border-color:red' : ''" />
            <p v-if="formFieldError(block_uid, field.field_id)" style="color:red; font-size:0.75rem; margin-top:0.25rem">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Textarea -->
          <template v-else-if="field.field_type === 'textarea'">
            <label data-edit-text="label">{{ field.label }}<span v-if="field.required" style="color:red"> *</span></label>
            <p v-if="field.description" style="font-size:0.85em; color:#666">{{ field.description }}</p>
            <f7-input type="textarea" :name="field.field_id" :resizable="true" outline
                      :value="getFormValue(block_uid, field.field_id)"
                      @input="setFormValue(block_uid, field.field_id, $event.target.value)"
                      :style="formFieldError(block_uid, field.field_id) ? 'border-color:red' : ''" />
            <p v-if="formFieldError(block_uid, field.field_id)" style="color:red; font-size:0.75rem; margin-top:0.25rem">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Number -->
          <template v-else-if="field.field_type === 'number'">
            <label data-edit-text="label">{{ field.label }}<span v-if="field.required" style="color:red"> *</span></label>
            <p v-if="field.description" style="font-size:0.85em; color:#666">{{ field.description }}</p>
            <f7-input type="number" :name="field.field_id" outline
                      :value="getFormValue(block_uid, field.field_id)"
                      @input="setFormValue(block_uid, field.field_id, $event.target.value)"
                      :style="formFieldError(block_uid, field.field_id) ? 'border-color:red' : ''" />
            <p v-if="formFieldError(block_uid, field.field_id)" style="color:red; font-size:0.75rem; margin-top:0.25rem">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Select -->
          <template v-else-if="field.field_type === 'select'">
            <label data-edit-text="label">{{ field.label }}<span v-if="field.required" style="color:red"> *</span></label>
            <p v-if="field.description" style="font-size:0.85em; color:#666">{{ field.description }}</p>
            <f7-input type="select" :name="field.field_id" outline
                      :value="getFormValue(block_uid, field.field_id)"
                      @change="setFormValue(block_uid, field.field_id, $event.target.value)"
                      :style="formFieldError(block_uid, field.field_id) ? 'border-color:red' : ''">
              <option value="">Select...</option>
              <option v-for="opt in field.input_values" :key="opt" :value="opt">{{ opt }}</option>
            </f7-input>
            <p v-if="formFieldError(block_uid, field.field_id)" style="color:red; font-size:0.75rem; margin-top:0.25rem">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Single Choice (Radio) -->
          <template v-else-if="field.field_type === 'single_choice'">
            <fieldset>
              <legend data-edit-text="label">{{ field.label }}<span v-if="field.required" style="color:red"> *</span></legend>
              <p v-if="field.description" style="font-size:0.85em; color:#666">{{ field.description }}</p>
              <div v-for="opt in field.input_values" :key="opt" style="margin:0.25rem 0">
                <label><input type="radio" :name="field.field_id" :value="opt"
                              :checked="getFormValue(block_uid, field.field_id) === opt"
                              @change="setFormValue(block_uid, field.field_id, opt)" /> {{ opt }}</label>
              </div>
              <p v-if="formFieldError(block_uid, field.field_id)" style="color:red; font-size:0.75rem; margin-top:0.25rem">{{ formFieldError(block_uid, field.field_id) }}</p>
            </fieldset>
          </template>
          <!-- Multiple Choice (Checkboxes) -->
          <template v-else-if="field.field_type === 'multiple_choice'">
            <fieldset>
              <legend data-edit-text="label">{{ field.label }}<span v-if="field.required" style="color:red"> *</span></legend>
              <p v-if="field.description" style="font-size:0.85em; color:#666">{{ field.description }}</p>
              <div v-for="opt in field.input_values" :key="opt" style="margin:0.25rem 0">
                <label><input type="checkbox" :name="field.field_id" :value="opt"
                              :checked="(getFormValue(block_uid, field.field_id) || []).includes(opt)"
                              @change="toggleMultiChoice(block_uid, field.field_id, opt, $event.target.checked)" /> {{ opt }}</label>
              </div>
              <p v-if="formFieldError(block_uid, field.field_id)" style="color:red; font-size:0.75rem; margin-top:0.25rem">{{ formFieldError(block_uid, field.field_id) }}</p>
            </fieldset>
          </template>
          <!-- Checkbox -->
          <template v-else-if="field.field_type === 'checkbox'">
            <label>
              <input type="checkbox" :name="field.field_id"
                     :checked="!!getFormValue(block_uid, field.field_id)"
                     @change="setFormValue(block_uid, field.field_id, $event.target.checked)" />
              <span data-edit-text="label">{{ field.label }}<span v-if="field.required" style="color:red"> *</span></span>
            </label>
            <p v-if="field.description" style="font-size:0.85em; color:#666">{{ field.description }}</p>
            <p v-if="formFieldError(block_uid, field.field_id)" style="color:red; font-size:0.75rem; margin-top:0.25rem">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Date -->
          <template v-else-if="field.field_type === 'date'">
            <label data-edit-text="label">{{ field.label }}<span v-if="field.required" style="color:red"> *</span></label>
            <p v-if="field.description" style="font-size:0.85em; color:#666">{{ field.description }}</p>
            <f7-input type="date" :name="field.field_id" outline
                      :value="getFormValue(block_uid, field.field_id)"
                      @input="setFormValue(block_uid, field.field_id, $event.target.value)"
                      :style="formFieldError(block_uid, field.field_id) ? 'border-color:red' : ''" />
            <p v-if="formFieldError(block_uid, field.field_id)" style="color:red; font-size:0.75rem; margin-top:0.25rem">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Email (from) -->
          <template v-else-if="field.field_type === 'from'">
            <label data-edit-text="label">{{ field.label }}<span v-if="field.required" style="color:red"> *</span></label>
            <p v-if="field.description" style="font-size:0.85em; color:#666">{{ field.description }}</p>
            <f7-input type="email" :name="field.field_id" outline
                      :value="getFormValue(block_uid, field.field_id)"
                      @input="setFormValue(block_uid, field.field_id, $event.target.value)"
                      :style="formFieldError(block_uid, field.field_id) ? 'border-color:red' : ''" />
            <p v-if="formFieldError(block_uid, field.field_id)" style="color:red; font-size:0.75rem; margin-top:0.25rem">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Attachment -->
          <template v-else-if="field.field_type === 'attachment'">
            <label data-edit-text="label">{{ field.label }}<span v-if="field.required" style="color:red"> *</span></label>
            <p v-if="field.description" style="font-size:0.85em; color:#666">{{ field.description }}</p>
            <input type="file" :name="field.field_id"
                   @change="setFormValue(block_uid, field.field_id, $event.target.files?.[0]?.name || '')" />
            <p v-if="formFieldError(block_uid, field.field_id)" style="color:red; font-size:0.75rem; margin-top:0.25rem">{{ formFieldError(block_uid, field.field_id) }}</p>
          </template>
          <!-- Static text -->
          <template v-else-if="field.field_type === 'static_text'">
            <div>
              <strong v-if="field.label" data-edit-text="label">{{ field.label }}</strong>
              <p v-if="field.description">{{ field.description }}</p>
            </div>
          </template>
          <!-- Hidden -->
          <template v-else-if="field.field_type === 'hidden'">
            <input type="hidden" :name="field.field_id" :value="field.value || ''" />
          </template>
        </div>
      </template>
      <div style="display:flex; gap:0.75rem; padding-top:0.5rem">
        <f7-button type="submit" fill data-edit-text="submit_label">{{ block.submit_label || 'Submit' }}</f7-button>
        <f7-button v-if="block.show_cancel" type="reset" outline data-edit-text="cancel_label">{{ block.cancel_label || 'Cancel' }}</f7-button>
      </div>
    </form>
  </div>

  <!-- Code Example (using F7 tabs) -->
  <div v-else-if="block['@type'] == 'suggest'" :data-block-uid="block_uid" class="suggest">
    <label :for="block_uid + '-input'" data-edit-text="label">{{ block.label }}</label>
    <input :id="block_uid + '-input'" name="answer" type="text" :value="block.value"
      aria-autocomplete="list" autocomplete="off">
    <ul class="suggest__list" hidden></ul>
  </div>
  <div v-else-if="block['@type'] == 'codeExample'" :data-block-uid="block_uid"
       data-block-container='{"add":"horizontal"}' style="margin:1rem 0">
    <div style="border-radius:0.5rem; overflow:hidden; background:#111827">
      <!-- Tab bar using F7 toolbar + segmented -->
      <f7-toolbar v-if="getCodeTabs(block).length > 1" tabbar data-tab-bar
                  style="background:#1f2937; --f7-toolbar-bg-color:#1f2937">
        <f7-link v-for="(tab, i) in getCodeTabs(block)" :key="tab['@id']"
          :data-block-uid="tab['@id']" data-linkable-allow
          :tab-link="`#code-tab-${block_uid}-${i}`"
          :tab-link-active="i === 0"
          :style="{ color: '#9ca3af', fontSize: '0.875rem' }">
          <span data-edit-text="label">{{ tab.label || tab.language || `Tab ${i + 1}` }}</span>
        </f7-link>
      </f7-toolbar>
      <!-- Tab content -->
      <f7-tabs>
        <f7-tab v-for="(tab, i) in getCodeTabs(block)" :key="tab['@id']"
                :id="`code-tab-${block_uid}-${i}`"
                :tab-active="i === 0"
                :data-block-uid="tab['@id']" data-block-add="right"
                style="position:relative">
          <pre data-edit-text="code"
               style="padding:1rem; overflow:auto; font-size:0.875rem; line-height:1.6; margin:0; color:#f3f4f6; white-space:pre-wrap">
            <code>{{ tab.code || '' }}</code>
          </pre>
        </f7-tab>
      </f7-tabs>
    </div>
  </div>

  <!-- Empty -->
  <div v-else-if="block['@type'] == 'empty'" :data-block-uid="block_uid" class="empty-block" style="min-height:60px"></div>

  <!-- Event Metadata -->
  <div v-else-if="block['@type'] == 'eventMetadata'" :data-block-uid="block_uid" class="event-metadata">
    <dl>
      <div v-if="data.start" class="event-row">
        <dt>When</dt>
        <dd>
          <span data-edit-text="/start">{{ formatDate(data.start, true) }}</span>
          <span v-if="data.end"> – <span data-edit-text="/end">{{ formatDate(data.end, true) }}</span></span>
        </dd>
      </div>
      <div v-if="data.location" class="event-row">
        <dt>Where</dt>
        <dd data-edit-text="/location">{{ data.location }}</dd>
      </div>
      <div v-if="data.event_url" class="event-row">
        <dt>Website</dt>
        <dd><a :href="data.event_url">{{ data.event_url }}</a></dd>
      </div>
      <div v-if="data.contact_name || data.contact_email || data.contact_phone" class="event-row">
        <dt>Contact</dt>
        <dd>
          <span v-if="data.contact_name" data-edit-text="/contact_name">{{ data.contact_name }}</span>
          <span v-if="data.contact_email"> · <a :href="`mailto:${data.contact_email}`">{{ data.contact_email }}</a></span>
          <span v-if="data.contact_phone" data-edit-text="/contact_phone"> · {{ data.contact_phone }}</span>
        </dd>
      </div>
    </dl>
  </div>

  <!-- Social Links -->
  <div v-else-if="block['@type'] == 'socialLinks'" :data-block-uid="block_uid" class="social-links"
       style="display:flex; align-items:center; justify-content:center; gap:1rem; padding:0.5rem 0">
    <span style="font-size:0.875rem; color:#6b7280">Follow us:</span>
    <a v-for="link in expand(block.links || [], null, '@id')" :key="link['@uid']"
       :data-block-uid="link['@uid']" data-block-add="right"
       :href="link.url" target="_blank" rel="noopener noreferrer"
       data-edit-link="url" :title="socialInfo(link.url).name"
       style="color:#9ca3af; transition:color 0.2s">
      <span v-html="socialInfo(link.url).svg" />
    </a>
  </div>

  <!-- Default listing item: title + description -->
  <div v-else-if="block['@type'] == 'default'" :data-block-uid="block_uid" class="default-item-block" style="padding:1rem 0; border-bottom:1px solid #e5e5e5">
    <h4><a :href="getUrl(block.href)" data-edit-link="href">{{ block.title }}</a></h4>
    <p v-if="block.description" data-edit-text="description">{{ block.description }}</p>
  </div>

  <!-- Summary listing item: image thumbnail + title + description -->
  <div v-else-if="block['@type'] == 'summary'" :data-block-uid="block_uid" class="summary-item-block" style="padding:1rem 0; border-bottom:1px solid #e5e5e5; display:flex; align-items:flex-start; gap:1rem">
    <template v-if="block.image" v-for="props in [imageProps(block.image)]" :key="props.url">
      <img v-if="props.url" :src="props.url" :srcset="props.srcset || undefined" :sizes="props.sizes || undefined"
           alt="" data-edit-media="image"
           style="width:128px; height:96px; object-fit:cover; border-radius:4px; flex-shrink:0" />
    </template>
    <div style="flex:1">
      <time v-if="block.date" style="display:block; font-size:0.75rem; font-weight:bold; text-transform:uppercase; margin-bottom:0.25rem">{{ formatDate(block.date) }}</time>
      <h4><a :href="getUrl(block.href)" data-edit-link="href">{{ block.title }}</a></h4>
      <p v-if="block.description" data-edit-text="description">{{ block.description }}</p>
    </div>
  </div>

  <!-- Unknown -->
  <div v-else :data-block-uid="block_uid">
    Unknown block: {{ block['@type'] }}
  </div>
</template>

<script>
import { inject, ref, reactive, computed, watch } from 'vue';
import RichText from './richtext.vue';
import ListingBlock from './ListingBlock.vue';
import { expandTemplatesSync, expandListingBlocks, ploneFetchItems, contentPath } from '@hydra-js/helpers';

// Social icons SVG map (with name + svg for socialInfo())
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

// Facet field options - maps field name to available options
const FACET_FIELD_OPTIONS = {
  'review_state': [
    { value: 'private', title: 'Private' },
    { value: 'pending', title: 'Pending' },
    { value: 'published', title: 'Published' },
  ],
  'portal_type': [
    { value: 'Document', title: 'Page' },
    { value: 'News Item', title: 'News Item' },
    { value: 'Event', title: 'Event' },
    { value: 'Image', title: 'Image' },
    { value: 'File', title: 'File' },
    { value: 'Link', title: 'Link' },
  ],
};

// Helper to unwrap a Vue ref or F7 store getter (returns .value if present)
function unwrapRef(val) {
  return (typeof val === 'object' && val !== null && 'value' in val) ? val.value : val;
}

export default {
  name: 'Block',
  components: {
    RichText,
    ListingBlock,
  },
  props: {
    block_uid: { type: String },
    block: { type: Object, required: true },
    data: { type: Object, required: true },
  },
  setup() {
    const templates = inject('templates', {});
    // No default — must be the one shared state provided at the page root.
    const templateState = inject('templateState');
    const apiBase = inject('apiBase', '');
    const contextPath = inject('contextPath', '/');
    const activeCodeTab = ref(0);

    // Form state: per-block tracking of values, errors, success
    const formState = reactive({});
    const formValues = reactive({});

    // Facet state
    const facetState = reactive({});

    // Search text
    const currentSearchText = ref('');
    // Parse from URL on init
    try {
      const urlParams = new URLSearchParams(window.location.search);
      currentSearchText.value = urlParams.get('SearchableText') || '';
    } catch { /* ignore */ }

    const expand = (layout, blocks, idField) =>
      expandTemplatesSync(layout, {
        blocks,
        templateState,
        templates,
        ...(idField && { idField }),
      });

    // TOC entries computed from page blocks
    const tocEntries = computed(() => {
      const result = [];
      const dataVal = typeof apiBase === 'object' ? undefined : undefined; // placeholder
      // We need data prop which isn't available in setup without props arg
      return result;
    });

    return {
      expand, apiBase, contextPath, activeCodeTab,
      formState, formValues, facetState, currentSearchText,
    };
  },
  computed: {
    // A block that exists ONLY once a question has been asked — see the
    // quick-answer template below and the mounted() attribute stamping.
    quickAnswerUid() {
      return this.block?.blocks_layout?.quickAnswer?.[0] || '';
    },
    quickAnswerChild() {
      return this.quickAnswerUid ? this.block?.blocks?.[this.quickAnswerUid] : null;
    },
    tocEntries() {
      const result = [];
      const blocks = this.data?.blocks;
      const layout = this.data?.blocks_layout?.items;
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
    },
  },
  mounted() {
    this.stampQuickAnswerReveal();
  },
  updated() {
    this.stampQuickAnswerReveal();
  },
  methods: {
    // f7-searchbar owns its inner <input>, so the reveal attributes can't be
    // written in the template — stamp them on after render. The searchbar IS a
    // <form>, so hydra's no-activator branch submits it after filling.
    stampQuickAnswerReveal() {
      if (!this.quickAnswerUid) return;
      const input = this.$el?.querySelector?.('.search-controls input');
      if (!input) return;
      input.setAttribute('data-block-selector', this.quickAnswerUid);
      if (this.block?.quickAnswerSample) {
        input.setAttribute('data-block-selector-input', this.block.quickAnswerSample);
      }
    },
    getUrl(href) {
      if (!href) return '';
      if (Array.isArray(href) && href.length) href = href[0];
      if (href['@id']) {
        const apiUrl = unwrapRef(this.apiBase) || import.meta.env.VITE_API_BASE_URL || '';
        return contentPath(href['@id'], apiUrl);
      }
      if (typeof href === 'string') {
        const apiUrl = unwrapRef(this.apiBase) || import.meta.env.VITE_API_BASE_URL || '';
        return contentPath(href, apiUrl);
      }
      return '';
    },
    imageProps(block) {
      if (!block) {
        return { url: null, srcset: '', sizes: '', size: 'l', align: 'center' };
      }
      // Unwrap preview_image field
      if (block?.preview_image) {
        block = block.preview_image;
      }
      // Handle array format: [{ download, scales }]
      if (Array.isArray(block) && block.length > 0) {
        block = block[0];
      }
      if (!block) {
        return { url: null, srcset: '', sizes: '', size: 'l', align: 'center' };
      }

      const apiUrl = unwrapRef(this.apiBase);
      var image_url = null;

      if (typeof block === 'string') {
        image_url = block;
      } else if ('@id' in block && block?.image_scales) {
        image_url = block['@id'];
      } else if ('@id' in block && block?.hasPreviewImage) {
        image_url = block['@id'];
        if (image_url.startsWith('/') && apiUrl) {
          image_url = `${apiUrl}${image_url}`;
        }
        image_url = `${image_url}/@@images/preview_image`;
        return { url: image_url, srcset: '', sizes: '', size: block.size || 'l', align: block.align || 'center' };
      } else if ('@id' in block) {
        image_url = block['@id'];
      } else if (block?.download) {
        image_url = block.download;
      } else if (block?.url && block['@type'] === 'image') {
        const urlValue = block.url;
        if (typeof urlValue === 'string') {
          image_url = urlValue;
        } else if (urlValue?.image_scales && urlValue?.image_field) {
          const field = urlValue.image_field;
          const scales = urlValue.image_scales[field];
          if (scales?.[0]?.download) {
            image_url = `${urlValue['@id'] || ''}/${scales[0].download}`;
          }
        } else if (urlValue?.['@id']) {
          image_url = urlValue['@id'];
        }
      } else {
        return { url: null, srcset: '', sizes: '', size: block.size || 'l', align: block.align || 'center' };
      }

      if (!image_url) {
        return { url: null, srcset: '', sizes: '', size: block.size || 'l', align: block.align || 'center' };
      }

      // Prepend apiBase for relative URLs
      if (image_url.startsWith('/') && apiUrl) {
        image_url = `${apiUrl}${image_url}`;
      }

      // Build srcset/sizes from image_scales
      var srcset = '';
      var sizes = '';
      var width = block?.width;

      if (block?.image_scales && block?.image_field) {
        const field = block.image_field;
        const scaleData = block.image_scales[field]?.[0];
        if (scaleData?.scales) {
          srcset = Object.keys(scaleData.scales).map((name) => {
            const scale = scaleData.scales[name];
            return `${image_url}/${scale.download} ${scale.width}w`;
          }).join(', ');
          sizes = Object.keys(scaleData.scales).map((name) => {
            const scale = scaleData.scales[name];
            return `(max-width: ${scale.width}px) ${scale.width}px`;
          }).join(', ');
        }
        if (scaleData?.download) {
          image_url = `${image_url}/${scaleData.download}`;
        }
      } else if (block?.scales) {
        srcset = Object.keys(block.scales).map((name) => {
          const scale = block.scales[name];
          return `${image_url}/${scale.download} ${scale.width}w`;
        }).join(', ');
        image_url = block.download;
      } else if (block?.url && block?.image_field) {
        image_url = `${image_url}/@@images/${block.image_field}`;
      } else if (block['@type'] === 'image' && !image_url.includes('@@images') && !image_url.includes('@@download') && !image_url.includes('@@display-file') && !image_url.startsWith('data:')) {
        image_url = `${image_url}/@@images/image`;
      }

      return {
        url: image_url,
        srcset,
        sizes,
        size: block.size || 'l',
        align: block.align || 'center',
        width,
      };
    },
    getImageUrl(value) {
      if (!value) return '';
      const props = this.imageProps(value);
      return props.url || '';
    },
    getTeaserTitle(block) {
      const hrefObj = block.href?.[0];
      const hrefObjHasContentData = hrefObj?.title !== undefined;
      const useBlockData = block.overwrite || !hrefObjHasContentData;
      if (useBlockData) {
        return block.title || hrefObj?.title || '';
      }
      return hrefObj?.title || '';
    },
    getTeaserDescription(block) {
      const hrefObj = block.href?.[0];
      const hrefObjHasContentData = hrefObj?.title !== undefined;
      const useBlockData = block.overwrite || !hrefObjHasContentData;
      if (useBlockData) {
        return block.description || hrefObj?.description || '';
      }
      return hrefObj?.description || '';
    },
    highlightGradient(colorClass) {
      const gradients = {
        'highlight-custom-color-1': 'linear-gradient(to right, #1e3a8a, #2563eb)',
        'highlight-custom-color-2': 'linear-gradient(to right, #065f46, #059669)',
        'highlight-custom-color-3': 'linear-gradient(to right, #581c87, #9333ea)',
        'highlight-custom-color-4': 'linear-gradient(to right, #78350f, #d97706)',
        'highlight-custom-color-5': 'linear-gradient(to right, #881337, #e11d48)',
      };
      return gradients[colorClass] || gradients['highlight-custom-color-1'];
    },
    formatDate(dateStr, showTime) {
      if (!dateStr) return '';
      const opts = { year: 'numeric', month: 'long', day: 'numeric' };
      if (showTime) {
        opts.hour = '2-digit';
        opts.minute = '2-digit';
      }
      return new Date(dateStr).toLocaleDateString(undefined, opts);
    },
    getYouTubeId(url) {
      if (!url) return null;
      const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&?/]+)/);
      return m ? m[1] : null;
    },
    getCodeTabs(block) {
      // Support both formats: tabs array (Plone content) or direct code/language (doc examples)
      if (block.tabs?.length) return block.tabs;
      if (block.code) return [{ '@id': this.block_uid + '-tab', code: block.code, language: block.language, label: block.title }];
      return [];
    },
    socialInfo(url) {
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        return SOCIAL_ICONS[hostname] || { ...DEFAULT_LINK_ICON, name: hostname };
      } catch {
        return DEFAULT_LINK_ICON;
      }
    },
    // Search block helpers
    getListingTotalResults(searchBlock) {
      const listingUid = searchBlock.blocks_layout?.listing?.[0];
      if (!listingUid) return null;
      const listingBlock = searchBlock.blocks?.[listingUid];
      return listingBlock?._paging?.totalItems || listingBlock?.items_total || null;
    },
    handleSearchSubmit(event) {
      const formData = new FormData(event.target);
      const searchText = formData.get('SearchableText');
      const url = new URL(window.location.href);
      if (searchText) {
        url.searchParams.set('SearchableText', searchText);
      } else {
        url.searchParams.delete('SearchableText');
      }
      window.location.href = url.toString();
    },
    handleSearchbarSearch(searchbar, query) {
      // F7 searchbar emits on each keystroke; navigate on Enter via submit
      this.currentSearchText = query;
    },
    handleSortChange(event) {
      const url = new URL(window.location.href);
      url.searchParams.set('sort_on', event.target.value);
      window.location.href = url.toString();
    },
    // Facet helpers
    getFacetField(facet) {
      if (typeof facet.field === 'object') {
        return facet.field?.value || '';
      }
      return facet.field || '';
    },
    getFacetOptions(facet) {
      const field = this.getFacetField(facet);
      return FACET_FIELD_OPTIONS[field] || [];
    },
    isFacetChecked(facet, value) {
      const field = this.getFacetField(facet);
      const url = new URL(window.location.href);
      const current = url.searchParams.getAll(`facet.${field}`);
      return current.includes(value);
    },
    handleFacetCheckboxChange(event) {
      const checkbox = event.target;
      const field = checkbox.dataset.field;
      const value = checkbox.value;
      const url = new URL(window.location.href);
      const paramKey = `facet.${field}`;
      const current = url.searchParams.getAll(paramKey);

      url.searchParams.delete(paramKey);
      if (checkbox.checked) {
        const newValues = [...current, value];
        newValues.forEach(v => url.searchParams.append(paramKey, v));
      } else {
        const newValues = current.filter(v => v !== value);
        newValues.forEach(v => url.searchParams.append(paramKey, v));
      }
      window.location.href = url.toString();
    },
    handleFacetSelectChange(event) {
      const select = event.target;
      const field = select.dataset.field;
      const value = select.value;
      const url = new URL(window.location.href);
      const paramKey = `facet.${field}`;

      if (value) {
        url.searchParams.set(paramKey, value);
      } else {
        url.searchParams.delete(paramKey);
      }
      window.location.href = url.toString();
    },
    // Form helpers
    getFormValue(blockUid, fieldId) {
      return this.formValues[blockUid]?.[fieldId] ?? '';
    },
    setFormValue(blockUid, fieldId, value) {
      if (!this.formValues[blockUid]) {
        this.formValues[blockUid] = {};
      }
      this.formValues[blockUid][fieldId] = value;
    },
    toggleMultiChoice(blockUid, fieldId, opt, checked) {
      const current = this.getFormValue(blockUid, fieldId) || [];
      const arr = Array.isArray(current) ? [...current] : [];
      if (checked) {
        if (!arr.includes(opt)) arr.push(opt);
      } else {
        const idx = arr.indexOf(opt);
        if (idx >= 0) arr.splice(idx, 1);
      }
      this.setFormValue(blockUid, fieldId, arr);
    },
    formFieldError(blockUid, fieldId) {
      return this.formState[blockUid]?.errors?.[fieldId] || '';
    },
    validateFormValues(blockUid, fields) {
      const errors = {};
      const vals = this.formValues[blockUid] || {};
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
    },
    async handleFormSubmit(event, formBlock) {
      const fields = formBlock.subblocks || [];
      const uid = this.block_uid;

      // Validate from reactive state
      const errors = this.validateFormValues(uid, fields);
      if (Object.keys(errors).length > 0) {
        this.formState[uid] = { errors };
        return;
      }

      // Collect submission data from reactive state
      const vals = this.formValues[uid] || {};
      const submitData = fields
        .filter(f => f.field_type !== 'static_text')
        .map(f => ({
          field_id: f.field_id,
          label: f.label,
          value: vals[f.field_id] ?? '',
        }));

      const apiUrl = unwrapRef(this.apiBase);
      const ctxPath = unwrapRef(this.contextPath);
      const response = await fetch(`${apiUrl}${ctxPath}/@submit-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ block_id: uid, data: submitData }),
      });
      if (response.ok || response.status === 204) {
        this.formState[uid] = { success: true };
      }
    },
  },
};
</script>

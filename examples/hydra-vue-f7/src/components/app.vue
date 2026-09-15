<template>
  <f7-app v-bind="f7params" >

  <!-- Left panel with cover effect-->
  <f7-panel left cover dark>
    <f7-view>
      <f7-page>
        <f7-navbar title="Left Panel"></f7-navbar>
        <f7-block>Left panel content goes here</f7-block>
      </f7-page>
    </f7-view>
  </f7-panel>


  <!-- Right panel with reveal effect-->
  <f7-panel @panel:open="refreshMenu"  right reveal dark>
    <SideMenu :key="number"/>
  </f7-panel>


  <!-- Your main view, should have "view-main" class -->
  <f7-view main class="safe-areas" url="/"></f7-view>


    <!-- Popup -->
    <f7-popup id="my-popup">
      <f7-view>
        <f7-page>
          <f7-navbar title="Popup">
            <f7-nav-right>
              <f7-link popup-close>Close</f7-link>
            </f7-nav-right>
          </f7-navbar>
          <f7-block>
            <p>Popup content goes here.</p>
          </f7-block>
        </f7-page>
      </f7-view>
    </f7-popup>

    <f7-login-screen id="my-login-screen">
      <f7-view>
        <f7-page login-screen>
          <f7-login-screen-title>Login</f7-login-screen-title>
          <f7-list form>
            <f7-list-input
              type="text"
              name="username"
              placeholder="Your username"
              v-model:value="username"
            ></f7-list-input>
            <f7-list-input
              type="password"
              name="password"
              placeholder="Your password"
              v-model:value="password"
            ></f7-list-input>
          </f7-list>
          <f7-list>
            <f7-list-button title="Sign In" @click="alertLoginData"></f7-list-button>
            <f7-block-footer>
              Some text about login information.<br>Click "Sign In" to close Login Screen
            </f7-block-footer>
          </f7-list>
        </f7-page>
      </f7-view>
    </f7-login-screen>
  </f7-app>
</template>
<script>
  import { ref, onMounted } from 'vue';
  import { f7, f7ready } from 'framework7-vue';


  import routes from '../js/routes.js';
  import store from '../js/store';
  import SideMenu from '../pages/sidenav.vue'
  import { initBridge, isEditMode } from '@hydra-js/hydra.js';
  // docPageDefinitions is the canonical schema bundle for the doc-blocks
  // examples. Without registering blocks, addNodeIdsToAllSlateFields can't
  // identify slate fields like highlight.description, so the bridge skips
  // assigning data-node-id and slate round-trip checks fail.
  import docPageDefinitions from '../../../../docs/examples/block-definitions.json';
  const docBlocksConfig = Object.fromEntries(
    Object.values(docPageDefinitions).flatMap((page) => Object.entries(page.blocks)),
  );


  export default {
    data() {
      return {
        number:0
      }
    },
    components: {
      SideMenu,
    },
    methods: {
          refreshMenu() {
            this.number++;
          }
        },
    setup() {
      // Framework7 Parameters
      const f7params = {
        name: 'My App', // App name
        theme: 'auto', // Automatic theme detection
        view: {
            browserHistory: true,
            browserHistorySeparator: '#!',
            browserHistoryOnLoad: true,
            browserHistoryStoreHistory: false,
            browserHistoryInitialMatch: false,
            preloadPreviousPage: false,
        },

        // App store
        store: store,
        // App routes
        routes: routes,
      };
      // Login screen data
      const username = ref('');
      const password = ref('');

      const alertLoginData = () => {
        f7.dialog.alert('Username: ' + username.value + '<br>Password: ' + password.value, () => {
          f7.loginScreen.close();
        });
      }

      // Only initialize the hydra bridge in edit mode
      if (isEditMode()) {
      initBridge({
        page: {
          schema: {
            properties: {
              blocks_layout: { title: 'Content', allowedBlocks: ['slate', 'image', 'video', 'teaser', 'title', 'description', 'introduction', 'leadimage', 'dateField', 'hero', 'columns', 'gridBlock', 'accordion', 'slider', 'listing', 'search', 'slateTable', 'heading', 'separator', 'button', 'highlight', 'maps', 'toc', 'form', 'codeExample', 'eventMetadata', 'socialLinks', 'suggest'] },
            },
          },
        },
        blocks: { ...docBlocksConfig },
        onEditChange: (data) => {
          const firstBlock = data?.blocks_layout?.items?.[0];
          const firstText = firstBlock && data?.blocks?.[firstBlock]?.value?.[0]?.children?.[0]?.text;
          console.log('[F7-EDIT] onEditChange, firstBlock:', firstBlock, 'text:', firstText?.substring(0, 30));
          store.state.content = data;
          // Always set apiBase — needed for listing/search API calls
          store.state.apiBase = import.meta.env.VITE_API_BASE_URL || "https://hydra-api.pretagov.com";
        },
      });
      }

      onMounted(() => {
        f7ready((f7) => {
          const navigateFromHash = () => {
            const hash = window.location.href.split("#!")[1];
            if (hash) {
              f7.views.main.router.navigate(hash);
            }
          };

          window.addEventListener("hashchange", navigateFromHash);

          // Navigate to initial hash path on first load
          navigateFromHash();
        });
      });
      const panelComponent = null;
      const panelProps = {navigation:[]};
      var number =0;
      return {
        f7params,
        username,
        password,
        alertLoginData,
        panelComponent,
        panelProps
      }
    }
  }
</script>../js/store.js

import Page from '../pages/page.vue';
import NotFoundPage from '../pages/404.vue';
import axios from 'axios';
import { isEditMode } from '@hydra-js/hydra.js';
import { loadTemplates } from '@hydra-js/helpers';

// Shared template cache across route navigations
const templateCache = {};

var routes = [
  {
    path: '{/:path}*',
    async: function ({ router, to, resolve }) {
      var app = router.app;
      var path = to.path;

      // In edit mode, hydra.js sends content via onEditChange — skip API fetch
      if (isEditMode()) {
        resolve({ component: Page });
        return;
      }

      app.preloader.show();

      const url = new URL(window.location.href);
      const token = url.searchParams.get("access_token");
      var headers = {};
      if (token) {
        headers = {'Authorization': 'Bearer '+token};
      };
      const apiBase = import.meta.env.VITE_API_BASE_URL || "https://hydra-api.pretagov.com";
      // `templates` asks a backend with the inkaengine.inka addon to return every template
      // the page needs in this same response; loadTemplates (below) uses those and only
      // fetches what is missing. A backend without the addon ignores it, and templates are
      // fetched as before.
      const api = `${apiBase}/++api++${path}?expand=breadcrumbs,navroot,navigation,templates&expand.navigation.depth=2`;
      axios.get(api, {headers}).then(async (response) => {
        const data = response.data;

        // Pre-load templates referenced by page content
        const loadTemplate = async (templateId) => {
          const tplPath = templateId.startsWith('http')
            ? new URL(templateId).pathname
            : `/${templateId.replace(/^\//, '')}`;
          const tplUrl = `${apiBase}/++api++${tplPath}`;
          const tplResponse = await axios.get(tplUrl, { headers });
          return tplResponse.data;
        };
        const { templates, errors } = await loadTemplates(data, loadTemplate, templateCache);
        if (errors.length) {
          console.warn('[routes] Failed to load templates:', errors.map(e => `${e.templateId}: ${e.error?.message || e.error}`).join('; '));
        }

        app.store.state.content = data;
        app.store.state.templates = templates;
        app.store.state.apiBase = apiBase;
        app.store.state.contextPath = path;
        app.store.state.navigation = data["@components"].navigation.items;
        app.preloader.hide();

        resolve({ component: Page });
      });
    }
  },
  {
    path: '(.*)',
    component: NotFoundPage,
  },
];

export default routes;

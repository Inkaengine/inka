import { loadTemplates } from '#utils/helpers';

// Shared template cache across renders
const templateCache = {};

export async function fetchContent(apiPath, { token = null, path = '' } = {}) {
    // Construct the full URL with navigation expansion (like Nuxt frontend)
    const url = `${apiPath}/++api++/${path ? `${path}` : ''}?expand=breadcrumbs,navigation&expand.navigation.depth=2`;

    // Set up the headers
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Never cache content. This app is a live preview: the editor changes a
    // page and expects to see it, and the page-integrity crawl proved the cost
    // of the default — a page kept serving links that had since been fixed in
    // the content, so the run failed on a state no file was in any more.
    const response = await fetch(url, { headers, cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Error: ${response.statusText}`);
    }
    const data = await response.json();

    // Pre-load templates referenced by the page content
    const loadTemplate = async (templateId) => {
      const tplPath = templateId.startsWith('http')
        ? new URL(templateId).pathname
        : `/${templateId.replace(/^\//, '')}`;
      const tplUrl = `${apiPath}/++api++${tplPath}`;
      const tplResponse = await fetch(tplUrl, { headers, cache: 'no-store' });
      if (!tplResponse.ok) {
        throw new Error(`Failed to fetch template: ${templateId}`);
      }
      return tplResponse.json();
    };
    const { templates, errors } = await loadTemplates(data, loadTemplate, templateCache);
    if (errors.length) {
      console.warn('[fetchContent] Failed to load templates:', errors.map(e => `${e.templateId}: ${e.error?.message || e.error}`).join('; '));
    }

    // Separate @components (navigation, breadcrumbs) from page data
    const components = data['@components'] || {};
    delete data['@components'];

    return {
      ...data,
      _templates: templates,
      _navigation: components.navigation?.items || [],
      _breadcrumbs: components.breadcrumbs?.items || [],
    };
  }
  
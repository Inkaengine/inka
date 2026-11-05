<template>
  <!-- Hosts this frontend's CMS adapter for the admin; renders nothing. -->
  <div />
</template>

<script setup>
/**
 * The proxy frame: this frontend's CMS adapter, and nothing else.
 *
 * The admin holds no CMS credentials and never talks to the CMS itself. It
 * mounts this page once, in a hidden iframe named `hydra-proxy:<admin origin>`,
 * and sends every CMS request here; the adapter answers them. It stays mounted
 * for the whole session, whatever the editor is looking at — which is why it is
 * a route of its own, outside the catch-all that renders the site.
 *
 * This site is backed by Plone, so it hosts a PloneAdapter, pointed at the same
 * backend the site renders from. The admin hands over the session it already has
 * as ?access_token=, read on every request so a renewed token is picked up. A
 * frontend on another CMS would construct that CMS's adapter here instead;
 * nothing in the admin changes.
 */
import { onMounted } from 'vue';
import { connectProxy } from '@hydra-js/hydra.js';
import { PloneAdapter } from '@volto-hydra/hydra-adapters-plone';

const cmsBaseUrl = useRuntimeConfig().public.backendBaseUrl;

onMounted(() => {
  if (!cmsBaseUrl) {
    throw new Error(
      '[hydra-proxy] runtimeConfig.public.backendBaseUrl is not set, so this ' +
        'frontend does not know which CMS its adapter should talk to.',
    );
  }
  const token = new URLSearchParams(window.location.search).get('access_token');
  connectProxy(
    new PloneAdapter({ cmsBaseUrl, getAuthToken: () => token }),
    { cmsBaseUrl },
  );
});
</script>

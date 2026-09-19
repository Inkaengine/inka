// Not shown in the docs — mounts the page component so the snippet runs as a
// real app for the bridge selection test. In a SvelteKit app this is the
// framework's job; here it is one line.
import { mount } from 'svelte'
import Page from './page.svelte'

mount(Page, { target: document.getElementById('app') })

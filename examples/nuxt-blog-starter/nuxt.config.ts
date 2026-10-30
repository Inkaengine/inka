import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const hydraJsPath = resolve(__dirname, '../../packages/hydra-js')
const helpersPath = resolve(__dirname, '../../packages/helpers')
const fixturesPath = resolve(__dirname, '../../tests-playwright/fixtures')

// The mock API and admin origins the test profile talks to. package.json's
// dev:test takes these ports from HYDRA_MOCK_API_PORT / HYDRA_VOLTO_SSR_PORT,
// but the CSP below hardcoded 8888/3001 — so running the example on any other
// port block (as a parent repo must, to avoid binding hydra's defaults) had
// every API fetch blocked by CSP: no content, and a null deref in
// onEditChange that reads as "the frontend never rendered".
//
// Only a TEST build has these at all, which is why they are read here rather
// than defaulted. The fallback that used to sit here was both the hazard this
// file already describes — a default nobody has to set, so a run on another
// block silently keeps 8888 — and a small embarrassment in the other
// direction: a PUBLIC canvas deploy advertised `localhost:8888` in its own
// Content-Security-Policy, because these were computed whether or not any
// local server existed.
//
// NUXT_TEST_BACKEND is what says "this is a test build" (the same flag
// EDIT_ADMIN reads below), and then the ports must be given.
const localOrigin = (name: string): string | null => {
  if (!process.env.NUXT_TEST_BACKEND) return null;
  const port = process.env[name];
  if (!port) {
    throw new Error(
      `${name} is not set. A test build of this example talks to hydra's ` +
        `local servers, and their ports have no defaults — binding hydra's ` +
        `historical numbers is what lets one checkout take over another's. ` +
        `Set HYDRA_PORT_BASE (see tests-playwright/ports.ts) or this one port.`,
    );
  }
  return `http://localhost:${port}`;
};
const MOCK_API_ORIGIN = localOrigin('HYDRA_MOCK_API_PORT');
const ADMIN_ORIGIN = localOrigin('HYDRA_VOLTO_SSR_PORT');

// The PUBLIC deploy's backend (the builder sets NUXT_TEST_BACKEND). The image
// provider (ipxStatic) fetches source images from here at BUILD time, so it must
// match the API the prerender pulls content from — a hardcoded host means the
// build fetches /docs/images/*/@@images/* from the WRONG backend and every doc
// image 404s, failing the prerender. Fallback is the historical default.
const PUBLIC_BACKEND = process.env.NUXT_TEST_BACKEND || 'https://api.inka.sh';
const PUBLIC_BACKEND_HOST = new URL(PUBLIC_BACKEND).host;

// The admin the EDIT build talks to. A deploy names it (NUXT_ADMIN_URL); a
// test build that names only a backend means the local admin. Ignoring
// NUXT_ADMIN_URL here shipped inka.sh/edit/ waiting for localhost:3001.
const EDIT_ADMIN = process.env.NUXT_ADMIN_URL
  || (process.env.NUXT_TEST_BACKEND ? ADMIN_ORIGIN! : 'https://admin.inka.sh');
// What the edit build may fetch from: the API it is built against and its
// admin (the public defaults and the local test servers too). A CSP naming
// only api.inka.sh blocked a build against any other API: no content, and a
// 500 ("Template … not found in pre-loaded templates").
const EDIT_SOURCES = [...new Set([
  "'self'", 'data:',
  'https://admin.inka.sh', 'https://api.inka.sh',
  new URL(PUBLIC_BACKEND).origin, new URL(EDIT_ADMIN).origin,
  // Absent from a public build: there is no local admin or mock API to allow.
  ADMIN_ORIGIN, MOCK_API_ORIGIN,
].filter(Boolean))];

export default defineNuxtConfig({
  nitro: {
    preset: 'static',
    prerender: {
      // Deploy sets NUXT_PRERENDER_STRICT=1 (see scripts/netlify-build.sh): fail the build
      // on ANY prerender error — page OR IPX image route — and print the REAL error, rather
      // than silently shipping broken images. Off by default so a local dev build without a
      // fully-imported API/blobs can still complete despite IPX 500s.
      failOnError: process.env.NUXT_PRERENDER_STRICT === '1',
      requestTimeout: 30000, // 30s timeout for SSG fetch requests (default 10s)
      // Cap at 2 parallel routes. Nitro defaults to 1 (serial). The
      // deployed Plone API is a single small (512MB) auto-suspending
      // instance, so 2 keeps the build faster than serial without
      // overwhelming a cold instance.
      concurrency: 2,
      // IPX build cache: skip re-rendering /_ipx image variants already on disk
      // in the persistent cache dir, so unchanged images aren't re-baked. The
      // builder mounts a Fly volume and sets NUXT_IPX_CACHE_DIR; run-build.sh
      // restores the skipped files into the output afterward. Only active when
      // NUXT_IPX_CACHE_DIR is set (the builder) — dev/test generate every
      // variant normally. (An image replaced in place keeps its source-URL /_ipx
      // key, so it stays cached until IPX_CACHE_CLEAR=1 forces a re-bake.)
      ignore: process.env.NUXT_IPX_CACHE_DIR
        ? [(path: string) => path.startsWith('/_ipx/')
            && existsSync(join(process.env.NUXT_IPX_CACHE_DIR as string, path))]
        : undefined,
    },
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'en',
      },
      // The Inka mark; the .ico and touch icon come from favicon.svg via scripts/icons.mjs.
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
  modules: [
    '@nuxtjs/tailwindcss', 
    'nuxt-security', 
    '@nuxt/image'
  ],
  ssr: true, // "npm run generate" == SSG
  vue: {
    compilerOptions: {
      comments: true, // Preserve HTML comments for hydra comment syntax
    },
  },
  routeRules: {
    "/**": { cors: true } // public site can't be edited
  },
  $env: {
    edit: {
      ssr: false, // "npm run generate -- --envName edit" == SPA
      vue: {
        compilerOptions: {
          comments: true,  // Preserve HTML comments for hydra comment syntax
        },
      },
      app: {
        baseURL: process.env.NUXT_EDIT_BASE_URL || '/',
      },
      // The canvas as deployed (`pnpm run canvas`): one static file, with the
      // page in the hash (`/canvas/#/<page>`), so any static host serves every
      // page with no routing rules. The admin puts the page there when the
      // front end's address has a hash. The dev server (dev:test) routes paths
      // itself, so it keeps path routing.
      router: {
        options: { hashMode: process.env.NUXT_EDIT_HASH_ROUTING === 'true' },
      },
      // The canvas builds into folders of its own (.nuxt-canvas,
      // .output-canvas), so a later build (the tests' build:test) leaves it in
      // place. Building it still empties .output (Nitro's prerender prepares
      // the default output folder), so build it before, never beside, a build
      // that is being served from there.
      buildDir: process.env.NUXT_EDIT_BUILD_DIR || '.nuxt',
      nitro: {
        preset: 'static',
        output: { dir: process.env.NUXT_EDIT_OUTPUT_DIR || '.output' },
      },
      routeRules: {
        "/**": {
          cors: true,
          security: {
            headers: { // Edit site can be put in an iframe
              contentSecurityPolicy: {
                'img-src': EDIT_SOURCES,
                'connect-src': EDIT_SOURCES,
                'frame-ancestors': ['*']
              },
              crossOriginResourcePolicy: "cross-origin",
              xFrameOptions: false
            }
          }
        }
      },
      runtimeConfig: {
        public: {
          image_alias: '',
          // Override API URL for test builds (NUXT_TEST_BACKEND env var)
          backendBaseUrl: process.env.NUXT_TEST_BACKEND || 'https://api.inka.sh',
          adminUrl: EDIT_ADMIN,
        }
      },
      image: {
        provider: 'none',
      }
    },
    test: {
      // Test environment: HTTP mode, points to the mock API (NUXT_TEST_BACKEND, from HYDRA_MOCK_API_PORT)
      ssr: false,
      vue: {
        compilerOptions: {
          comments: true,  // Preserve HTML comments for hydra comment syntax
        },
      },
      nitro: {
        preset: 'static'  // SPA with proper fallback routing (same as edit profile)
      },
      devtools: { enabled: false },
      devServer: {
        https: false  // Disable HTTPS for test mode
      },
      // Disable rate limiting for tests
      security: {
        rateLimiter: false
      },
      routeRules: {
        "/**": {
          cors: true,
          security: {
            headers: {
              contentSecurityPolicy: {
                'img-src': ["'self'", "data:", ADMIN_ORIGIN, MOCK_API_ORIGIN, 'https://placehold.co'],
                'connect-src': ["'self'", "data:", ADMIN_ORIGIN, MOCK_API_ORIGIN],
                'frame-ancestors': ['*']
              },
              crossOriginResourcePolicy: "cross-origin",
              xFrameOptions: false
            },
            rateLimiter: false
          }
        }
      },
      runtimeConfig: {
        public: {
          image_alias: '',
          backendBaseUrl: MOCK_API_ORIGIN,
          adminUrl: ADMIN_ORIGIN,
        }
      },
      image: {
        provider: 'ipx',
        domains: ['localhost'],
      }
    }
  },
  runtimeConfig: {
    public: {
      image_alias: '_plone_', // needed so we don't use image alias when no SSR
      // The PUBLIC SSG build (`pnpm run generate`, default env) bakes these into
      // the client bundle, so they must be the deploy's real backend — NOT a
      // hardcoded host. The builder sets NUXT_TEST_BACKEND (the API the
      // prerender also fetches from, see netlify-build.sh) and NUXT_ADMIN_URL.
      // The api.inka.sh / admin.inka.sh fallbacks are only for a plain local build.
      backendBaseUrl: process.env.NUXT_TEST_BACKEND || 'https://api.inka.sh',
      adminUrl: process.env.NUXT_ADMIN_URL || 'https://admin.inka.sh',
      // The admin has a demo account (Inka's /login?demo): the header offers
      // "Try editing now" instead of the plain login.
      demoEditing: process.env.NUXT_DEMO_EDITING === 'true',
      // The public site, for social previews' absolute og:url / og:image.
      siteUrl: 'https://inka.sh',
      siteName: 'Inka',
    },
  },
  css: ['/assets/css/main.css'],
  // devtools off: when the frontend is embedded in the admin iframe (cross-origin),
  // Nuxt DevTools throws `SecurityError: ... __NUXT_DEVTOOLS_DISABLE__ ... cross-origin
  // frame` trying to read the parent window, which breaks iframe access in dev-mode
  // tests (dev:test). Not needed for this example/test fixture.
  devtools: { enabled: false },
  // postcss: {
  //   plugins: {
  //     tailwindcss: {},
  //     autoprefixer: {},
  //   },
  // },
  image: {
    provider: 'ipx',
    // The backend host must be allow-listed AND the `_plone_` alias must point at
    // it, or ipxStatic can't fetch the source doc images at build time.
    domains: [PUBLIC_BACKEND_HOST, 'api.inka.sh', 'admin.inka.sh'],
    alias: {
      '_plone_': PUBLIC_BACKEND,
    },
  },
  experimental: {
      payloadExtraction: false
  },

  // How to prerender dynamic routes?
  // generate routes -  https://medium.com/js-dojo/how-i-generated-dynamic-routes-for-different-nuxt-js-pages-ce2ee6972743
  // crawlpages (allows some dynamic to still work) - https://stackoverflow.com/questions/77292506/how-to-make-nuxt-3-correctly-build-ssg-pages-dynamic-api-routes

  router: {
      options: {
          strict: false
      }
  },
  vite: {
    // Force pre-bundle these deps at startup to avoid 504 timeouts in CI
    optimizeDeps: {
      include: ['flowbite', 'errx'],
    },
    server: {
      watch: {
        // Reduce file watchers - prevents EMFILE errors
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/.nuxt/**',
          '**/.output/**',
          '**/coverage/**',
          '**/test-results/**',
          '**/playwright-report/**',
          '**/*.log',
        ],
        usePolling: false,  // Use native fs events (more efficient)
      }
    },
    plugins: [
      // mkcert disabled - certs already generated manually. Re-enabling it
      // needs `import mkcert from 'vite-plugin-mkcert'` back at the top; the
      // unused import made merely LOADING this config need the starter's own
      // install, which the config tests (tests-playwright/fixtures) do not have.
      // mkcert({
      //   savePath: './certs',
      //   force: false,
      //   mkcertPath: '/usr/local/bin/mkcert',
      // }),
    ],
    resolve: {
      alias: {
        // Always use workspace source — Vite/Nuxt bundles tabbable automatically
        '@hydra-js/hydra.js': resolve(hydraJsPath, 'hydra.src.js'),
        // The adapter the proxy frame hosts (pages/hydra-proxy.html.vue). This
        // app sits outside the pnpm workspace, so the adapter and the core it
        // imports are resolved from source like hydra-js itself.
        '@volto-hydra/hydra-adapters-plone': resolve(hydraJsPath, '../hydra-adapters-plone/index.js'),
        '@volto-hydra/hydra-adapters-core': resolve(hydraJsPath, '../hydra-adapters-core/baseAdapter.js'),
        '@hydra-js/helpers': resolve(helpersPath, 'index.js'),
        '@hydra-js': hydraJsPath,
        '@test-fixtures': fixturesPath
      }
    },
        /* options for vite */
    // ssr: true // enable unstable server-side rendering for development (false by default)
    // experimentWarning: false // hide experimental warning message (disabled by default for tests)
    vue: {
      template: {
        compilerOptions: {
          comments: true, // Preserve HTML comments for hydra comment syntax
        },
      },
    },
  },
  devServer: {
    // HTTPS disabled by default - use HTTP for local development
    // For HTTPS, generate certs with mkcert and uncomment:
    // https: {
    //   cert: './certs/cert.pem',
    //   key: './certs/dev.pem'
    // }
  },
  sourcemap: {
    server: true,
    client: true
  },
  compatibilityDate: '2024-11-20'
});
import mkcert from 'vite-plugin-mkcert'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const hydraJsPath = resolve(__dirname, '../../packages/hydra-js')
const helpersPath = resolve(__dirname, '../../packages/helpers')
const fixturesPath = resolve(__dirname, '../../tests-playwright/fixtures')

// The mock API and admin origins the test/edit profiles talk to. package.json's
// dev:test already takes these ports from HYDRA_MOCK_API_PORT /
// HYDRA_VOLTO_SSR_PORT, but the CSP below hardcoded 8888/3001 — so running the
// example on any other port block (as a parent repo must, to avoid binding
// hydra's defaults) had every API fetch blocked by CSP: no content, and a null
// deref in onEditChange that reads as "the frontend never rendered".
const MOCK_API_ORIGIN = `http://localhost:${process.env.HYDRA_MOCK_API_PORT || 8888}`;
const ADMIN_ORIGIN = `http://localhost:${process.env.HYDRA_VOLTO_SSR_PORT || 3001}`;

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
    },
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'en',
      },
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
      nitro: {
        preset: 'static'
      },
      routeRules: {
        "/**": {
          cors: true,
          security: {
            headers: { // Edit site can be put in an iframe
              contentSecurityPolicy: {
                'img-src': ["'self'", "data:", 'https://hydra.pretagov.com', 'https://hydra-api.pretagov.com', ADMIN_ORIGIN, MOCK_API_ORIGIN],
                'connect-src': ["'self'", "data:", 'https://hydra.pretagov.com', 'https://hydra-api.pretagov.com', ADMIN_ORIGIN, MOCK_API_ORIGIN],
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
          backendBaseUrl: process.env.NUXT_TEST_BACKEND || 'https://hydra-api.pretagov.com',
          // The admin's port is overridable like every other (ports.ts), and a
          // literal 3001 pointed test builds at whatever else was on it.
          adminUrl: process.env.NUXT_TEST_BACKEND
            ? `http://localhost:${process.env.HYDRA_VOLTO_SSR_PORT || 3001}`
            : 'https://hydra.pretagov.com',
        }
      },
      image: {
        provider: 'none',
      }
    },
    test: {
      // Test environment: HTTP mode, points to mock API on localhost:8888
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
      backendBaseUrl: 'https://hydra-api.pretagov.com',
      adminUrl: 'https://hydra.pretagov.com',
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
    domains: ['hydra-api.pretagov.com','hydra.pretagov.com'],
    alias: {
      '_plone_': "https://hydra-api.pretagov.com"
    }
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
      // mkcert disabled - certs already generated manually
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
/**
 * Routes - Customized for Volto Hydra
 * Combined "/" and "/**" View routes into single entry to prevent remount on navigation
 * @module routes
 */
import debug from 'debug';
import compact from 'lodash/compact';

import Add from '@plone/volto/components/manage/Add/Add';
import Aliases from '@plone/volto/components/manage/Aliases/Aliases';
import ChangePassword from '@plone/volto/components/manage/Preferences/ChangePassword';
import ContactForm from '@plone/volto/components/theme/ContactForm/ContactForm';
import CreateTranslation from '@plone/volto/components/manage/Multilingual/CreateTranslation';
import Delete from '@plone/volto/components/manage/Delete/Delete';
import Diff from '@plone/volto/components/manage/Diff/Diff';
import Edit from '@plone/volto/components/manage/Edit/Edit';
import History from '@plone/volto/components/manage/History/History';
import LinksToItem from '@plone/volto/components/manage/LinksToItem/LinksToItem';
import Login from '@plone/volto/components/theme/Login/Login';
import Logout from '@plone/volto/components/theme/Logout/Logout';
import ManageTranslations from '@plone/volto/components/manage/Multilingual/ManageTranslations';
import NotFound from '@plone/volto/components/theme/NotFound/NotFound';
import PasswordReset from '@plone/volto/components/theme/PasswordReset/PasswordReset';
import Register from '@plone/volto/components/theme/Register/Register';
import RequestPasswordReset from '@plone/volto/components/theme/PasswordReset/RequestPasswordReset';
import Search from '@plone/volto/components/theme/Search/Search';
import Sharing from '@plone/volto/components/manage/Sharing/Sharing';
import Sitemap from '@plone/volto/components/theme/Sitemap/Sitemap';
import PersonalInformation from '@plone/volto/components/manage/Preferences/PersonalInformation';

import { Contents } from '@plone/volto/components/manage/Contents';
import { Rules } from '@plone/volto/components/manage/Rules';
import {
  RulesControlpanel,
  AddRuleControlpanel,
  EditRuleControlpanel,
  ConfigureRuleControlpanel,
  UsersControlpanel,
  UserGroupMembershipControlPanel,
  GroupsControlpanel,
  AddonsControlpanel,
  AliasesControlpanel,
  ContentType,
  ContentTypeLayout,
  ContentTypeSchema,
  ContentTypes,
  Controlpanel,
  Controlpanels,
  DatabaseInformation,
  ModerateComments,
  RelationsControlpanel,
  UndoControlpanel,
  UpgradeControlPanel,
} from '@plone/volto/components/manage/Controlpanels';
import BlockTypesControlpanel from '@plone/volto/components/manage/Controlpanels/BlockTypes';
import BlockTypeControlpanel from '@plone/volto/components/manage/Controlpanels/BlockType';

import withClientSideContent from '@plone/volto/helpers/Content/withClientSideContent';
import withClientSideAsyncConnect from '../../bridge/withClientSideAsyncConnect';

import App from '@plone/volto/components/theme/App/App';
import View from '@plone/volto/components/theme/View/View';

import config from '@plone/volto/registry';

/**
 * Default routes array.
 * @array
 * @returns {array} Routes.
 */
export const multilingualRoutes = [
  // HYDRA: These are content paths the frontend handles.
  // {
  //   path: `/(${config.settings?.supportedLanguages.join('|')})/sitemap`,
  //   component: Sitemap,
  // },
  // {
  //   path: `/(${config.settings?.supportedLanguages.join('|')})/search`,
  //   component: Search,
  // },
  // {
  //   path: `/(${config.settings?.supportedLanguages.join('|')})/contact-form`,
  //   component: ContactForm,
  // },
  {
    path: `/(${config.settings?.supportedLanguages.join('|')})/change-password`,
    component: ChangePassword,
  },
  {
    path: `/(${config.settings?.supportedLanguages.join('|')})/register`,
    component: Register,
  },
  {
    path: `/(${config.settings?.supportedLanguages.join('|')})/passwordreset`,
    component: RequestPasswordReset,
    exact: true,
  },
  {
    path: `/(${config.settings?.supportedLanguages.join(
      '|',
    )})/passwordreset/:token`,
    component: PasswordReset,
    exact: true,
  },
];

export function getExternalRoutes() {
  return compact(
    (config.settings?.externalRoutes || []).map((route) => {
      const newRoute = {
        component: NotFound,
      };
      if (typeof route.match === 'string') {
        newRoute.path = route.match;
        return newRoute;
      } else if (
        typeof route.match === 'object' &&
        !Array.isArray(route.match)
      ) {
        return {
          ...newRoute,
          ...route.match,
        };
      } else {
        debug('routes')(
          'Got invalid externalRoute, please check the configuration.',
        );
        return null;
      }
    }),
  );
}

export const defaultRoutes = [
  // redirect to external links if path is in blacklist
  ...getExternalRoutes(),
  ...(config.settings?.isMultilingual !== false ? multilingualRoutes : []),
  // REMOVED: Separate "/" exact route - now combined with "/**" below
  // {
  //   path: '/',
  //   component: View,
  //   exact: true,
  // },
  {
    path: ['/login', '/**/login'],
    component: Login,
  },
  {
    path: ['/logout', '/**/logout'],
    component: Logout,
  },
  // HYDRA: These are content paths the frontend handles.
  // Keeping them would prevent editing content at those paths.
  // {
  //   path: '/sitemap',
  //   component: Sitemap,
  // },
  // {
  //   path: '/search',
  //   component: Search,
  // },
  // {
  //   path: '/contact-form',
  //   component: ContactForm,
  // },
  {
    path: '/controlpanel',
    exact: true,
    component: Controlpanels,
  },
  {
    path: '/controlpanel/dexterity-types/:id/layout',
    component: ContentTypeLayout,
  },
  {
    path: '/controlpanel/dexterity-types/:id/schema',
    component: ContentTypeSchema,
  },
  {
    path: '/controlpanel/dexterity-types/:id',
    component: ContentType,
  },
  {
    path: '/controlpanel/dexterity-types',
    component: ContentTypes,
  },
  {
    path: '/controlpanel/addons',
    component: AddonsControlpanel,
  },
  {
    path: '/controlpanel/undo',
    component: UndoControlpanel,
  },
  {
    path: '/controlpanel/database',
    component: DatabaseInformation,
  },
  {
    path: '/controlpanel/aliases',
    component: AliasesControlpanel,
  },
  {
    path: '/controlpanel/moderate-comments',
    component: ModerateComments,
  },
  {
    path: '/controlpanel/users',
    component: UsersControlpanel,
  },
  {
    path: '/controlpanel/usergroupmembership',
    component: UserGroupMembershipControlPanel,
  },
  {
    path: '/controlpanel/groups',
    component: GroupsControlpanel,
  },
  {
    path: '/controlpanel/plone-upgrade',
    component: UpgradeControlPanel,
  },
  {
    path: '/controlpanel/rules/:id/configure',
    component: ConfigureRuleControlpanel,
  },
  {
    path: '/controlpanel/rules/:id/edit',
    component: EditRuleControlpanel,
  },
  {
    path: '/controlpanel/rules/add',
    component: AddRuleControlpanel,
  },
  {
    path: '/controlpanel/rules',
    component: RulesControlpanel,
  },
  {
    path: '/controlpanel/relations',
    component: RelationsControlpanel,
  },
  {
    path: '/controlpanel/block-types/:id',
    component: BlockTypeControlpanel,
  },
  {
    path: '/controlpanel/block-types',
    component: BlockTypesControlpanel,
  },
  {
    path: '/controlpanel/:id',
    component: Controlpanel,
  },
  {
    path: '/change-password',
    component: ChangePassword,
  },
  {
    path: ['/add', '/**/add'],
    component: Add,
  },
  {
    path: ['/edit', '/**/edit'],
    component: withClientSideContent(Edit),
  },
  {
    path: ['/contents', '/**/contents'],
    // Its asyncConnect fetches the object actions, which it refuses to render
    // without; in a bridge session no server pass runs it. See the HOC.
    component: withClientSideAsyncConnect(Contents),
  },
  {
    path: ['/sharing', '/**/sharing'],
    component: Sharing,
  },
  {
    path: '/rules',
    component: Rules,
  },
  {
    path: '/**/create-translation',
    component: CreateTranslation,
  },
  {
    path: '/**/rules',
    component: Rules,
  },
  {
    path: '/**/aliases',
    component: Aliases,
  },
  {
    path: '/**/delete',
    component: Delete,
  },
  {
    path: '/**/diff',
    component: Diff,
  },
  {
    path: '/**/historyview',
    component: History,
  },
  {
    path: '/**/manage-translations',
    component: ManageTranslations,
  },
  {
    path: '/links-to-item',
    component: LinksToItem,
  },
  {
    path: '/**/links-to-item',
    component: LinksToItem,
  },
  {
    path: '/register',
    component: Register,
  },
  {
    path: '/passwordreset',
    component: RequestPasswordReset,
    exact: true,
  },
  {
    path: '/passwordreset/:token',
    component: PasswordReset,
    exact: true,
  },
  {
    path: '/personal-information',
    component: PersonalInformation,
    exact: true,
  },
  // HYDRA: Combined "/" and "/**" into single route to prevent View remount on navigation
  {
    path: ['/', '/**'],
    component: View,
  },
  {
    path: '*',
    component: NotFound,
  },
];

/**
 * Routes array.
 * @array
 * @returns {array} Routes.
 */
const routes = [
  {
    path: '/',
    component: App,
    routes: [
      // addon routes have a higher priority then default routes
      ...(config.addonRoutes || []),
      ...defaultRoutes,
    ],
  },
];

/**
 * Render nothing on the server when the admin is bridge-backed.
 *
 * Volto server-renders because its usual job is being a public frontend, where
 * prefetching the page for anonymous visitors and search engines is the whole
 * point. A Hydra admin is not that. Its content comes from the adapter in an
 * iframe that does not exist until the browser makes one, so there is nothing
 * the server can render and nothing it can fetch — and every attempt to try
 * has been a bug: asyncConnect prefetching from whichever CMS the admin was
 * built against (the Drupal journey 404'd because the admin asked Plone for a
 * path only Drupal had), and a token-renewal timer POSTing to the same place.
 *
 * So the server bundle swaps every route component for one that renders
 * nothing. `loadOnServer` finds no `reduxAsyncConnect` to prefetch, and
 * `renderToString` produces an empty body — the document still carries the
 * scripts, styles and serialised store, and the client mounts the real app.
 *
 * This is only correct because the client MOUNTS rather than hydrates in
 * bridge mode; see the start-client customization. Making one of these changes
 * without the other gives React an empty container to hydrate against.
 *
 * Server-side redirects and status codes go with it: nothing renders, so
 * nothing sets StaticRouter's context. The client decides both instead, which
 * for an authenticated editor it had to anyway.
 */
const RendersNothing = () => null;
RendersNothing.displayName = 'NoServerRender';

function withoutServerRender(routeList) {
  return routeList.map((route) => {
    const stripped = { ...route };
    if (route.component) stripped.component = RendersNothing;
    if (route.routes) stripped.routes = withoutServerRender(route.routes);
    return stripped;
  });
}

const isServer = typeof window === 'undefined';

export default config.settings.useBridgeBackend && isServer
  ? withoutServerRender(routes)
  : routes;

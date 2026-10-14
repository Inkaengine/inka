<?php
/**
 * Plugin Name: Hydra Companion
 * Description: Exposes WordPress's own edit locks over the REST API, so a headless editor can tell whether someone else is already editing a post.
 * Version: 1.0.0
 *
 * WHY THIS EXISTS
 *
 * WordPress HAS edit locking — `_edit_lock` post meta, written by
 * wp_set_post_lock(), which is what makes wp-admin say "Someone else is editing
 * this post". It is simply not reachable over the REST API: `_edit_lock` is
 * protected meta, and protected meta is neither readable nor writable through
 * REST unless something registers it.
 *
 * So a headless editor has no way to ask the question, and two editors overwrite
 * each other with no warning. This plugin does not invent a lock; it exposes the
 * one WordPress already keeps, which is why wp-admin and a headless editor
 * interoperate: lock a post here and wp-admin reports it taken, and the reverse.
 *
 * It does NOT expose menus: WPGraphQL plus wp-graphql-polylang serve those to an
 * anonymous client, which is the stack a headless WordPress site would already be
 * running. This plugin covers only what nothing else does.
 *
 * It also exposes POLYLANG's translation groups, for the same reason: Polylang
 * keeps one post per language and relates them, and it ships REST routes for the
 * language LIST but none for a given post's language or its translation group. So
 * a headless editor can see which languages a site has and not which of them a
 * page already exists in.
 *
 * The adapter only advertises the `locking` capability when told this plugin is
 * installed (`new WordPressAdapter({ locking: true })`), because advertising a
 * lock field without the operations behind it is actively harmful — Volto locks
 * on `content.lock !== undefined` alone, and a failed lock shares a reducer
 * branch with a failed GET, so it blanks the loaded content and no edit form
 * renders at all.
 */

if (!defined('ABSPATH')) {
    exit;
}

/** How long a lock stays valid without being refreshed. WordPress's own default. */
function hydra_lock_window()
{
    /** This is the filter wp-admin's lock honours, so both agree. */
    return (int) apply_filters('wp_check_post_lock_window', 150);
}

/**
 * The lock on a post, as data.
 *
 * Deliberately NOT wp_check_post_lock(): that returns false when the CURRENT
 * user holds the lock, because its question is "should I warn this user". The
 * question here is "is this post locked, and by whom", which a headless editor
 * needs answered the same way no matter who is asking.
 */
function hydra_lock_state($post_id)
{
    $raw = get_post_meta($post_id, '_edit_lock', true);
    if (!$raw) {
        return array('locked' => false);
    }

    $parts = explode(':', (string) $raw);
    $time = isset($parts[0]) ? (int) $parts[0] : 0;
    $user_id = isset($parts[1]) ? (int) $parts[1] : 0;

    // An abandoned lock is not a lock. Without this, closing a tab would lock a
    // post until someone cleared the meta by hand.
    if ($time < time() - hydra_lock_window()) {
        return array('locked' => false);
    }

    $user = $user_id ? get_userdata($user_id) : null;

    return array(
        'locked' => true,
        // The stored value IS the token: it carries both holder and time, so a
        // later unlock can prove it is the holder rather than a steal.
        'token' => (string) $raw,
        'creator' => $user ? $user->user_login : null,
        'name' => $user ? $user->display_name : null,
        'created' => gmdate('c', $time),
        'timeout' => hydra_lock_window(),
        // Whether THIS caller may take it without stealing.
        'stealable' => $user_id !== get_current_user_id(),
    );
}

/**
 * Expose the lock on every post type that supports the REST API.
 *
 * As a rest FIELD rather than a separate request: the editor needs the lock on
 * the same read as the content — one round trip, and no window in which the
 * content is loaded but the lock is not yet known.
 */
add_action('rest_api_init', function () {
    foreach (get_post_types(array('show_in_rest' => true), 'objects') as $type) {
        register_rest_field($type->name, 'hydra_lock', array(
            'get_callback' => function ($post) {
                if (!current_user_can('edit_post', $post['id'])) {
                    return null;
                }
                return hydra_lock_state($post['id']);
            },
            'schema' => array(
                'description' => 'The WordPress edit lock on this post.',
                'type' => 'object',
                'context' => array('edit'),
            ),
        ));
    }

    register_rest_route('hydra/v1', '/lock/(?P<id>[\d]+)', array(
        array(
            'methods' => 'POST',
            'permission_callback' => function ($request) {
                return current_user_can('edit_post', (int) $request['id']);
            },
            'callback' => function ($request) {
                $post_id = (int) $request['id'];
                if (!get_post($post_id)) {
                    return new WP_Error('hydra_no_post', 'No such post', array('status' => 404));
                }

                $state = hydra_lock_state($post_id);
                $force = (bool) $request->get_param('force');

                // Re-locking what you already hold is ordinary — entering edit,
                // leaving by a route change that does not unlock, and entering
                // again. Refusing it would strand an editor out of their own
                // document. Someone ELSE's lock is a conflict unless forced.
                if ($state['locked'] && $state['stealable'] && !$force) {
                    return new WP_Error(
                        'hydra_locked',
                        sprintf('Locked by %s', $state['creator'] ?? 'another user'),
                        array('status' => 409, 'lock' => $state)
                    );
                }

                require_once ABSPATH . 'wp-admin/includes/post.php';
                // WordPress's own writer, so the value is in the format
                // wp-admin reads and the two agree about who holds it.
                wp_set_post_lock($post_id);

                return hydra_lock_state($post_id);
            },
        ),
        array(
            'methods' => 'DELETE',
            'permission_callback' => function ($request) {
                return current_user_can('edit_post', (int) $request['id']);
            },
            'callback' => function ($request) {
                $post_id = (int) $request['id'];
                if (!get_post($post_id)) {
                    return new WP_Error('hydra_no_post', 'No such post', array('status' => 404));
                }
                delete_post_meta($post_id, '_edit_lock');
                return array('locked' => false);
            },
        ),
    ));
});



/**
 * The path a post is addressed by, which is NOT its permalink.
 *
 * get_permalink() is wrong here twice over. A draft has no pretty permalink, so
 * it comes back as `/?page_id=5` — or, with Polylang, `/de/?page_id=5`, whose
 * path is just the language segment. And a published translation's permalink
 * carries Polylang's language prefix, which the adapter's paths never do: it
 * resolves a path by walking slugs, so `/de/erster-beitrag` would not resolve.
 *
 * The slug path answers both, for drafts and published posts alike.
 */
function hydra_post_path($post_id)
{
    $post = get_post($post_id);
    if (!$post) {
        return '';
    }
    $uri = is_post_type_hierarchical($post->post_type)
        ? get_page_uri($post_id)
        : $post->post_name;
    $uri = trim((string) $uri, '/');
    return $uri === '' ? '' : '/' . $uri;
}

/**
 * Polylang's translation group for a post.
 *
 * Returned as paths as well as ids, because the adapter deals in paths and
 * resolving each id to one separately would be a request per language.
 */
function hydra_translation_group($post_id)
{
    if (!function_exists('pll_get_post_translations')) {
        return null;
    }

    $items = array();
    foreach (pll_get_post_translations($post_id) as $language => $id) {
        $items[] = array(
            'language' => $language,
            'id' => (int) $id,
            'path' => hydra_post_path($id),
        );
    }

    // A post with a language but no translations is a group of one, which is a
    // different answer from "this CMS cannot do translations" and must not be
    // collapsed into it.
    if (!$items) {
        $own = pll_get_post_language($post_id);
        if ($own) {
            $items[] = array(
                'language' => $own,
                'id' => (int) $post_id,
                'path' => hydra_post_path($post_id),
            );
        }
    }

    return $items;
}

add_action('rest_api_init', function () {
    if (!function_exists('pll_get_post_translations')) {
        // No Polylang: register nothing, so the adapter's calls 404 and it can
        // say the plugin is absent rather than report a site with no
        // translations.
        return;
    }

    register_rest_route('hydra/v1', '/translations/(?P<id>[\d]+)', array(
        'methods' => 'GET',
        'permission_callback' => function ($request) {
            return current_user_can('edit_post', (int) $request['id']);
        },
        'callback' => function ($request) {
            $post_id = (int) $request['id'];
            if (!get_post($post_id)) {
                return new WP_Error('hydra_no_post', 'No such post', array('status' => 404));
            }
            return array('items' => hydra_translation_group($post_id));
        },
    ));

    register_rest_route('hydra/v1', '/translations/(?P<id>[\d]+)/link', array(
        'methods' => 'POST',
        'permission_callback' => function ($request) {
            return current_user_can('edit_post', (int) $request['id']);
        },
        'callback' => function ($request) {
            $source_id = (int) $request['id'];
            $target_id = (int) $request->get_param('target_id');
            $language = (string) $request->get_param('language');

            if (!get_post($source_id) || !get_post($target_id)) {
                return new WP_Error('hydra_no_post', 'No such post', array('status' => 404));
            }
            if (!in_array($language, pll_languages_list(), true)) {
                return new WP_Error(
                    'hydra_no_language',
                    sprintf('%s is not a language on this site', $language),
                    array('status' => 400)
                );
            }

            // The SOURCE needs a language before anything can be a translation
            // of it. Seeded content predates Polylang being configured, so it
            // has none, and pll_save_post_translations silently does nothing
            // when a post in the group has no language.
            if (!pll_get_post_language($source_id)) {
                pll_set_post_language($source_id, pll_default_language());
            }
            pll_set_post_language($target_id, $language);

            // Merge into the EXISTING group rather than replacing it, so linking
            // a third language does not drop the second.
            $group = pll_get_post_translations($source_id);
            $group[pll_get_post_language($source_id)] = $source_id;
            $group[$language] = $target_id;
            pll_save_post_translations($group);

            return array('items' => hydra_translation_group($source_id));
        },
    ));
});

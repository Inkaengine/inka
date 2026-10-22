<?php
/**
 * Plugin Name: Inka demo account — reads, never writes
 * Description: Lets a public demo hand out an editor credential by refusing every write that account makes.
 *
 * A public demo signs visitors straight into the editor, so the credential it
 * uses reaches the browser. Inka says this plainly of its Plone equivalent:
 * the account must be one "whose saves the CMS throws away (for Plone, a
 * subscriber that dooms every transaction the account makes), or a backend
 * nobody else reads".
 *
 * WordPress has no transaction to doom, so this refuses the writes instead.
 *
 * ## Install
 *
 * Copy to `wp-content/mu-plugins/` on the demo site and set the account:
 *
 *     define('INKA_DEMO_USER', 'demo');      // in wp-config.php
 *     # or, for a container: INKA_DEMO_USER=demo in the environment
 *
 * Unset, this plugin does nothing — it never guesses which account is the
 * demo, because guessing wrong either locks a real editor out of their own
 * site or leaves the demo writable.
 *
 * ## Why not a read-only ROLE
 *
 * The obvious move — take `edit_posts` away, or filter `user_has_cap` — breaks
 * the demo rather than protecting it. The editor's own READS ask for
 * `context=edit` and `status=any`, and WordPress gates both on `edit_posts`:
 * without it the REST API answers 400 "Status is forbidden" and the editor
 * cannot load a draft, a revision, or the fields it edits. The account has to
 * keep an editor's capabilities and be stopped at the point of writing.
 *
 * ## Why it refuses out loud
 *
 * A 403 with a reason, not a quiet success. Accepting a write and discarding
 * it would show the editor a save that worked and content that silently
 * reverted — the failure mode that is hardest to diagnose and easiest to ship.
 */

/** The demo account's login, from wp-config or the environment. */
function inka_demo_user() {
	if ( defined( 'INKA_DEMO_USER' ) && INKA_DEMO_USER ) {
		return (string) INKA_DEMO_USER;
	}
	$from_env = getenv( 'INKA_DEMO_USER' );
	return $from_env ? (string) $from_env : '';
}

/** Is the request's user the demo account? */
function inka_is_demo_request() {
	$demo = inka_demo_user();
	if ( ! $demo ) {
		return false;
	}
	$user = wp_get_current_user();
	return $user && $user->exists() && $user->user_login === $demo;
}

/**
 * Refuse anything that is not a read, before the route runs.
 *
 * `rest_pre_dispatch` is the one place every REST write passes through,
 * whatever route it is for: posts, media, menus, options, and any route a
 * plugin adds later. Listing the routes to protect would mean maintaining that
 * list against WordPress and against every plugin — and the one forgotten
 * entry is a writable demo.
 *
 * HEAD and OPTIONS are reads: OPTIONS is how a browser preflights a
 * cross-origin request, and refusing it would stop the editor's reads before
 * they were made.
 */
add_filter(
	'rest_pre_dispatch',
	function ( $result, $server, $request ) {
		if ( ! inka_is_demo_request() ) {
			return $result;
		}
		if ( in_array( $request->get_method(), array( 'GET', 'HEAD', 'OPTIONS' ), true ) ) {
			return $result;
		}
		return new WP_Error(
			'inka_demo_read_only',
			__( 'This is a demo: it shows the editor, and keeps no changes. Sign in with your own account to save.' ),
			array( 'status' => 403 )
		);
	},
	10,
	3
);

/**
 * The same rule for wp-admin, where the demo credential also works.
 *
 * The Inka editor only ever writes over REST, so the filter above is enough
 * for it. This is for the other door: someone who takes the demo credential to
 * `/wp-admin` and uses the forms there, which post to admin-post.php,
 * admin-ajax.php and the editor's own endpoints rather than to the REST API.
 *
 * Checked on `admin_init` and `admin_post`, and only for an unsafe method, so
 * reading wp-admin still works.
 */
function inka_demo_block_admin_writes() {
	if ( ! inka_is_demo_request() ) {
		return;
	}
	$method = isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( (string) $_SERVER['REQUEST_METHOD'] ) : 'GET';
	if ( in_array( $method, array( 'GET', 'HEAD', 'OPTIONS' ), true ) ) {
		return;
	}
	wp_die(
		esc_html__( 'This is a demo: it shows the editor, and keeps no changes.' ),
		esc_html__( 'Demo account' ),
		array( 'response' => 403 )
	);
}
add_action( 'admin_init', 'inka_demo_block_admin_writes' );
add_action( 'admin_post', 'inka_demo_block_admin_writes', 1 );

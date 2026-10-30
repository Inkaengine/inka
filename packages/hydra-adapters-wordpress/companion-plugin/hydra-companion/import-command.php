<?php
/**
 * `wp hydra import <manifest>` — a whole site, in one pass.
 *
 * WHY A WP-CLI COMMAND AND NOT THE ADAPTER
 *
 * The adapter is for EDITING: it runs in the browser, inside the editor's
 * iframe, and writes one document at a time over REST. That is the right shape
 * for someone typing, and the wrong shape for importing a site. The contract
 * suite measured it: rebuilding its fixture through REST cost about thirteen
 * sequential round trips per reset — ten seconds a go against single-threaded
 * PHP, which was most of a seventeen-minute run — and it was replaced by a
 * single bulk write. A site import is that cost times the site, and it is
 * paid on every deploy.
 *
 * So the documents arrive as a file, built from the markdown source by
 * scripts/content-to-wordpress.mjs, and this writes them here, in-process, on
 * the live connection.
 *
 * WHAT IT DOES NOT KNOW
 *
 * Blocks. `post_content` arrives already in the storage format — the
 * `data-hydra-blocks` element the adapter's `serializeBlocks` produces — so
 * there is exactly one definition of that format and it lives in JavaScript,
 * beside the editor that reads it back. This file writes the string it was
 * handed.
 *
 * IDEMPOTENT, because a deploy runs again: a document is matched by its slug
 * under its parent and UPDATED, never duplicated. An editor's later changes to
 * a page this import owns are overwritten, which is the same contract the
 * Plone distribution has — the markdown is the source.
 */

if (!defined('WP_CLI') || !WP_CLI) {
    return;
}

class Hydra_Import_Command
{
    /**
     * Import the documents and assets a manifest names.
     *
     * ## OPTIONS
     *
     * <manifest>
     * : Path to manifest.json, as built by content-to-wordpress.mjs. Its
     *   `uploads/` sibling holds the asset files.
     *
     * [--dry-run]
     * : Report what would be written, write nothing.
     */
    public function __invoke($args, $assoc_args)
    {
        list($manifest_path) = $args;
        $dry_run = isset($assoc_args['dry-run']);

        if (!file_exists($manifest_path)) {
            WP_CLI::error("no manifest at {$manifest_path}");
        }
        $manifest = json_decode(file_get_contents($manifest_path), true);
        if (!is_array($manifest) || !isset($manifest['documents'])) {
            WP_CLI::error("{$manifest_path} is not a manifest (no `documents`)");
        }

        // Block markup is HTML, and kses strips what it does not know from
        // anyone without unfiltered_html. Left on, every page imports with an
        // empty body and the blocks are simply gone — with nothing said.
        kses_remove_filters();

        try {
            // The uploads FIRST, because the documents reference them and only
            // this pass knows the url each one ended up at: WordPress files an
            // upload under the current year and month, so the address cannot be
            // computed by the builder that made the manifest.
            list($uploads, $asset_urls) = $this->import_assets(
                dirname($manifest_path) . '/uploads',
                $manifest['assets'] ?? [],
                $dry_run
            );
            $pages = $this->import_documents(
                $manifest['documents'],
                $dry_run,
                $asset_urls
            );
        } finally {
            kses_init_filters();
        }

        // The caches hold the state from before the write, and the next request
        // is a reader's.
        if (!$dry_run) {
            wp_cache_flush();
        }
        WP_CLI::success(
            ($dry_run ? '[dry run] ' : '')
            . "{$pages} documents, {$uploads} assets"
        );
    }

    /**
     * Files into uploads/, attachments minted for them.
     *
     * Copied rather than posted: `media_handle_sideload` runs the whole upload
     * pipeline per file — mime checks, image sub-sizes, hooks — and an import
     * of a site's images pays for all of it twice over, having already paid to
     * send each file through REST. The sizes WordPress would generate are the
     * ones a listing's teaser asks for, so they are generated HERE, once,
     * without a request.
     */
    private function import_assets($dir, array $assets, $dry_run)
    {
        if (!$assets) {
            return [0, []];
        }
        $upload_dir = wp_upload_dir();
        $written = 0;
        // content path (e.g. /videos/frontpage-demo.mp4) => the url WordPress
        // now serves that file at.
        $urls = [];

        foreach ($assets as $asset) {
            $source = $dir . '/' . $asset['filename'];
            if (!file_exists($source)) {
                // An ERROR, not a warning. The manifest lists what the builder
                // had bytes for, so a file missing here means the bundle was
                // built or copied wrong — and importing the documents anyway
                // publishes a site whose every video and image is a 404, which
                // is what shipped the first time this ran.
                WP_CLI::error("missing asset file: {$source}");
            }
            $target = $upload_dir['path'] . '/' . $asset['filename'];
            $url = $upload_dir['url'] . '/' . $asset['filename'];

            $existing = $this->attachment_by_filename($asset['filename']);
            if ($dry_run) {
                $written++;
                $urls[$asset['path']] = $url;
                continue;
            }

            wp_mkdir_p($upload_dir['path']);
            if (!copy($source, $target)) {
                WP_CLI::error("could not copy {$source} to {$target}");
            }

            if ($existing) {
                $id = $existing;
            } else {
                $id = wp_insert_attachment([
                    'guid' => $url,
                    'post_mime_type' => $asset['contentType'],
                    'post_title' => $asset['title'],
                    'post_content' => '',
                    'post_status' => 'inherit',
                ], $target, 0, true);
                if (is_wp_error($id)) {
                    WP_CLI::error("{$asset['filename']}: " . $id->get_error_message());
                }
            }
            // The named sizes a renderer addresses (`media_details.sizes`).
            // Without them an attachment serves only its full-size file, which
            // is a listing of originals on every teaser.
            require_once ABSPATH . 'wp-admin/includes/image.php';
            wp_update_attachment_metadata(
                $id,
                wp_generate_attachment_metadata($id, $target)
            );
            $written++;
            $urls[$asset['path']] = $url;
        }
        return [$written, $urls];
    }

    private function attachment_by_filename($filename)
    {
        global $wpdb;
        $like = '%/' . $filename;
        return (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT post_id FROM {$wpdb->postmeta}"
                . " WHERE meta_key = '_wp_attached_file' AND meta_value LIKE %s"
                . ' LIMIT 1',
                $like
            )
        ) ?: null;
    }

    /**
     * A document's blocks, with every asset marker pointing at WordPress.
     *
     * The builder leaves `{{hydra-asset:/videos/frontpage-demo.mp4}}` wherever
     * the content referenced a file, because only this pass knows where the
     * file ended up: WordPress serves an upload from wp-content/uploads, under
     * the year and month it was filed in, so the url cannot be computed by
     * whatever built the manifest. The content path is the key, and the upload
     * pass recorded the url for it.
     *
     * A marker left over is an asset this bundle has no bytes for, so it FAILS
     * here, by name. Publishing it instead is what the first deploy did: every
     * video and image on the site was a 404, and nothing said a word.
     */
    private function with_asset_urls(array $doc, array $asset_urls)
    {
        $content = $doc['content'];
        foreach ($asset_urls as $path => $url) {
            $content = str_replace('{{hydra-asset:' . $path . '}}', $url, $content);
        }
        if (preg_match_all('#\{\{hydra-asset:([^}]*)\}\}#', $content, $m)) {
            WP_CLI::error(
                "{$doc['path']} references assets this import has no file for: "
                . implode(', ', array_unique($m[1]))
                . '. They are git-ignored artefacts: regenerate them, or build'
                . ' the bundle in CI, which restores them from its cache.'
            );
        }
        return $content;
    }

    /**
     * Pages, parents before children.
     *
     * The manifest is ordered that way by the builder, and a child whose parent
     * is not yet written would land at the site root — addressable at the wrong
     * url, which is the kind of mistake that looks like missing content.
     */
    private function import_documents(array $documents, $dry_run, array $asset_urls = [])
    {
        $id_by_path = [];
        $written = 0;

        foreach ($documents as $doc) {
            $parent = 0;
            if (!empty($doc['parent'])) {
                if (!isset($id_by_path[$doc['parent']])) {
                    WP_CLI::warning(
                        "{$doc['path']}: its parent {$doc['parent']} is not in"
                        . ' the manifest before it; skipped'
                    );
                    continue;
                }
                $parent = $id_by_path[$doc['parent']];
            }

            $existing = $this->page_by_slug($doc['slug'], $parent);
            $fields = [
                'post_type' => 'page',
                'post_status' => 'publish',
                'post_name' => $doc['slug'],
                'post_title' => $doc['title'],
                'post_excerpt' => $doc['description'] ?? '',
                'post_content' => $this->with_asset_urls($doc, $asset_urls),
                'post_parent' => $parent,
                'menu_order' => $doc['order'] ?? 0,
            ];

            if ($dry_run) {
                $id_by_path[$doc['path']] = $existing ?: -1;
                $written++;
                continue;
            }

            if ($existing) {
                $fields['ID'] = $existing;
                $id = wp_update_post($fields, true);
            } else {
                $id = wp_insert_post($fields, true);
            }
            if (is_wp_error($id)) {
                WP_CLI::error("{$doc['path']}: " . $id->get_error_message());
            }
            $id_by_path[$doc['path']] = $id;
            $written++;
        }
        return $written;
    }

    private function page_by_slug($slug, $parent)
    {
        global $wpdb;
        return (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT ID FROM {$wpdb->posts}"
                . " WHERE post_type = 'page' AND post_name = %s"
                . ' AND post_parent = %d AND post_status != %s LIMIT 1',
                $slug,
                $parent,
                'trash'
            )
        ) ?: null;
    }
}

WP_CLI::add_command('hydra import', 'Hydra_Import_Command');

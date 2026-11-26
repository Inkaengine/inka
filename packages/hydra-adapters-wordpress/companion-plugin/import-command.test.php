<?php
/**
 * The import command's URL substitution — the half a deploy depends on.
 *
 *   php packages/hydra-adapters-wordpress/companion-plugin/import-command.test.php
 *
 * WHY THIS EXISTS
 *
 * A site imported into WordPress carries blocks that reference its files by the
 * path they were AUTHORED against. WordPress serves an upload from
 * wp-content/uploads under the year and month it was filed in, so the builder
 * cannot know the final url and leaves `{{hydra-asset:<path>}}`; this command
 * resolves it. Nothing checked that, and a deploy shipped a whole site whose
 * every video and image was a 404 while reporting success.
 *
 * WP_CLI and the two constants are stubbed because this tests the substitution,
 * not WordPress: the method under test touches no database and no filesystem.
 * `error` throws, which is what WP_CLI does to end a command.
 */

define('WP_CLI', true);
define('ABSPATH', __DIR__ . '/');

class WP_CLI
{
    public static function error($message) { throw new RuntimeException($message); }
    public static function warning($message) { fwrite(STDERR, "WARN: {$message}\n"); }
    public static function success($message) { echo "{$message}\n"; }
    public static function log($message) { echo "{$message}\n"; }
    public static function add_command($name, $class) {}
}

require __DIR__ . '/hydra-companion/import-command.php';

$failures = 0;
function ok($condition, $what)
{
    global $failures;
    if ($condition) {
        echo "ok - {$what}\n";
        return;
    }
    $failures++;
    echo "NOT OK - {$what}\n";
}

$command = new Hydra_Import_Command();
$substitute = (new ReflectionClass($command))->getMethod('with_asset_urls');
$substitute->setAccessible(true);

// A video block as the builder emits it: the marker sits inside the
// HTML-escaped JSON of a data-hydra-blocks element, so a substitution anchored
// on JSON quoting would never see it.
$page = [
    'path' => '/',
    'content' =>
        '<div data-hydra-blocks="{&quot;blocks&quot;:{&quot;v&quot;:{&quot;@type&quot;:&quot;video&quot;,'
        . '&quot;url&quot;:[{&quot;@id&quot;:&quot;{{hydra-asset:/videos/frontpage-demo.mp4}}&quot;}]}}}"></div>',
];
$uploaded = ['/videos/frontpage-demo.mp4' => 'http://wp.test/wp-content/uploads/2026/10/demo.mp4'];

$resolved = $substitute->invoke($command, $page, $uploaded);
ok(strpos($resolved, $uploaded['/videos/frontpage-demo.mp4']) !== false, 'the marker becomes the upload url');
ok(strpos($resolved, 'hydra-asset') === false, 'no marker survives');

// An asset the bundle has no bytes for: REFUSED, by name. Publishing it is the
// bug this test exists for.
try {
    $substitute->invoke($command, $page, []);
    ok(false, 'an unresolvable asset is refused');
} catch (RuntimeException $e) {
    ok(
        strpos($e->getMessage(), '/videos/frontpage-demo.mp4') !== false,
        'an unresolvable asset is refused, naming the asset'
    );
}

// Content that references nothing is handed on byte for byte.
$plain = ['path' => '/plain', 'content' => '<p>no assets here</p>'];
ok($substitute->invoke($command, $plain, $uploaded) === $plain['content'], 'assetless content is untouched');

echo $failures === 0 ? "\nall passed\n" : "\n{$failures} failed\n";
exit($failures === 0 ? 0 : 1);

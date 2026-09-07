<?php
/**
 * Ground-truth kses check: runs WordPress core's own icon sanitizer over a
 * built pack. Invoked by scripts/validate-kses-wp.mjs through WP-CLI:
 *
 *   wp eval-file scripts/validate-kses-wp.php <pack-dir> --path=/path/to/wordpress
 */
if ( ! defined( 'WP_CLI' ) ) {
	exit( 'Run through WP-CLI.' );
}
$dir = $args[0] ?? '';
if ( ! is_dir( $dir . '/icons' ) ) {
	WP_CLI::error( "Not a pack directory: $dir" );
}
$registry = WP_Icons_Registry::get_instance();
$method   = new ReflectionMethod( $registry, 'sanitize_icon_content' );
$method->setAccessible( true );

$files  = glob( $dir . '/icons/*.svg' );
$failed = array();
foreach ( $files as $file ) {
	$in       = file_get_contents( $file );
	$out      = $method->invoke( $registry, $in );
	$expected = str_replace( array( ' viewBox=', '/>' ), array( ' viewbox=', ' />' ), $in );
	if ( $out !== $expected ) {
		$failed[] = basename( $file );
	}
}
$summary = array( 'checked' => count( $files ), 'failed' => count( $failed ), 'failures' => array_slice( $failed, 0, 50 ) );
echo wp_json_encode( $summary ), "\n";
if ( $failed ) {
	WP_CLI::halt( 1 );
}

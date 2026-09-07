/**
 * Runs the real WordPress wp_kses() over a built pack via WP-CLI.
 *
 * Usage: WP_PATH=/path/to/wordpress node scripts/validate-kses-wp.mjs dist/lucide
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const packDir = process.argv[ 2 ];
const wpPath = process.env.WP_PATH;
if ( ! packDir || ! wpPath ) {
	console.error( 'Usage: WP_PATH=/path/to/wordpress node scripts/validate-kses-wp.mjs <pack-dir>' );
	process.exit( 2 );
}
const res = spawnSync( 'wp', [ 'eval-file', path.join( here, 'validate-kses-wp.php' ), path.resolve( packDir ), `--path=${ wpPath }`, '--skip-plugins', '--skip-themes' ], { encoding: 'utf8' } );
const line = ( res.stdout || '' ).split( '\n' ).find( ( l ) => l.startsWith( '{' ) );
if ( line ) console.log( line );
if ( res.status !== 0 ) {
	console.error( res.stderr.split( '\n' ).filter( ( l ) => l && ! /Deprecated/.test( l ) ).join( '\n' ) );
	process.exit( 1 );
}

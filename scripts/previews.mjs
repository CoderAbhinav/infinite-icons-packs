/**
 * Extracts the eight preview icons of every pack into dist/previews/<slug>/.
 *
 * The plugin vendors these so the "Available packs" screen can show what a pack
 * looks like before it is downloaded, without making a network request.
 *
 * Usage: node src/build.mjs && node scripts/previews.mjs
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DIST_DIR, PACKS, getPack } from '../packs.config.mjs';

const out = path.join( DIST_DIR, 'previews' );
rmSync( out, { recursive: true, force: true } );

let total = 0;
const missing = [];
const index = {};
for ( const slug of Object.keys( PACKS ) ) {
	const pack = getPack( slug );
	const packDir = path.join( DIST_DIR, slug );
	if ( ! existsSync( packDir ) ) {
		console.error( `Missing ${ packDir } — run \`npm run build\` first.` );
		process.exit( 2 );
	}
	mkdirSync( path.join( out, slug ), { recursive: true } );
	index[ slug ] = [];
	for ( const name of pack.preview ) {
		const src = path.join( packDir, 'icons', `${ name }.svg` );
		if ( ! existsSync( src ) ) {
			missing.push( `${ slug }/${ name }` );
			continue;
		}
		copyFileSync( src, path.join( out, slug, `${ name }.svg` ) );
		index[ slug ].push( name );
		total++;
	}
}

writeFileSync( path.join( out, 'previews.json' ), JSON.stringify( index, null, 2 ) + '\n' );

if ( missing.length ) {
	console.error( `Missing preview icons: ${ missing.join( ', ' ) }` );
	process.exit( 1 );
}
console.log( `${ total } preview icons across ${ Object.keys( index ).length } packs → ${ out }` );

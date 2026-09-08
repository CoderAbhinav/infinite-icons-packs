/**
 * Regenerates the pack table in README.md from the build reports in dist/report/.
 *
 * Usage: node src/build.mjs && node scripts/pack-table.mjs
 * Pass --check to fail (exit 1) when the README is out of date, for CI.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PACKS, ROOT, getPack, packVersion } from '../packs.config.mjs';

const START = '<!-- pack-table:start -->';
const END = '<!-- pack-table:end -->';

const mb = ( n ) => `${ ( n / 1048576 ).toFixed( 2 ) } MB`;
const kb = ( n ) => `${ Math.round( n / 1024 ) } KB`;

const rows = [];
const totals = { icons: 0, zip: 0 };
for ( const slug of Object.keys( PACKS ) ) {
	const file = path.join( ROOT, 'dist', 'report', `${ slug }.json` );
	if ( ! existsSync( file ) ) {
		console.error( `Missing ${ file } — run \`npm run build\` first.` );
		process.exit( 2 );
	}
	const r = JSON.parse( readFileSync( file, 'utf8' ) );
	const pack = getPack( slug );
	totals.icons += r.icons;
	totals.zip += r.zip.size;
	rows.push(
		`| ${ pack.bundled ? `**${ pack.label }** (bundled)` : pack.label } | \`${ slug }\` | ${ r.icons.toLocaleString( 'en-US' ) } | ` +
		`${ pack.variants.map( ( v ) => v.key || '_(default)_' ).join( ', ' ) } | ${ pack.license.spdx } | ` +
		`${ mb( r.zip.size ) } | ${ kb( r.sizes.elementor.cssGzip ) } | ${ ( r.visual.mean * 100 ).toFixed( 4 ) }% |`
	);
}

const table = [
	START,
	'',
	'| Pack | Slug | Icons | Variants | License | Zip | Elementor CSS (gzip) | Mean visual diff |',
	'|---|---|--:|---|---|--:|--:|--:|',
	...rows,
	`| | | **${ totals.icons.toLocaleString( 'en-US' ) }** | | | **${ mb( totals.zip ) }** | | |`,
	'',
	`Built from the versions pinned in [\`upstream-versions.json\`](upstream-versions.json). Lucide is bundled inside`,
	`the plugin, so it is not listed in \`index.json\`; the other five are downloaded on demand.`,
	'',
	END,
].join( '\n' );

const file = path.join( ROOT, 'README.md' );
const readme = readFileSync( file, 'utf8' );
if ( ! readme.includes( START ) || ! readme.includes( END ) ) {
	console.error( `README.md is missing the ${ START } / ${ END } markers.` );
	process.exit( 2 );
}
const updated = readme.slice( 0, readme.indexOf( START ) ) + table + readme.slice( readme.indexOf( END ) + END.length );

if ( process.argv.includes( '--check' ) ) {
	if ( updated !== readme ) {
		console.error( 'README.md pack table is out of date. Run: node scripts/pack-table.mjs' );
		process.exit( 1 );
	}
	console.log( 'README.md pack table is up to date.' );
} else {
	writeFileSync( file, updated );
	console.log( `README.md pack table updated (${ rows.length } packs, ${ totals.icons.toLocaleString( 'en-US' ) } icons, ${ mb( totals.zip ) }).` );
}

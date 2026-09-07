/**
 * Installs the pinned upstream npm packages into .cache/upstream/.
 *
 * Usage: node src/fetch.mjs [slug ...]   (no args = all packs)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { CACHE_DIR, PACKS, getPack, packageDir } from '../packs.config.mjs';

export function fetchPack( pack ) {
	const dir = packageDir( pack );
	const installed = existsSync( path.join( dir, 'package.json' ) )
		? JSON.parse( readFileSync( path.join( dir, 'package.json' ), 'utf8' ) ).version
		: null;
	if ( installed === pack.upstream.version ) {
		console.log( `[fetch] ${ pack.upstream.package }@${ installed } already cached` );
		return dir;
	}
	mkdirSync( CACHE_DIR, { recursive: true } );
	const manifest = path.join( CACHE_DIR, 'package.json' );
	if ( ! existsSync( manifest ) ) {
		writeFileSync( manifest, JSON.stringify( { name: 'infinite-icons-upstream-cache', private: true }, null, 2 ) );
	}
	const spec = `${ pack.upstream.package }@${ pack.upstream.version }`;
	console.log( `[fetch] installing ${ spec } → ${ CACHE_DIR }` );
	const res = spawnSync(
		'npm',
		[ 'install', '--prefix', CACHE_DIR, '--no-audit', '--no-fund', '--ignore-scripts', '--save-exact', spec ],
		{ stdio: 'inherit' }
	);
	if ( res.status !== 0 ) {
		throw new Error( `npm install failed for ${ spec }` );
	}
	return dir;
}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {
	const slugs = process.argv.slice( 2 );
	const targets = slugs.length ? slugs : Object.keys( PACKS );
	for ( const slug of targets ) {
		fetchPack( getPack( slug ) );
	}
}

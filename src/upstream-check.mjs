/**
 * Checks npm for newer upstream versions and updates upstream-versions.json.
 * Used by .github/workflows/upstream-check.yml; safe to run locally.
 *
 * Exit code 0 always; writes `changed=true|false` to $GITHUB_OUTPUT and a
 * markdown summary to $GITHUB_STEP_SUMMARY when those are set.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PACKS, ROOT } from '../packs.config.mjs';
import { compareSemver } from './util.mjs';

const file = path.join( ROOT, 'upstream-versions.json' );
const pinned = JSON.parse( readFileSync( file, 'utf8' ) );
const rows = [];
let changed = false;

for ( const pack of Object.values( PACKS ) ) {
	const pkg = pack.upstream.package;
	const res = spawnSync( 'npm', [ 'view', pkg, 'version' ], { encoding: 'utf8' } );
	const latest = res.stdout.trim();
	if ( res.status !== 0 || ! latest ) {
		rows.push( `| ${ pack.slug } | ${ pkg } | ${ pinned[ pkg ] } | ? | npm view failed |` );
		continue;
	}
	const current = pinned[ pkg ];
	if ( current && compareSemver( latest, current ) > 0 ) {
		pinned[ pkg ] = latest;
		changed = true;
		rows.push( `| ${ pack.slug } | ${ pkg } | ${ current } | **${ latest }** | update |` );
	} else {
		rows.push( `| ${ pack.slug } | ${ pkg } | ${ current } | ${ latest } | up to date |` );
	}
}

if ( changed ) writeFileSync( file, JSON.stringify( pinned, null, 2 ) + '\n' );

const summary = `## Upstream versions\n\n| Pack | npm package | Pinned | Latest | Status |\n|---|---|---|---|---|\n${ rows.join( '\n' ) }\n`;
console.log( summary );
if ( process.env.GITHUB_OUTPUT ) appendFileSync( process.env.GITHUB_OUTPUT, `changed=${ changed }\n` );
if ( process.env.GITHUB_STEP_SUMMARY ) appendFileSync( process.env.GITHUB_STEP_SUMMARY, summary );

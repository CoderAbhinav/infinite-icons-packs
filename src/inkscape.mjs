/**
 * Inkscape CLI fallback for icons the JS outliner is known to mangle
 * (listed per pack in packs.config.mjs as `inkscapeFallback`).
 *
 * Requires Inkscape ≥ 1.0 on PATH (or INKSCAPE_BIN). The result is a plain
 * SVG with fills only, which then goes through the regular fill pipeline.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function inkscapeAvailable() {
	const res = spawnSync( process.env.INKSCAPE_BIN || 'inkscape', [ '--version' ], { encoding: 'utf8' } );
	return res.status === 0;
}

export function inkscapeOutline( svg ) {
	const bin = process.env.INKSCAPE_BIN || 'inkscape';
	const dir = mkdtempSync( path.join( tmpdir(), 'ii-inkscape-' ) );
	try {
		const input = path.join( dir, 'in.svg' );
		const output = path.join( dir, 'out.svg' );
		writeFileSync( input, svg );
		const actions = [
			'select-all',
			'object-stroke-to-path',
			'select-all',
			'path-union',
			'export-type:svg',
			'export-plain-svg',
			`export-filename:${ output }`,
			'export-do',
		].join( ';' );
		const res = spawnSync( bin, [ `--actions=${ actions }`, input ], { encoding: 'utf8' } );
		if ( res.status !== 0 ) {
			throw new Error( `inkscape failed (${ res.status }): ${ ( res.stderr || res.error?.message || '' ).trim() }` );
		}
		return readFileSync( output, 'utf8' );
	} finally {
		rmSync( dir, { recursive: true, force: true } );
	}
}

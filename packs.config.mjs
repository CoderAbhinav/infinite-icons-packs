/**
 * Per-pack configuration for the Infinite Icons build pipeline.
 *
 * Everything that differs between icon packs lives here. The pipeline itself
 * (src/*.mjs) is pack-agnostic. Pinned upstream versions live in
 * upstream-versions.json so the weekly upstream-check workflow can bump them
 * without touching this file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.dirname( fileURLToPath( import.meta.url ) );
export const CACHE_DIR = path.join( ROOT, '.cache', 'upstream' );
export const DIST_DIR = path.join( ROOT, 'dist' );

/** GitHub owner/repo that hosts the pack releases. Replace the owner if the repo moves. */
export const REPO_OWNER = 'CoderAbhinav';
export const REPO_NAME = 'infinite-icons-packs';

/** Minimum plugin version able to consume packs built by this pipeline. */
export const REQUIRES_PLUGIN = '>=1.0.0';

/** Bumped whenever the pipeline output changes for the same upstream version. */
export const PIPELINE_REVISION = 1;

export const UPSTREAM_VERSIONS = JSON.parse(
	readFileSync( path.join( ROOT, 'upstream-versions.json' ), 'utf8' )
);

/**
 * Stroke defaults are applied when the SVG does not specify them explicitly.
 * All three stroke packs shipped so far use round caps and joins.
 */
const ROUND_STROKE = { width: 2, linecap: 'round', linejoin: 'round' };

/**
 * @typedef {object} VariantDef
 * @property {string}  key      Suffix appended to the icon name ("" = default variant, no suffix).
 * @property {string}  label    Human label shown in the UI.
 * @property {string}  dir      Directory (relative to the npm package root) holding this variant's SVGs.
 * @property {boolean} [default]
 * @property {'stroke'|'fill'} [geometry] Overrides the pack-level geometry for this variant.
 */

/**
 * @typedef {object} PackDef
 * @property {string} slug
 * @property {string} label
 * @property {string} description
 * @property {{ package: string, url: string, name: string }} upstream
 * @property {{ spdx: string, attribution: string, file: string }} license
 * @property {'stroke'|'fill'} geometry
 * @property {{ width: number, linecap: string, linejoin: string }} [stroke]
 * @property {VariantDef[]} variants
 * @property {(pkgDir: string) => Promise<Record<string, string[]>>} keywords Returns name → keywords.
 * @property {(pkgDir: string) => Promise<string[]>} [canonicalNames] Files outside this list with identical content are aliases → folded into keywords.
 * @property {(name: string) => string} [rename] Maps an upstream file basename to the icon name.
 * @property {boolean} [unite] Boolean-unite fill packs too (default: only when strokes are present).
 * @property {string[]} preview  Icon names used as previews in index.json.
 * @property {string[]} inkscapeFallback Icons the JS outliner is known to mangle; converted with Inkscape instead.
 * @property {string[]} skip     Icon file basenames to exclude entirely.
 */

/** @type {Record<string, PackDef>} */
export const PACKS = {
	lucide: {
		slug: 'lucide',
		label: 'Lucide',
		description: 'Beautiful & consistent icons made by the community. A fork of Feather Icons.',
		upstream: {
			package: 'lucide-static',
			name: 'Lucide',
			url: 'https://lucide.dev',
		},
		license: {
			spdx: 'ISC',
			attribution: '© Lucide Contributors. Portions © 2013-2022 Cole Bemis (Feather, MIT).',
			file: 'LICENSE',
		},
		geometry: 'stroke',
		stroke: ROUND_STROKE,
		variants: [
			{ key: '', label: 'Regular', dir: 'icons', default: true },
		],
		keywords: async ( pkgDir ) => JSON.parse( readFileSync( path.join( pkgDir, 'tags.json' ), 'utf8' ) ),
		// lucide-static ships alias files (old names, identical content); only icon-nodes.json keys are canonical.
		canonicalNames: async ( pkgDir ) => Object.keys( JSON.parse( readFileSync( path.join( pkgDir, 'icon-nodes.json' ), 'utf8' ) ) ),
		preview: [ 'house', 'user', 'settings', 'heart', 'star', 'mail', 'search', 'check' ],
		inkscapeFallback: [],
		skip: [],
	},
};

export function getPack( slug ) {
	const pack = PACKS[ slug ];
	if ( ! pack ) {
		throw new Error( `Unknown pack "${ slug }". Known packs: ${ Object.keys( PACKS ).join( ', ' ) }` );
	}
	const version = UPSTREAM_VERSIONS[ pack.upstream.package ];
	if ( ! version ) {
		throw new Error( `No pinned version for ${ pack.upstream.package } in upstream-versions.json` );
	}
	return { ...pack, upstream: { ...pack.upstream, version } };
}

export function packVersion( pack ) {
	return `${ pack.upstream.version }+ii.${ PIPELINE_REVISION }`;
}

/** GitHub renames release assets containing "+", so the zip file name uses "-" instead. */
export function packZipName( pack ) {
	return `${ pack.slug }-${ packVersion( pack ).replace( '+', '-' ) }.zip`;
}

export function packageDir( pack ) {
	return path.join( CACHE_DIR, 'node_modules', pack.upstream.package );
}

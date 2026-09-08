/**
 * Per-pack configuration for the Infinite Icons build pipeline.
 *
 * Everything that differs between icon packs lives here. The pipeline itself
 * (src/*.mjs) is pack-agnostic. Pinned upstream versions live in
 * upstream-versions.json so the weekly upstream-check workflow can bump them
 * without touching this file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
 * @property {string} [strip] Suffix removed from the file basename to recover the base icon name
 *                            (Phosphor ships "heart-bold.svg" in its bold directory).
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
 * @property {boolean} [bundled] Shipped inside the plugin zip, so it is not offered as a
 *                               download: built and released, but kept out of index.json.
 * @property {Record<string, string>} [visualExceptions] Icon name → reason, for icons whose
 *           upstream appearance provably cannot be reproduced under the WordPress sanitizer.
 *           The diff is reported but does not fail the build. Keep this list as short as the
 *           facts allow; every entry is a visible difference from upstream.
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
		bundled: true,
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

	material: {
		slug: 'material',
		label: 'Material Icons',
		description: "Google's Material Design icons, in filled, outlined and round styles.",
		upstream: {
			package: '@material-design-icons/svg',
			name: 'Material Design Icons',
			url: 'https://fonts.google.com/icons',
		},
		license: {
			spdx: 'Apache-2.0',
			attribution: '© Google. Material Design icons, Apache License 2.0.',
			file: 'LICENSE',
		},
		geometry: 'fill',
		variants: [
			{ key: '', label: 'Filled', dir: 'filled', default: true },
			{ key: 'outlined', label: 'Outlined', dir: 'outlined' },
			// Google calls this family "Rounded"; the npm directory is "round". The longer key is
			// both the official name and the only one that collides with no Material icon name
			// (there is a real icon called "nightlight_round").
			{ key: 'rounded', label: 'Rounded', dir: 'round' },
		],
		// Material file names use underscores ("add_a_photo"); hyphens match every other pack.
		rename: ( name ) => name.replace( /_/g, '-' ),
		// The package ships no keyword metadata, so the upstream underscore name is kept as a
		// keyword: people who know Material's naming can still search for it.
		keywords: async ( pkgDir ) => {
			const { readdirSync } = await import( 'node:fs' );
			const out = {};
			for ( const f of readdirSync( path.join( pkgDir, 'filled' ) ) ) {
				if ( ! f.endsWith( '.svg' ) ) continue;
				const raw = f.slice( 0, -4 );
				if ( raw.includes( '_' ) ) out[ raw.replace( /_/g, '-' ) ] = [ raw, raw.replace( /_/g, ' ' ) ];
			}
			return out;
		},
		preview: [ 'home', 'person', 'settings', 'favorite', 'star', 'mail', 'search', 'check' ],
		inkscapeFallback: [],
		// Two-tone depends on opacity and sharp adds little over filled; both are dropped.
		skip: [],
	},

	heroicons: {
		slug: 'heroicons',
		label: 'Heroicons',
		description: 'Beautiful hand-crafted SVG icons by the makers of Tailwind CSS.',
		upstream: {
			package: 'heroicons',
			name: 'Heroicons',
			url: 'https://heroicons.com',
		},
		license: {
			spdx: 'MIT',
			attribution: '© Tailwind Labs Inc.',
			file: 'LICENSE',
		},
		geometry: 'fill',
		// Only the 24px outline variant is stroked. Caps and joins are left at the SVG defaults
		// so the per-path attributes Heroicons sets actually decide; one path omits linecap and
		// must stay butt-capped, exactly as a browser renders it.
		stroke: { width: 1.5, linecap: 'butt', linejoin: 'miter' },
		variants: [
			{ key: '', label: 'Outline', dir: '24/outline', geometry: 'stroke', default: true },
			{ key: 'solid', label: 'Solid', dir: '24/solid' },
			{ key: 'mini', label: 'Mini (20px)', dir: '20/solid' },
			{ key: 'micro', label: 'Micro (16px)', dir: '16/solid' },
		],
		keywords: async () => ( {} ),
		preview: [ 'home', 'user', 'cog-6-tooth', 'heart', 'star', 'envelope', 'magnifying-glass', 'check' ],
		inkscapeFallback: [],
		skip: [],
	},

	tabler: {
		slug: 'tabler',
		label: 'Tabler Icons',
		description: 'Over 5000 free MIT-licensed high-quality SVG icons for you to use in your web projects.',
		upstream: {
			package: '@tabler/icons',
			name: 'Tabler Icons',
			url: 'https://tabler.io/icons',
		},
		license: {
			spdx: 'MIT',
			attribution: '© Paweł Kuna.',
			file: 'LICENSE',
		},
		geometry: 'fill',
		stroke: ROUND_STROKE,
		variants: [
			{ key: '', label: 'Outline', dir: 'icons/outline', geometry: 'stroke', default: true },
			{ key: 'filled', label: 'Filled', dir: 'icons/filled' },
		],
		keywords: async ( pkgDir ) => {
			const meta = JSON.parse( readFileSync( path.join( pkgDir, 'icons.json' ), 'utf8' ) );
			const out = {};
			for ( const [ name, entry ] of Object.entries( meta ) ) {
				out[ name ] = [ ...( entry.tags ?? [] ), ...( entry.category ? [ entry.category ] : [] ) ];
			}
			return out;
		},
		preview: [ 'home', 'user', 'settings', 'heart', 'star', 'mail', 'search', 'check' ],
		inkscapeFallback: [],
		skip: [],
		visualExceptions: {
			// The only icon in any pack that uses opacity: half its ring is drawn at 50%.
			// wp_kses strips opacity, so the ring is rendered solid. Dropping the faded arc
			// instead would leave a broken circle, so the full shape is kept.
			'brand-parsinta': 'upstream fades half the ring with opacity="0.5", which the WordPress sanitizer strips',
		},
	},

	fontawesome: {
		slug: 'fontawesome',
		label: 'Font Awesome Free',
		description: 'The internet\'s icon library, in solid, regular and brand styles.',
		upstream: {
			package: '@fortawesome/fontawesome-free',
			name: 'Font Awesome Free',
			url: 'https://fontawesome.com',
		},
		license: {
			spdx: 'CC-BY-4.0 AND OFL-1.1 AND MIT',
			attribution: '© Fonticons, Inc. Icons: CC BY 4.0. Fonts: SIL OFL 1.1. Code: MIT.',
			file: 'LICENSE.txt',
		},
		geometry: 'fill',
		variants: [
			{ key: '', label: 'Solid', dir: 'svgs/solid', default: true },
			{ key: 'regular', label: 'Regular', dir: 'svgs/regular' },
			{ key: 'brands', label: 'Brands', dir: 'svgs/brands' },
		],
		keywords: async ( pkgDir ) => {
			const meta = JSON.parse( readFileSync( path.join( pkgDir, 'metadata', 'icon-families.json' ), 'utf8' ) );
			const out = {};
			for ( const [ name, entry ] of Object.entries( meta ) ) {
				out[ name ] = [ ...( entry.search?.terms ?? [] ), ...( entry.aliases?.names ?? [] ) ];
			}
			return out;
		},
		preview: [ 'house', 'user', 'gear', 'heart', 'star', 'envelope', 'magnifying-glass', 'check' ],
		inkscapeFallback: [],
		skip: [],
	},

	phosphor: {
		slug: 'phosphor',
		label: 'Phosphor Icons',
		description: 'A flexible icon family, in regular, bold and filled weights.',
		upstream: {
			package: '@phosphor-icons/core',
			name: 'Phosphor Icons',
			url: 'https://phosphoricons.com',
		},
		license: {
			spdx: 'MIT',
			attribution: '© Phosphor Icons.',
			file: 'LICENSE',
		},
		geometry: 'fill',
		variants: [
			{ key: '', label: 'Regular', dir: 'assets/regular', default: true },
			{ key: 'bold', label: 'Bold', dir: 'assets/bold', strip: '-bold' },
			{ key: 'fill', label: 'Fill', dir: 'assets/fill', strip: '-fill' },
		],
		keywords: async ( pkgDir ) => {
			const { icons } = await import( pathToFileURL( path.join( pkgDir, 'dist', 'index.mjs' ) ).href );
			const out = {};
			for ( const icon of icons ) {
				out[ icon.name ] = [ ...( icon.tags ?? [] ), ...( icon.categories ?? [] ) ];
			}
			return out;
		},
		preview: [ 'house', 'user', 'gear', 'heart', 'star', 'envelope', 'magnifying-glass', 'check' ],
		inkscapeFallback: [],
		// thin and light add visual noise at icon sizes; duotone depends on opacity, which the
		// WordPress sanitizer strips.
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

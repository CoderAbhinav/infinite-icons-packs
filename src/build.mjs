/**
 * Build orchestrator: fetch → normalize → validate → package → index.
 *
 * Usage:
 *   node src/build.mjs                    build every pack
 *   node src/build.mjs lucide tabler      build selected packs
 * Flags:
 *   --limit=N        only the first N icons per pack (development)
 *   --only=a,b       only the named icons (development)
 *   --skip-visual    skip the resvg/pixelmatch comparison
 *   --worst=50       number of worst diffs in the HTML report
 *
 * Environment:
 *   RELEASE_TAG      git tag used in index.json download URLs (default v0.0.0-dev)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
	DIST_DIR, PACKS, REPO_NAME, REPO_OWNER, REQUIRES_PLUGIN, getPack, packVersion, packZipName,
} from '../packs.config.mjs';
import { fetchPack } from './fetch.mjs';
import { normalizeSvg } from './normalize.mjs';
import { validateIconSvg } from './validate-kses.mjs';
import { MAX_DIFF_RATIO, compareSvgs, writeReport } from './validate-visual.mjs';
import { buildManifest, fallbackLicenseText, validateManifest, writeAttribution } from './manifest.mjs';
import { buildElementorAssets } from './elementor-css.mjs';
import { writeIndex, zipDirectory } from './package.mjs';
import { inkscapeOutline } from './inkscape.mjs';
import { NAME_RE, parseArgs, sha256, titleCase } from './util.mjs';

/** Hash that ignores the per-file bits upstreams vary between alias copies (comments, class names, whitespace). */
function contentHash( svg ) {
	return sha256( svg.replace( /<!--[\s\S]*?-->/g, '' ).replace( /\sclass="[^"]*"/g, '' ).replace( /\s+/g, ' ' ).trim() );
}

function fmtBytes( n ) {
	return n >= 1048576 ? `${ ( n / 1048576 ).toFixed( 2 ) } MB` : `${ ( n / 1024 ).toFixed( 1 ) } KB`;
}

async function buildPack( slug, opts ) {
	const t0 = performance.now();
	const pack = getPack( slug );
	const version = packVersion( pack );
	const pkgDir = fetchPack( pack );
	console.log( `\n[${ slug }] building ${ version } from ${ pack.upstream.package }@${ pack.upstream.version }` );

	const keywordMap = await pack.keywords( pkgDir );
	const canonical = pack.canonicalNames ? new Set( await pack.canonicalNames( pkgDir ) ) : null;
	const failures = [];
	const notes = [];

	// 1. Collect sources per variant.
	let sources = [];
	for ( const variant of pack.variants ) {
		const dir = path.join( pkgDir, variant.dir );
		for ( const f of readdirSync( dir ).filter( ( x ) => x.endsWith( '.svg' ) ).sort() ) {
			const raw = f.slice( 0, -4 );
			if ( pack.skip.includes( raw ) ) continue;
			const base = pack.rename ? pack.rename( raw ) : raw;
			sources.push( {
				base,
				name: variant.key ? `${ base }-${ variant.key }` : base,
				variant,
				svg: readFileSync( path.join( dir, f ), 'utf8' ),
			} );
		}
	}

	// 2. Fold alias files (identical content under another name) into keywords.
	const aliasKeywords = new Map();
	let aliasCount = 0;
	if ( canonical ) {
		const byHash = new Map();
		for ( const s of sources ) {
			if ( canonical.has( s.base ) ) byHash.set( `${ s.variant.key }:${ contentHash( s.svg ) }`, s.base );
		}
		sources = sources.filter( ( s ) => {
			if ( canonical.has( s.base ) ) return true;
			const target = byHash.get( `${ s.variant.key }:${ contentHash( s.svg ) }` );
			if ( ! target ) {
				notes.push( `"${ s.base }" is not a canonical name and has no identical twin; kept as an icon` );
				return true;
			}
			aliasCount++;
			aliasKeywords.set( target, [ ...( aliasKeywords.get( target ) ?? [] ), s.base ] );
			return false;
		} );
	}

	if ( opts.only ) sources = sources.filter( ( s ) => opts.only.includes( s.base ) || opts.only.includes( s.name ) );
	if ( opts.limit ) sources = sources.slice( 0, opts.limit );

	// 3. Normalize + validate each icon.
	const icons = [];
	let done = 0;
	for ( const s of sources ) {
		if ( ++done % 250 === 0 ) console.log( `[${ slug }] ${ done }/${ sources.length }` );
		const geometry = s.variant.geometry ?? pack.geometry;
		let result;
		try {
			if ( pack.inkscapeFallback.includes( s.base ) ) {
				result = normalizeSvg( inkscapeOutline( s.svg ), { geometry: 'fill', unite: true } );
				result.warnings.push( 'converted with Inkscape' );
			} else {
				result = normalizeSvg( s.svg, {
					geometry,
					stroke: geometry === 'stroke' ? pack.stroke : undefined,
					unite: pack.unite,
				} );
			}
		} catch ( e ) {
			failures.push( { name: s.name, stage: 'normalize', message: e.message } );
			continue;
		}
		const kses = validateIconSvg( result.svg );
		if ( ! kses.ok ) {
			failures.push( { name: s.name, stage: 'kses', message: kses.errors.join( '; ' ) } );
			continue;
		}
		let ratio = 0;
		if ( ! opts.skipVisual ) {
			const cmp = compareSvgs( s.svg, result.svg );
			ratio = cmp.ratio;
			if ( ! cmp.ok ) {
				failures.push( { name: s.name, stage: 'visual', message: cmp.reason ?? `pixel diff ${ ( cmp.ratio * 100 ).toFixed( 2 ) }% exceeds ${ MAX_DIFF_RATIO * 100 }%` } );
			}
		}
		const keywords = new Set(
			[ ...( keywordMap[ s.base ] ?? [] ), ...( aliasKeywords.get( s.base ) ?? [] ).flatMap( ( a ) => [ a, a.replace( /-/g, ' ' ) ] ) ]
				.map( ( k ) => String( k ).toLowerCase().trim() )
				.filter( ( k ) => k && k !== s.base && k !== s.base.replace( /-/g, ' ' ) )
		);
		icons.push( {
			name: s.name,
			label: titleCase( s.base ),
			variant: s.variant.key,
			keywords: [ ...keywords ].slice( 0, 100 ),
			file: `icons/${ s.name }.svg`,
			svg: result.svg,
			source: s.svg,
			warnings: result.warnings,
			ratio,
		} );
	}

	// 4. Names: valid and unique.
	const seen = new Set();
	for ( const icon of icons ) {
		if ( ! NAME_RE.test( icon.name ) ) failures.push( { name: icon.name, stage: 'name', message: 'does not match the icon name rule' } );
		if ( seen.has( icon.name ) ) failures.push( { name: icon.name, stage: 'name', message: 'duplicate icon name' } );
		seen.add( icon.name );
	}
	for ( const p of pack.preview ) {
		if ( ! seen.has( p ) && ! opts.limit && ! opts.only ) failures.push( { name: p, stage: 'preview', message: 'preview icon does not exist in the pack' } );
	}

	// 5. Write the pack tree.
	const outDir = path.join( DIST_DIR, slug );
	rmSync( outDir, { recursive: true, force: true } );
	mkdirSync( path.join( outDir, 'icons' ), { recursive: true } );
	mkdirSync( path.join( outDir, 'elementor' ), { recursive: true } );
	for ( const icon of icons ) writeFileSync( path.join( outDir, icon.file ), icon.svg );

	const manifest = buildManifest( pack, version, icons );
	for ( const err of validateManifest( manifest ) ) failures.push( { name: 'manifest.json', stage: 'schema', message: err } );
	writeFileSync( path.join( outDir, 'manifest.json' ), JSON.stringify( manifest, null, '\t' ) + '\n' );

	const licenseSrc = path.join( pkgDir, pack.license.file );
	if ( existsSync( licenseSrc ) ) copyFileSync( licenseSrc, path.join( outDir, 'LICENSE' ) );
	else writeFileSync( path.join( outDir, 'LICENSE' ), fallbackLicenseText( pack ) );
	writeAttribution( outDir, pack, version );

	const elementor = buildElementorAssets( pack, icons );
	writeFileSync( path.join( outDir, 'elementor', 'elementor.css' ), elementor.css );
	writeFileSync( path.join( outDir, 'elementor', 'icons.json' ), elementor.json );

	// 6. Zip.
	const zipName = packZipName( pack );
	const zip = await zipDirectory( outDir, path.join( DIST_DIR, zipName ), slug );

	// 7. Report.
	const reportDir = path.join( DIST_DIR, 'report' );
	mkdirSync( reportDir, { recursive: true } );
	if ( ! opts.skipVisual ) writeReport( path.join( reportDir, `${ slug }.html` ), { pack, version, icons, failures, worst: opts.worst } );
	const ratios = icons.map( ( i ) => ( { name: i.name, ratio: +i.ratio.toFixed( 5 ) } ) ).sort( ( a, b ) => b.ratio - a.ratio );
	const seconds = ( performance.now() - t0 ) / 1000;
	const svgBytes = icons.reduce( ( s, i ) => s + Buffer.byteLength( i.svg ), 0 );
	const summary = {
		slug,
		version,
		icons: icons.length,
		aliasesFolded: aliasCount,
		failures,
		notes,
		warnings: icons.filter( ( i ) => i.warnings.length ).map( ( i ) => ( { name: i.name, warnings: i.warnings } ) ),
		visual: { worst: ratios.slice( 0, 20 ), mean: icons.length ? +( icons.reduce( ( s, i ) => s + i.ratio, 0 ) / icons.length ).toFixed( 6 ) : 0 },
		sizes: { svgTotal: svgBytes, svgAverage: icons.length ? Math.round( svgBytes / icons.length ) : 0, elementor: elementor.sizes, zip: zip.size },
		zip: { name: zipName, sha256: zip.sha256, size: zip.size, files: zip.files },
		seconds: +seconds.toFixed( 1 ),
	};
	writeFileSync( path.join( reportDir, `${ slug }.json` ), JSON.stringify( summary, null, 2 ) + '\n' );

	console.log(
		`[${ slug }] ${ icons.length } icons (${ aliasCount } aliases folded) · ${ failures.length } failures · ` +
		`mean diff ${ ( summary.visual.mean * 100 ).toFixed( 4 ) }% · worst ${ ratios[ 0 ] ? ( ratios[ 0 ].ratio * 100 ).toFixed( 3 ) + '% ' + ratios[ 0 ].name : '-' } · ` +
		`avg svg ${ summary.sizes.svgAverage } B · zip ${ fmtBytes( zip.size ) } · elementor.css ${ fmtBytes( elementor.sizes.css ) } (${ fmtBytes( elementor.sizes.cssGzip ) } gz) · ${ seconds.toFixed( 1 ) }s`
	);
	for ( const f of failures.slice( 0, 30 ) ) console.log( `   ✗ ${ f.stage.padEnd( 9 ) } ${ f.name }: ${ f.message }` );
	if ( failures.length > 30 ) console.log( `   … ${ failures.length - 30 } more (see dist/report/${ slug }.json)` );
	for ( const n of notes.slice( 0, 10 ) ) console.log( `   ℹ ${ n }` );

	const tag = process.env.RELEASE_TAG || 'v0.0.0-dev';
	const entry = {
		slug,
		label: pack.label,
		description: pack.description,
		version,
		icon_count: icons.length,
		variants: pack.variants.map( ( v ) => v.key ),
		license: pack.license.spdx,
		requires_plugin: REQUIRES_PLUGIN,
		size_bytes: zip.size,
		sha256: zip.sha256,
		url: `https://github.com/${ REPO_OWNER }/${ REPO_NAME }/releases/download/${ tag }/${ zipName }`,
		preview: pack.preview,
	};
	return { entry, failures, summary };
}

async function main() {
	const { flags, positional } = parseArgs( process.argv.slice( 2 ) );
	const opts = {
		limit: flags.limit ? Number( flags.limit ) : 0,
		only: flags.only ? String( flags.only ).split( ',' ) : null,
		skipVisual: Boolean( flags[ 'skip-visual' ] ),
		worst: flags.worst ? Number( flags.worst ) : 50,
	};
	const slugs = positional.length ? positional : Object.keys( PACKS );
	mkdirSync( DIST_DIR, { recursive: true } );

	const entries = [];
	let failed = 0;
	for ( const slug of slugs ) {
		const { entry, failures } = await buildPack( slug, opts );
		entries.push( entry );
		failed += failures.length;
	}
	const index = writeIndex( path.join( DIST_DIR, 'index.json' ), entries );
	console.log( `\nindex.json: ${ index.packs.length } pack(s) → ${ path.join( DIST_DIR, 'index.json' ) }` );
	if ( failed ) {
		console.error( `\nBUILD FAILED: ${ failed } validation failure(s). See dist/report/*.json and *.html.` );
		process.exit( 1 );
	}
	console.log( 'BUILD OK' );
}

main().catch( ( e ) => {
	console.error( e );
	process.exit( 1 );
} );

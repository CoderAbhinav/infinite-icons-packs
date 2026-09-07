/**
 * Normalizes one upstream SVG into the canonical Infinite Icons format:
 *
 *   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="..."/></svg>
 *
 * See README.md § "Canonical format" for the rules and the reasons behind them.
 */
import { parseSync } from 'svgson';
import svgpath from 'svgpath';
import toPath from 'element-to-path';
import { optimize } from 'svgo';
import {
	TOLERANCES,
	fillToPolygons,
	flattenPathData,
	polygonsToPathData,
	scaleFor,
	strokeToPolygons,
	unionPolygons,
	unitFor,
} from './outline.mjs';
import { num } from './util.mjs';

export const SVG_NS = 'http://www.w3.org/2000/svg';

const FORBIDDEN = new Set( [
	'image', 'text', 'tspan', 'textpath', 'use', 'filter', 'lineargradient', 'radialgradient', 'pattern',
	'mask', 'clippath', 'style', 'symbol', 'foreignobject', 'switch', 'a', 'script', 'marker', 'animate',
	'animatetransform', 'set',
] );
const IGNORED = new Set( [ 'title', 'desc', 'metadata' ] );
const SHAPES = new Set( [ 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon' ] );
const INHERITED = [
	'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
	'stroke-miterlimit', 'stroke-opacity', 'opacity', 'stroke-dasharray',
];

/** Merges a style="" attribute into the attribute map (attributes win, per CSS cascade the reverse, but icon sets never mix them). */
function withStyle( attributes = {} ) {
	const out = { ...attributes };
	if ( out.style ) {
		for ( const decl of out.style.split( ';' ) ) {
			const idx = decl.indexOf( ':' );
			if ( idx === -1 ) continue;
			const k = decl.slice( 0, idx ).trim().toLowerCase();
			const v = decl.slice( idx + 1 ).trim();
			if ( k && ! ( k in attributes ) ) out[ k ] = v;
		}
		delete out.style;
	}
	return out;
}

function parseLength( v ) {
	const n = parseFloat( String( v ).replace( /px$/i, '' ) );
	return Number.isFinite( n ) ? n : NaN;
}

export function parseViewBox( attributes ) {
	if ( attributes.viewBox ) {
		const parts = attributes.viewBox.trim().split( /[\s,]+/ ).map( Number );
		if ( parts.length === 4 && parts.every( Number.isFinite ) && parts[ 2 ] > 0 && parts[ 3 ] > 0 ) {
			return { x: parts[ 0 ], y: parts[ 1 ], width: parts[ 2 ], height: parts[ 3 ] };
		}
		throw new Error( `Invalid viewBox "${ attributes.viewBox }"` );
	}
	const w = parseLength( attributes.width );
	const h = parseLength( attributes.height );
	if ( w > 0 && h > 0 ) return { x: 0, y: 0, width: w, height: h };
	throw new Error( 'SVG has neither a viewBox nor width/height' );
}

/** Returns true when a paint value actually paints something. */
function paints( value, fallback ) {
	const v = ( value ?? fallback ).trim().toLowerCase();
	if ( v === 'none' || v === 'transparent' ) return false;
	if ( v.startsWith( 'url(' ) ) throw new Error( `Unsupported paint server "${ value }"` );
	return true;
}

function collectShapes( node, inherited, transform, out, warnings ) {
	for ( const child of node.children ?? [] ) {
		if ( child.type !== 'element' ) {
			if ( child.type === 'text' && child.value.trim() ) warnings.push( 'stray text content ignored' );
			continue;
		}
		const name = child.name.toLowerCase();
		if ( IGNORED.has( name ) ) continue;
		if ( FORBIDDEN.has( name ) ) throw new Error( `Unsupported element <${ child.name }>` );
		const attrs = withStyle( child.attributes );
		const style = { ...inherited };
		for ( const k of INHERITED ) if ( attrs[ k ] != null ) style[ k ] = attrs[ k ];
		const t = attrs.transform ? `${ transform } ${ attrs.transform }`.trim() : transform;

		if ( name === 'g' || name === 'svg' ) {
			collectShapes( child, style, t, out, warnings );
			continue;
		}
		if ( name === 'defs' ) {
			if ( ( child.children ?? [] ).some( ( c ) => c.type === 'element' ) ) throw new Error( 'Unsupported <defs> content' );
			continue;
		}
		if ( ! SHAPES.has( name ) ) throw new Error( `Unsupported element <${ child.name }>` );

		let d = name === 'path' ? attrs.d : toPath( { type: 'element', name, attributes: attrs } );
		if ( ! d || ! d.trim() ) {
			warnings.push( `empty <${ name }> skipped` );
			continue;
		}
		if ( t ) d = svgpath( d ).transform( t ).toString();

		const opacity = parseFloat( style.opacity ?? 1 );
		if ( opacity < 1 ) warnings.push( 'opacity < 1 cannot be represented and was ignored' );
		if ( style[ 'stroke-dasharray' ] && style[ 'stroke-dasharray' ] !== 'none' ) warnings.push( 'stroke-dasharray ignored' );

		const fill = paints( style.fill, 'black' ) && parseFloat( style[ 'fill-opacity' ] ?? 1 ) > 0;
		const stroke = paints( style.stroke, 'none' ) && parseFloat( style[ 'stroke-opacity' ] ?? 1 ) > 0;
		if ( style[ 'fill-opacity' ] != null && parseFloat( style[ 'fill-opacity' ] ) < 1 && fill ) warnings.push( 'fill-opacity < 1 ignored' );
		if ( style[ 'stroke-opacity' ] != null && parseFloat( style[ 'stroke-opacity' ] ) < 1 && stroke ) warnings.push( 'stroke-opacity < 1 ignored' );

		out.push( {
			d,
			fill,
			fillRule: style[ 'fill-rule' ] === 'evenodd' ? 'evenodd' : 'nonzero',
			stroke,
			strokeWidth: parseLength( style[ 'stroke-width' ] ?? 1 ),
			linecap: ( style[ 'stroke-linecap' ] ?? 'butt' ).toLowerCase(),
			linejoin: ( style[ 'stroke-linejoin' ] ?? 'miter' ).toLowerCase(),
			miterLimit: parseFloat( style[ 'stroke-miterlimit' ] ?? 4 ),
		} );
	}
}

function serialize( viewBoxAttr, paths ) {
	const body = paths
		.map( ( p ) => `<path fill="currentColor"${ p.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '' } d="${ p.d }"/>` )
		.join( '' );
	return `<svg xmlns="${ SVG_NS }" viewBox="${ viewBoxAttr }">${ body }</svg>`;
}

function viewBoxAttr( vb ) {
	return `${ num( vb.x ) } ${ num( vb.y ) } ${ num( vb.width ) } ${ num( vb.height ) }`;
}

const SVGO_CONFIG = {
	multipass: true,
	plugins: [
		{
			name: 'preset-default',
			params: {
				overrides: {
					convertPathData: { floatPrecision: 2 },
					cleanupNumericValues: { floatPrecision: 2 },
				},
			},
		},
	],
};

/**
 * Re-reads svgo's output and rebuilds the canonical string, so formatting is
 * deterministic and byte-stable regardless of svgo's serializer.
 */
function canonicalize( svg, fallbackViewBox ) {
	const root = parseSync( svg );
	if ( root.name !== 'svg' ) throw new Error( 'svgo output lost the <svg> root' );
	const vb = root.attributes.viewBox ? viewBoxAttr( parseViewBox( root.attributes ) ) : fallbackViewBox;
	const paths = [];
	for ( const child of root.children ) {
		if ( child.type !== 'element' ) continue;
		if ( child.name !== 'path' ) throw new Error( `Unexpected <${ child.name }> after optimization` );
		const d = child.attributes.d;
		if ( ! d ) continue;
		if ( /[<>&"]/.test( d ) ) throw new Error( 'Unsafe characters in path data' );
		paths.push( { d, fillRule: child.attributes[ 'fill-rule' ] === 'evenodd' ? 'evenodd' : 'nonzero' } );
	}
	if ( ! paths.length ) throw new Error( 'No path data after optimization' );
	return serialize( vb, paths );
}

/**
 * @typedef {object} NormalizeOptions
 * @property {'stroke'|'fill'} geometry
 * @property {{width:number, linecap:string, linejoin:string}} [stroke] Defaults when the SVG omits them.
 * @property {boolean} [unite] Force boolean union even for pure fill icons.
 */

/**
 * @param {string} source SVG markup from the upstream package.
 * @param {NormalizeOptions} options
 * @return {{svg: string, warnings: string[], stats: {shapes:number, united:boolean, bytes:number}}}
 */
export function normalizeSvg( source, options ) {
	const root = parseSync( source.replace( /<\?xml[^>]*\?>/, '' ).replace( /<!DOCTYPE[^>]*>/i, '' ) );
	if ( root.name.toLowerCase() !== 'svg' ) throw new Error( `Root element is <${ root.name }>, expected <svg>` );

	const rootAttrs = withStyle( root.attributes );
	const viewBox = parseViewBox( rootAttrs );
	const unit = unitFor( viewBox );
	const scale = scaleFor( viewBox );

	// Pack defaults apply only where the SVG says nothing; SVG root attributes win.
	const inherited = {};
	if ( options.stroke ) {
		inherited[ 'stroke-width' ] = String( options.stroke.width );
		inherited[ 'stroke-linecap' ] = options.stroke.linecap;
		inherited[ 'stroke-linejoin' ] = options.stroke.linejoin;
	}
	for ( const k of INHERITED ) if ( rootAttrs[ k ] != null ) inherited[ k ] = rootAttrs[ k ];

	const shapes = [];
	const warnings = [];
	collectShapes( root, inherited, rootAttrs.transform ?? '', shapes, warnings );
	const visible = shapes.filter( ( s ) => s.fill || ( s.stroke && s.strokeWidth > 0 ) );
	if ( ! visible.length ) throw new Error( 'No visible geometry' );

	const hasStroke = visible.some( ( s ) => s.stroke && s.strokeWidth > 0 );
	const unite = hasStroke || options.unite === true;
	let paths;
	if ( unite ) {
		const groups = [];
		for ( const s of visible ) {
			const sub = flattenPathData( s.d, TOLERANCES.flatten * unit );
			if ( s.fill ) groups.push( fillToPolygons( sub, s.fillRule, scale, unit ) );
			if ( s.stroke && s.strokeWidth > 0 ) {
				groups.push( strokeToPolygons( sub, { width: s.strokeWidth, linecap: s.linecap, linejoin: s.linejoin, miterLimit: s.miterLimit }, scale, unit ) );
			}
		}
		const union = unionPolygons( groups );
		if ( ! union.length ) throw new Error( 'Boolean union produced no geometry' );
		paths = [ { d: polygonsToPathData( union, scale, unit ), fillRule: 'nonzero' } ];
	} else {
		paths = visible.filter( ( s ) => s.fill ).map( ( s ) => ( { d: s.d, fillRule: s.fillRule } ) );
	}

	const vbAttr = viewBoxAttr( viewBox );
	const draft = serialize( vbAttr, paths );
	const optimized = optimize( draft, SVGO_CONFIG ).data;
	const svg = canonicalize( optimized, vbAttr );
	return { svg, warnings, stats: { shapes: visible.length, united: unite, bytes: Buffer.byteLength( svg ) } };
}

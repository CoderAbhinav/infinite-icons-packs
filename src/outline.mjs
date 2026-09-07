/**
 * Stroke → fill outlining and boolean union.
 *
 * paper.js (named in the original plan) has no stroke-expansion API, so this
 * module uses Clipper polygon offsetting instead. For round caps and joins the
 * stroke of a polyline is exactly the Minkowski sum of the polyline with a
 * disc, which is precisely what round offsetting computes, and Clipper's
 * integer-based boolean ops are robust against the coincident-edge cases that
 * uniting hundreds of overlapping shapes produces. Curves are flattened before
 * offsetting and re-fitted with cubic Béziers afterwards (Schneider's
 * algorithm via fit-curve) so the output stays compact.
 */
import svgpath from 'svgpath';
import ClipperLib from 'clipper-lib';
import fitCurve from 'fit-curve';
import { num } from './util.mjs';

const { Clipper, ClipperOffset, JoinType, EndType, PolyType, ClipType, PolyFillType, Paths } = ClipperLib;

/**
 * Tolerances in "24-grid units". They are multiplied by unit = max(viewBox w,h)/24
 * so a 512-unit Font Awesome icon is treated like a 24-unit icon scaled up.
 */
export const TOLERANCES = {
	flatten: 0.002, // max chord deviation when flattening Béziers
	arc: 0.0015, // Clipper ArcTolerance for round joins/caps
	fit: 0.008, // max deviation of re-fitted Béziers from the polygon
	dedupe: 0.0002, // points closer than this are merged
	cornerDeg: 30, // turning angle above which a vertex is treated as a corner
};

const JOIN = { round: JoinType.jtRound, miter: JoinType.jtMiter, 'miter-clip': JoinType.jtMiter, bevel: JoinType.jtSquare, arcs: JoinType.jtRound };
const END = { round: EndType.etOpenRound, butt: EndType.etOpenButt, square: EndType.etOpenSquare };

export function unitFor( viewBox ) {
	return Math.max( viewBox.width, viewBox.height ) / 24;
}

/** Integer scale so the viewBox spans roughly 2.4e5 Clipper units. */
export function scaleFor( viewBox ) {
	const size = Math.max( viewBox.width, viewBox.height );
	return Math.pow( 10, Math.max( 1, Math.round( Math.log10( 240000 / size ) ) ) );
}

/* -------------------------------------------------------------------------- */
/* Flattening                                                                 */
/* -------------------------------------------------------------------------- */

function mid( a, b ) {
	return [ ( a[ 0 ] + b[ 0 ] ) / 2, ( a[ 1 ] + b[ 1 ] ) / 2 ];
}

function distToSegment( p, a, b ) {
	const dx = b[ 0 ] - a[ 0 ];
	const dy = b[ 1 ] - a[ 1 ];
	const len2 = dx * dx + dy * dy;
	if ( len2 === 0 ) return Math.hypot( p[ 0 ] - a[ 0 ], p[ 1 ] - a[ 1 ] );
	let t = ( ( p[ 0 ] - a[ 0 ] ) * dx + ( p[ 1 ] - a[ 1 ] ) * dy ) / len2;
	t = Math.max( 0, Math.min( 1, t ) );
	return Math.hypot( p[ 0 ] - ( a[ 0 ] + t * dx ), p[ 1 ] - ( a[ 1 ] + t * dy ) );
}

function flattenCubic( p0, p1, p2, p3, tol, push, depth = 0 ) {
	const flat = Math.max( distToSegment( p1, p0, p3 ), distToSegment( p2, p0, p3 ) );
	if ( flat <= tol || depth >= 16 ) {
		push( p3 );
		return;
	}
	const p01 = mid( p0, p1 );
	const p12 = mid( p1, p2 );
	const p23 = mid( p2, p3 );
	const p012 = mid( p01, p12 );
	const p123 = mid( p12, p23 );
	const p0123 = mid( p012, p123 );
	flattenCubic( p0, p01, p012, p0123, tol, push, depth + 1 );
	flattenCubic( p0123, p123, p23, p3, tol, push, depth + 1 );
}

function flattenQuad( p0, p1, p2, tol, push, depth = 0 ) {
	if ( distToSegment( p1, p0, p2 ) <= tol || depth >= 16 ) {
		push( p2 );
		return;
	}
	const p01 = mid( p0, p1 );
	const p12 = mid( p1, p2 );
	const p012 = mid( p01, p12 );
	flattenQuad( p0, p01, p012, tol, push, depth + 1 );
	flattenQuad( p012, p12, p2, tol, push, depth + 1 );
}

/**
 * Flattens SVG path data into polylines.
 *
 * @param {string} d
 * @param {number} tol
 * @return {{points: number[][], closed: boolean}[]}
 */
export function flattenPathData( d, tol ) {
	const subpaths = [];
	let cur = null;
	const begin = ( pt ) => {
		cur = { points: [ pt ], closed: false };
		subpaths.push( cur );
	};
	svgpath( d )
		.abs()
		.unarc()
		.unshort()
		.iterate( ( seg, index, x, y ) => {
			const cmd = seg[ 0 ];
			// Drawing after Z starts a new subpath at the previous start point.
			const ensureOpen = () => {
				if ( ! cur || cur.closed ) begin( [ x, y ] );
			};
			const push = ( p ) => cur.points.push( p );
			switch ( cmd ) {
				case 'M':
					begin( [ seg[ 1 ], seg[ 2 ] ] );
					break;
				case 'L':
					ensureOpen();
					push( [ seg[ 1 ], seg[ 2 ] ] );
					break;
				case 'H':
					ensureOpen();
					push( [ seg[ 1 ], y ] );
					break;
				case 'V':
					ensureOpen();
					push( [ x, seg[ 1 ] ] );
					break;
				case 'C':
					ensureOpen();
					flattenCubic( [ x, y ], [ seg[ 1 ], seg[ 2 ] ], [ seg[ 3 ], seg[ 4 ] ], [ seg[ 5 ], seg[ 6 ] ], tol, push );
					break;
				case 'Q':
					ensureOpen();
					flattenQuad( [ x, y ], [ seg[ 1 ], seg[ 2 ] ], [ seg[ 3 ], seg[ 4 ] ], tol, push );
					break;
				case 'Z':
				case 'z':
					if ( cur ) cur.closed = true;
					break;
				default:
					throw new Error( `Unsupported path command "${ cmd }"` );
			}
		} );
	return subpaths;
}

/* -------------------------------------------------------------------------- */
/* Clipper helpers                                                            */
/* -------------------------------------------------------------------------- */

export function dedupe( points, eps, closed = false ) {
	const out = [];
	for ( const p of points ) {
		const last = out[ out.length - 1 ];
		if ( ! last || Math.hypot( p[ 0 ] - last[ 0 ], p[ 1 ] - last[ 1 ] ) > eps ) out.push( p );
	}
	if ( closed && out.length > 1 ) {
		const a = out[ 0 ];
		const b = out[ out.length - 1 ];
		if ( Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ] ) <= eps ) out.pop();
	}
	return out;
}

function toClipperPath( points, scale ) {
	const out = [];
	for ( const [ x, y ] of points ) {
		const X = Math.round( x * scale );
		const Y = Math.round( y * scale );
		const last = out[ out.length - 1 ];
		if ( ! last || last.X !== X || last.Y !== Y ) out.push( { X, Y } );
	}
	return out;
}

/**
 * Expands stroked polylines into fill polygons.
 *
 * @param {{points:number[][], closed:boolean}[]} subpaths
 * @param {{width:number, linecap:string, linejoin:string, miterLimit?:number}} stroke
 * @param {number} scale
 * @param {number} unit
 */
export function strokeToPolygons( subpaths, stroke, scale, unit ) {
	const co = new ClipperOffset( stroke.miterLimit ?? 4, TOLERANCES.arc * unit * scale );
	const join = JOIN[ stroke.linejoin ] ?? JoinType.jtRound;
	const end = END[ stroke.linecap ] ?? EndType.etOpenRound;
	const eps = TOLERANCES.dedupe * unit;
	let added = 0;
	for ( const sp of subpaths ) {
		const pts = toClipperPath( dedupe( sp.points, eps, sp.closed ), scale );
		if ( pts.length === 0 ) continue;
		if ( pts.length === 1 ) {
			// Zero-length subpath: a dot for round caps, a square for square caps, nothing for butt caps.
			if ( stroke.linecap === 'butt' ) continue;
			co.AddPath( pts, stroke.linecap === 'round' ? JoinType.jtRound : JoinType.jtMiter, EndType.etOpenRound );
			added++;
			continue;
		}
		if ( sp.closed && pts.length >= 3 ) {
			co.AddPath( pts, join, EndType.etClosedLine );
		} else {
			co.AddPath( pts, join, end );
		}
		added++;
	}
	const out = new Paths();
	if ( added ) co.Execute( out, ( stroke.width / 2 ) * scale );
	return out;
}

/** Converts filled subpaths into a consistently oriented polygon set. */
export function fillToPolygons( subpaths, fillRule, scale, unit ) {
	const c = new Clipper();
	c.StrictlySimple = true;
	const eps = TOLERANCES.dedupe * unit;
	let added = 0;
	for ( const sp of subpaths ) {
		const pts = toClipperPath( dedupe( sp.points, eps, true ), scale );
		if ( pts.length >= 3 && c.AddPath( pts, PolyType.ptSubject, true ) ) added++;
	}
	const out = new Paths();
	if ( ! added ) return out;
	const ft = fillRule === 'evenodd' ? PolyFillType.pftEvenOdd : PolyFillType.pftNonZero;
	c.Execute( ClipType.ctUnion, out, ft, ft );
	return out;
}

/** Boolean-unites several polygon sets (each already consistently oriented). */
export function unionPolygons( groups ) {
	const c = new Clipper();
	c.StrictlySimple = true;
	let added = 0;
	for ( const paths of groups ) {
		if ( paths && paths.length && c.AddPaths( paths, PolyType.ptSubject, true ) ) added += paths.length;
	}
	const out = new Paths();
	if ( ! added ) return out;
	c.Execute( ClipType.ctUnion, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero );
	return out;
}

/** Signed area in user units (for tests and sanity checks). */
export function polygonsArea( paths, scale ) {
	return paths.reduce( ( a, p ) => a + Clipper.Area( p ), 0 ) / ( scale * scale );
}

/* -------------------------------------------------------------------------- */
/* Polygon → path data with Bézier re-fitting                                 */
/* -------------------------------------------------------------------------- */

function isCorner( a, b, c, cornerCos ) {
	const ux = b[ 0 ] - a[ 0 ];
	const uy = b[ 1 ] - a[ 1 ];
	const vx = c[ 0 ] - b[ 0 ];
	const vy = c[ 1 ] - b[ 1 ];
	const lu = Math.hypot( ux, uy );
	const lv = Math.hypot( vx, vy );
	if ( lu === 0 || lv === 0 ) return false;
	return ( ux * vx + uy * vy ) / ( lu * lv ) < cornerCos;
}

const fmt = ( [ x, y ] ) => `${ num( x ) } ${ num( y ) }`;

/**
 * Edges longer than this (24-grid units) cannot be arc steps produced by
 * flattening or by Clipper's round joins (those stay below ~0.46 units for
 * any radius that fits a 24-unit icon), so they are straight source edges and
 * are emitted as line segments instead of being absorbed into a Bézier fit.
 */
const STRAIGHT_EDGE = 0.6;

function emitPiece( pts, fitTol ) {
	if ( pts.length < 2 ) return '';
	const a = pts[ 0 ];
	const b = pts[ pts.length - 1 ];
	let maxDev = 0;
	for ( let i = 1; i < pts.length - 1; i++ ) {
		maxDev = Math.max( maxDev, distToSegment( pts[ i ], a, b ) );
	}
	if ( maxDev <= fitTol ) return 'L' + fmt( b );
	// fit-curve takes a *squared* distance tolerance and, like the original
	// Graphics Gems code, only attempts Newton reparameterization while the
	// error is below tolerance². With tolerances < 1 that never happens and it
	// over-splits, so fit in a scaled space where the tolerance is 2 units.
	const k = 2 / fitTol;
	const scaled = pts.map( ( [ x, y ] ) => [ x * k, y * k ] );
	const beziers = fitCurve( scaled, 4 );
	return beziers
		.map( ( bz ) => bz.map( ( [ x, y ] ) => [ x / k, y / k ] ) )
		.map( ( bz ) => 'C' + fmt( bz[ 1 ] ) + ' ' + fmt( bz[ 2 ] ) + ' ' + fmt( bz[ 3 ] ) )
		.join( '' );
}

/** Emits one corner-to-corner run: straight edges as L, everything between them as fitted curves. */
function emitRun( run, fitTol, unit ) {
	const minEdge = STRAIGHT_EDGE * unit;
	let out = '';
	let piece = [ run[ 0 ] ];
	for ( let i = 1; i < run.length; i++ ) {
		const a = run[ i - 1 ];
		const b = run[ i ];
		if ( Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ) > minEdge ) {
			out += emitPiece( piece, fitTol );
			out += 'L' + fmt( b );
			piece = [ b ];
		} else {
			piece.push( b );
		}
	}
	return out + emitPiece( piece, fitTol );
}

function polygonToSubpath( pts, fitTol, cornerCos, unit ) {
	const n = pts.length;
	let splits = [];
	for ( let i = 0; i < n; i++ ) {
		if ( isCorner( pts[ ( i - 1 + n ) % n ], pts[ i ], pts[ ( i + 1 ) % n ], cornerCos ) ) splits.push( i );
	}
	if ( splits.length < 2 ) {
		// Smooth loop (e.g. a ring): split into quarters so each run is a short arc.
		const first = splits[ 0 ] ?? 0;
		const k = Math.max( 1, Math.floor( n / 4 ) );
		splits = [ ...new Set( [ ...splits, ...[ 0, 1, 2, 3 ].map( ( j ) => ( first + j * k ) % n ) ] ) ].sort( ( a, b ) => a - b );
	}
	let d = 'M' + fmt( pts[ splits[ 0 ] ] );
	for ( let s = 0; s < splits.length; s++ ) {
		const from = splits[ s ];
		const to = splits[ ( s + 1 ) % splits.length ];
		const run = [ pts[ from ] ];
		let i = from;
		do {
			i = ( i + 1 ) % n;
			run.push( pts[ i ] );
		} while ( i !== to );
		d += emitRun( run, fitTol, unit );
	}
	return d + 'Z';
}

/**
 * Converts Clipper polygons back to SVG path data, re-fitting curves.
 *
 * @param {Array} paths  Clipper Paths (integer coordinates).
 * @param {number} scale
 * @param {number} unit
 * @return {string}
 */
export function polygonsToPathData( paths, scale, unit ) {
	const fitTol = TOLERANCES.fit * unit;
	const eps = TOLERANCES.dedupe * unit;
	const cornerCos = Math.cos( ( TOLERANCES.cornerDeg * Math.PI ) / 180 );
	let d = '';
	for ( const poly of paths ) {
		const pts = dedupe( poly.map( ( p ) => [ p.X / scale, p.Y / scale ] ), eps, true );
		if ( pts.length < 3 ) continue;
		d += polygonToSubpath( pts, fitTol, cornerCos, unit );
	}
	return d;
}

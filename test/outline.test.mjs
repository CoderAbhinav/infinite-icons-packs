import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	fillToPolygons, flattenPathData, polygonsArea, polygonsToPathData, scaleFor, strokeToPolygons, unionPolygons, unitFor,
} from '../src/outline.mjs';

const vb = { x: 0, y: 0, width: 24, height: 24 };
const unit = unitFor( vb );
const scale = scaleFor( vb );
const round = { width: 2, linecap: 'round', linejoin: 'round' };

test( 'flattenPathData handles M/L/H/V/C/Q/Z and drawing after Z', () => {
	const sub = flattenPathData( 'M0 0h10v10H0Zl5 5', 0.01 );
	assert.equal( sub.length, 2 );
	assert.equal( sub[ 0 ].closed, true );
	assert.deepEqual( sub[ 0 ].points, [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ], [ 0, 10 ] ] );
	assert.equal( sub[ 1 ].closed, false );
	assert.deepEqual( sub[ 1 ].points, [ [ 0, 0 ], [ 5, 5 ] ] );
	const curve = flattenPathData( 'M0 0C0 10 10 10 10 0Q15 -5 20 0', 0.01 );
	assert.ok( curve[ 0 ].points.length > 10 );
	assert.deepEqual( curve[ 0 ].points.at( -1 ), [ 20, 0 ] );
} );

test( 'round-capped line strokes to the exact capsule area', () => {
	const polys = strokeToPolygons( flattenPathData( 'M2 12h20', 0.001 ), round, scale, unit );
	assert.equal( polys.length, 1 );
	assert.ok( Math.abs( Math.abs( polygonsArea( polys, scale ) ) - ( 40 + Math.PI ) ) < 0.02 );
} );

test( 'zero-length subpath becomes a dot for round caps and nothing for butt caps', () => {
	const sub = flattenPathData( 'M12 12h0.0001', 0.001 );
	const dot = strokeToPolygons( sub, round, scale, unit );
	assert.ok( Math.abs( Math.abs( polygonsArea( dot, scale ) ) - Math.PI ) < 0.02 );
	const none = strokeToPolygons( sub, { width: 2, linecap: 'butt', linejoin: 'miter' }, scale, unit );
	assert.equal( none.length, 0 );
} );

test( 'closed stroked square yields an outer ring and a hole', () => {
	const polys = strokeToPolygons( flattenPathData( 'M4 4h16v16H4z', 0.001 ), round, scale, unit );
	assert.equal( polys.length, 2 );
	const area = polygonsArea( polys, scale );
	// 18x18 with rounded corners minus 14x14 hole: 324 - (4 - π) - 196
	assert.ok( Math.abs( area - ( 324 - ( 4 - Math.PI ) - 196 ) ) < 0.05, String( area ) );
} );

test( 'union merges overlapping strokes and fills', () => {
	const a = strokeToPolygons( flattenPathData( 'M2 12h20', 0.001 ), round, scale, unit );
	const b = strokeToPolygons( flattenPathData( 'M12 2v20', 0.001 ), round, scale, unit );
	const c = fillToPolygons( flattenPathData( 'M11 11h2v2h-2z', 0.001 ), 'nonzero', scale, unit );
	const u = unionPolygons( [ a, b, c ] );
	assert.equal( u.length, 1 );
	// two capsules overlapping in a 2x2 square
	assert.ok( Math.abs( Math.abs( polygonsArea( u, scale ) ) - ( 2 * ( 40 + Math.PI ) - 4 ) ) < 0.05 );
} );

test( 'evenodd fill keeps holes', () => {
	const polys = fillToPolygons( flattenPathData( 'M2 2h20v20H2zM6 6h12v12H6z', 0.001 ), 'evenodd', scale, unit );
	assert.equal( polys.length, 2 );
	assert.ok( Math.abs( polygonsArea( polys, scale ) - ( 400 - 144 ) ) < 0.01 );
} );

test( 'polygonsToPathData re-fits smooth loops and keeps straight edges as lines', () => {
	const ring = strokeToPolygons( flattenPathData( 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20', 0.001 ), round, scale, unit );
	const d = polygonsToPathData( ring, scale, unit );
	assert.match( d, /^M[^M]+Z(M[^M]+Z)?$/ );
	assert.ok( ( d.match( /C/g ) ?? [] ).length <= 24, `too many curve segments: ${ d.length } chars` );
	const box = polygonsToPathData( strokeToPolygons( flattenPathData( 'M4 4h16v16H4z', 0.001 ), round, scale, unit ), scale, unit );
	assert.ok( ( box.match( /L/g ) ?? [] ).length >= 8, box );
} );

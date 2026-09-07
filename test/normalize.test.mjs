import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSvg } from '../src/normalize.mjs';
import { validateIconSvg } from '../src/validate-kses.mjs';
import { compareSvgs } from '../src/validate-visual.mjs';

const stroke = { width: 2, linecap: 'round', linejoin: 'round' };
const wrap = ( body, attrs = '' ) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${ attrs }>${ body }</svg>`;

test( 'stroke icon becomes one canonical fill path that renders identically', () => {
	const src = wrap( '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><line x1="12" y1="8" x2="12" y2="16"/>' );
	const { svg, stats } = normalizeSvg( src, { geometry: 'stroke', stroke } );
	assert.equal( validateIconSvg( svg ).ok, true );
	assert.equal( ( svg.match( /<path/g ) ).length, 1 );
	assert.equal( stats.united, true );
	const cmp = compareSvgs( src, svg );
	assert.ok( cmp.ok, `diff ${ cmp.ratio }` );
} );

test( 'filled child shapes are united with strokes', () => {
	const src = wrap( '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>' );
	const { svg } = normalizeSvg( src, { geometry: 'stroke', stroke } );
	assert.ok( compareSvgs( src, svg ).ok );
} );

test( 'pure fill icons keep paths and fill-rule without uniting', () => {
	const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2 2h20v20H2zM6 6h12v12H6z"/><rect x="1" y="1" width="2" height="2"/></svg>';
	const { svg, stats } = normalizeSvg( src, { geometry: 'fill' } );
	assert.equal( stats.united, false );
	assert.equal( validateIconSvg( svg ).ok, true );
	assert.match( svg, /fill-rule="evenodd"/ );
	assert.ok( compareSvgs( src, svg ).ok );
} );

test( 'transforms and groups are flattened', () => {
	const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g transform="translate(12 12)"><rect x="-5" y="-5" width="10" height="10" transform="rotate(45)"/></g></svg>';
	const { svg } = normalizeSvg( src, { geometry: 'fill' } );
	assert.equal( validateIconSvg( svg ).ok, true );
	assert.ok( compareSvgs( src, svg ).ok );
} );

test( 'unsupported content is rejected', () => {
	assert.throws( () => normalizeSvg( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text>x</text></svg>', { geometry: 'fill' } ), /Unsupported element/ );
	assert.throws( () => normalizeSvg( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0h1v1z"/></svg>', { geometry: 'fill' } ), /Unsupported/ );
	assert.throws( () => normalizeSvg( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" d="M0 0h1v1z"/></svg>', { geometry: 'fill' } ), /No visible geometry/ );
} );

test( 'non-square viewBox is preserved', () => {
	const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path d="M0 0h640v512H0z"/></svg>';
	const { svg } = normalizeSvg( src, { geometry: 'fill' } );
	assert.match( svg, /viewBox="0 0 640 512"/ );
} );

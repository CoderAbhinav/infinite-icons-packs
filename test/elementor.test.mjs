import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildElementorAssets, svgToDataUri } from '../src/elementor-css.mjs';

test( 'data URI escapes characters that break url()', () => {
	const uri = svgToDataUri( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M1 2#"/></svg>' );
	assert.ok( uri.startsWith( 'data:image/svg+xml,%3Csvg' ) );
	assert.ok( ! /[<>"#]/.test( uri ) );
} );

test( 'elementor assets contain one class per icon and a JSON list', () => {
	const icons = [ { name: 'heart', svg: '<svg/>' }, { name: 'home-solid', svg: '<svg/>' } ];
	const { css, json } = buildElementorAssets( { slug: 'x', label: 'X', license: { spdx: 'MIT' } }, icons );
	assert.match( css, /\.ii-x\{/ );
	assert.match( css, /\.ii-x-heart\{/ );
	assert.match( css, /\.ii-x-home-solid\{/ );
	assert.deepEqual( JSON.parse( json ), { icons: [ 'heart', 'home-solid' ] } );
} );

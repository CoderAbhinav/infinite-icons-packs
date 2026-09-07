import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedKsesForm, validateIconSvg, wpKses } from '../src/validate-kses.mjs';

// Ground truth captured from WordPress 7.1 wp_kses() with the core icon allowlist.
const cases = [
	[
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M1 2l3 4z"/></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 24 24"><path fill="currentColor" d="M1 2l3 4z" /></svg>',
	],
	[
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M1 2l3 4z"></path></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 24 24"><path fill="currentColor" d="M1 2l3 4z"></path></svg>',
	],
	[
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="1" cy="1" r="1"/><path d="M1 2" stroke-width="2"/><g><path d="M0 0"/></g></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 24 24"><path d="M1 2" /><path d="M0 0" /></svg>',
	],
	[
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M1 2l3 4z"/><path fill="currentColor" d="M5 6"/></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M1 2l3 4z" /><path fill="currentColor" d="M5 6" /></svg>',
	],
];

test( 'wpKses port matches WordPress 7.1 output', () => {
	for ( const [ input, expected ] of cases ) {
		assert.equal( wpKses( input ), expected );
	}
} );

test( 'wpKses strips comments, processing instructions and style', () => {
	const out = wpKses( '<?xml version="1.0"?><!-- hi --><svg viewBox="0 0 1 1"><style>.a{}</style><path d="M0 0" style="fill:red" onclick="x()"/></svg>' );
	assert.equal( out, '<!-- hi --><svg viewbox="0 0 1 1">.a{}<path d="M0 0" /></svg>' );
} );

test( 'validateIconSvg accepts canonical icons', () => {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M1 2l3 4z"/><path fill="currentColor" fill-rule="evenodd" d="M5 6h1v1z"/></svg>';
	assert.deepEqual( validateIconSvg( svg ), { ok: true, errors: [] } );
	assert.equal( expectedKsesForm( svg ), wpKses( svg ) );
} );

test( 'validateIconSvg rejects anything the sanitizer would touch', () => {
	const bad = [
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="1" cy="1" r="1"/></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 2"/></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="red"><path fill="currentColor" d="M1 2"/></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M1 2" transform="rotate(1)"/></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!-- c --><path fill="currentColor" d="M1 2"/></svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M1 2"/> </svg>',
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24"><path fill="currentColor" d="M1 2"/></svg>',
	];
	for ( const svg of bad ) {
		assert.equal( validateIconSvg( svg ).ok, false, svg );
	}
} );

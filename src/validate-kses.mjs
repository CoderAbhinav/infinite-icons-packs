/**
 * Node port of the parts of wp_kses() that WordPress core applies to icons
 * (WP_Icons_Registry::sanitize_icon_content), plus a strict canonical-format
 * check. The port is a guard; scripts/validate-kses-wp.mjs runs the real
 * wp_kses() against a WordPress install for ground truth.
 */
import { parseSync } from 'svgson';
import { SVG_NS } from './normalize.mjs';

/** Exactly the allowlist in wp-includes/class-wp-icons-registry.php (WP 7.1). */
export const ICON_ALLOWED_HTML = {
	svg: new Set( [ 'class', 'xmlns', 'width', 'height', 'viewbox', 'aria-hidden', 'role', 'focusable' ] ),
	path: new Set( [ 'fill', 'fill-rule', 'd', 'transform' ] ),
	polygon: new Set( [ 'fill', 'fill-rule', 'points', 'transform', 'focusable' ] ),
};

function normalizeEntities( s ) {
	return s.replace( /&(?!(?:[A-Za-z]{2,8}[0-9]{0,2}|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, '&amp;' );
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities( v ) {
	return v.replace( /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, ( m, ref ) => {
		if ( ref[ 0 ] === '#' ) {
			const cp = ref[ 1 ] === 'x' || ref[ 1 ] === 'X' ? parseInt( ref.slice( 2 ), 16 ) : parseInt( ref.slice( 1 ), 10 );
			return Number.isFinite( cp ) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint( cp ) : m;
		}
		return NAMED[ ref ] ?? m;
	} );
}
const recode = ( v ) => v.replace( /[&<>'"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' }[ c ] ) );
const isWs = ( c ) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

/**
 * Port of wp_kses_hair() (WP ≥ 6.7, which tokenizes with WP_HTML_Tag_Processor):
 * names are lowercased, the first occurrence of a duplicate wins, values are
 * decoded and re-encoded with the five syntax characters, stray "/" is skipped.
 */
function ksesHair( attr ) {
	const out = new Map();
	const n = attr.length;
	let i = 0;
	while ( i < n ) {
		while ( i < n && ( isWs( attr[ i ] ) || attr[ i ] === '/' ) ) i++;
		if ( i >= n ) break;
		const start = i;
		if ( attr[ i ] === '=' ) i++;
		while ( i < n && ! isWs( attr[ i ] ) && attr[ i ] !== '/' && attr[ i ] !== '=' && attr[ i ] !== '>' ) i++;
		const name = attr.slice( start, i ).toLowerCase();
		let j = i;
		while ( j < n && isWs( attr[ j ] ) ) j++;
		let value = true;
		if ( attr[ j ] === '=' ) {
			j++;
			while ( j < n && isWs( attr[ j ] ) ) j++;
			const q = attr[ j ];
			if ( q === '"' || q === "'" ) {
				const close = attr.indexOf( q, j + 1 );
				const stop = close === -1 ? n : close;
				value = attr.slice( j + 1, stop );
				j = stop + 1;
			} else {
				const vs = j;
				while ( j < n && ! isWs( attr[ j ] ) && attr[ j ] !== '>' ) j++;
				value = attr.slice( vs, j );
			}
			i = j;
		}
		if ( ! name || out.has( name ) ) continue;
		const isBool = value === true;
		const recoded = isBool ? '' : recode( decodeEntities( value ) );
		out.set( name, { name, value: recoded, whole: isBool ? name : `${ name }="${ recoded }"`, vless: isBool ? 'y' : 'n' } );
	}
	return [ ...out.values() ];
}

function ksesAttr( elem, attr, allowed ) {
	const xhtmlSlash = /\s*\/\s*$/.test( attr ) ? ' /' : '';
	if ( ! allowed || allowed.size === 0 ) return `<${ elem }${ xhtmlSlash }>`;
	let attr2 = '';
	for ( const a of ksesHair( attr ) ) {
		if ( allowed.has( a.name ) ) attr2 += ' ' + a.whole;
	}
	attr2 = attr2.replace( /[<>]/g, '' );
	return `<${ elem }${ attr2 }${ xhtmlSlash }>`;
}

function ksesSplit2( str, allowedHtml ) {
	str = str.replace( /\\"/g, '"' ); // wp_kses_stripslashes
	if ( str[ 0 ] !== '<' ) return '&gt;';
	if ( /^(?:<\/[^a-zA-Z][^>]*>|<![a-z][^>]*>)$/.test( str ) ) {
		const opener = str[ 1 ];
		let c = str.slice( 2, -1 );
		let prev;
		do {
			prev = c;
			c = wpKses( c, allowedHtml );
		} while ( prev !== c );
		return `<${ opener }${ c }>`;
	}
	if ( str.startsWith( '<!--' ) ) {
		let c = str.replace( /<!--|-->/g, '' );
		let next;
		while ( ( next = wpKses( c, allowedHtml ) ) !== c ) c = next;
		if ( c === '' ) return '';
		c = c.replace( /--+/g, '-' ).replace( /-$/, '' );
		return `<!--${ c }-->`;
	}
	const m = /^<\s*(\/\s*)?([a-zA-Z0-9-]+)([^>]*)>?$/.exec( str );
	if ( ! m ) return '';
	const slash = ( m[ 1 ] ?? '' ).trim();
	const elem = m[ 2 ];
	const allowed = allowedHtml[ elem.toLowerCase() ];
	if ( ! allowed ) return '';
	if ( slash ) return `</${ elem }>`;
	return ksesAttr( elem, m[ 3 ], allowed );
}

/** Port of wp_kses() for a fixed element/attribute allowlist (icons need no protocol filtering). */
export function wpKses( content, allowedHtml = ICON_ALLOWED_HTML ) {
	const s = normalizeEntities( content.replace( /\0/g, '' ) );
	return s.replace( /(<!--.*?(-->|$))|<\/[^a-zA-Z][^>]*>|<![^>]*>|(<[^>]*(>|$)|>)/g, ( m ) => ksesSplit2( m, allowedHtml ) );
}

/** What wp_kses() is expected to turn a canonical icon into: lowercase attribute names and " />". */
export function expectedKsesForm( canonicalSvg ) {
	return canonicalSvg.replace( / viewBox=/g, ' viewbox=' ).replace( /\/>/g, ' />' );
}

const CANONICAL_RE = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[^"<>&]+">(?:<path fill="currentColor"(?: fill-rule="evenodd")? d="[^"<>&]+"\/>)+<\/svg>$/;
const PATH_DATA_RE = /^[MmZzLlHhVvCcSsQqTtAa0-9.,\s-]+$/;

/**
 * Validates a canonical icon: strict byte format + kses round trip.
 *
 * @param {string} svg
 * @return {{ok: boolean, errors: string[]}}
 */
export function validateIconSvg( svg ) {
	const errors = [];
	if ( ! CANONICAL_RE.test( svg ) ) errors.push( 'not in canonical byte format' );
	let root;
	try {
		root = parseSync( svg );
	} catch ( e ) {
		return { ok: false, errors: [ ...errors, `unparseable: ${ e.message }` ] };
	}
	if ( root.attributes.xmlns !== SVG_NS ) errors.push( 'missing xmlns' );
	const vb = ( root.attributes.viewBox ?? '' ).split( ' ' ).map( Number );
	if ( vb.length !== 4 || ! vb.every( Number.isFinite ) || vb[ 2 ] <= 0 || vb[ 3 ] <= 0 ) errors.push( 'invalid viewBox' );
	for ( const child of root.children ) {
		if ( child.type !== 'element' || child.name !== 'path' ) {
			errors.push( `unexpected node ${ child.type === 'element' ? '<' + child.name + '>' : child.type }` );
			continue;
		}
		for ( const k of Object.keys( child.attributes ) ) {
			if ( ! [ 'fill', 'fill-rule', 'd' ].includes( k ) ) errors.push( `unexpected attribute ${ k }` );
		}
		if ( child.attributes.fill !== 'currentColor' ) errors.push( 'path fill must be currentColor' );
		if ( child.attributes[ 'fill-rule' ] && child.attributes[ 'fill-rule' ] !== 'evenodd' ) errors.push( 'fill-rule must be omitted or evenodd' );
		if ( ! PATH_DATA_RE.test( child.attributes.d ?? '' ) ) errors.push( 'path data contains unexpected characters' );
		if ( child.children.length ) errors.push( 'path must be empty' );
	}
	const ksesOut = wpKses( svg );
	if ( ksesOut !== expectedKsesForm( svg ) ) errors.push( 'wp_kses would alter the markup' );
	if ( wpKses( ksesOut ) !== ksesOut ) errors.push( 'wp_kses output is not idempotent' );
	return { ok: errors.length === 0, errors };
}

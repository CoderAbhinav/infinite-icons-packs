import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Same rule core applies to collection slugs and unqualified icon names. */
export const NAME_RE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export function titleCase( name ) {
	return name
		.split( /[-_]+/ )
		.filter( Boolean )
		.map( ( t ) => t.charAt( 0 ).toUpperCase() + t.slice( 1 ) )
		.join( ' ' );
}

export function sha256( buf ) {
	return createHash( 'sha256' ).update( buf ).digest( 'hex' );
}

/** Formats a number with at most 3 decimals and no trailing zeros. */
export function num( v ) {
	const s = v.toFixed( 3 ).replace( /\.?0+$/, '' );
	return s === '-0' ? '0' : s;
}

/** Recursively lists files below dir as POSIX relative paths, sorted. */
export function walk( dir, base = dir ) {
	const out = [];
	for ( const entry of readdirSync( dir ).sort() ) {
		const full = path.join( dir, entry );
		if ( statSync( full ).isDirectory() ) {
			out.push( ...walk( full, base ) );
		} else {
			out.push( path.relative( base, full ).split( path.sep ).join( '/' ) );
		}
	}
	return out.sort();
}

export function parseArgs( argv ) {
	const flags = {};
	const positional = [];
	for ( const a of argv ) {
		if ( a.startsWith( '--' ) ) {
			const [ k, v ] = a.slice( 2 ).split( '=' );
			flags[ k ] = v === undefined ? true : v;
		} else {
			positional.push( a );
		}
	}
	return { flags, positional };
}

export function compareSemver( a, b ) {
	const pa = a.split( /[.+-]/ ).map( ( x ) => ( /^\d+$/.test( x ) ? Number( x ) : x ) );
	const pb = b.split( /[.+-]/ ).map( ( x ) => ( /^\d+$/.test( x ) ? Number( x ) : x ) );
	for ( let i = 0; i < Math.max( pa.length, pb.length ); i++ ) {
		const x = pa[ i ] ?? 0;
		const y = pb[ i ] ?? 0;
		if ( x === y ) continue;
		if ( typeof x === 'number' && typeof y === 'number' ) return x < y ? -1 : 1;
		return String( x ) < String( y ) ? -1 : 1;
	}
	return 0;
}

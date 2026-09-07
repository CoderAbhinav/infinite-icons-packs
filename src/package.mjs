/**
 * Zips a built pack directory (deterministically) and writes dist/index.json.
 */
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import yazl from 'yazl';
import { sha256, walk } from './util.mjs';

/** Fixed timestamp so identical inputs produce identical zips. */
const ZIP_MTIME = new Date( '2000-01-01T00:00:00Z' );

/**
 * @param {string} srcDir   Directory to zip.
 * @param {string} zipPath  Output file.
 * @param {string} rootName Top-level folder name inside the zip.
 * @return {Promise<{sha256: string, size: number, files: number}>}
 */
export async function zipDirectory( srcDir, zipPath, rootName ) {
	const zip = new yazl.ZipFile();
	const files = walk( srcDir );
	for ( const rel of files ) {
		zip.addFile( path.join( srcDir, rel ), `${ rootName }/${ rel }`, { mtime: ZIP_MTIME, mode: 0o100644, compress: true } );
	}
	zip.end();
	await pipeline( zip.outputStream, createWriteStream( zipPath ) );
	const buf = readFileSync( zipPath );
	return { sha256: sha256( buf ), size: buf.length, files: files.length };
}

/**
 * @param {string} file
 * @param {object[]} packs Index entries (see README § index.json).
 */
export function writeIndex( file, packs ) {
	const index = {
		schema: 1,
		generated: new Date().toISOString().replace( /\.\d{3}Z$/, 'Z' ),
		packs: [ ...packs ].sort( ( a, b ) => a.slug.localeCompare( b.slug ) ),
	};
	writeFileSync( file, JSON.stringify( index, null, 2 ) + '\n' );
	return index;
}

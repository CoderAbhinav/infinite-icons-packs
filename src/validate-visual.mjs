/**
 * Visual regression check: renders the upstream SVG and the normalized SVG
 * with resvg and compares them with pixelmatch.
 */
import { Resvg } from '@resvg/resvg-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RENDER_SIZE = 96;
export const PIXEL_THRESHOLD = 0.1;
export const MAX_DIFF_RATIO = 0.01;

/** resvg resolves currentColor to black already; make it explicit and drop comments. */
export function prepareForRender( svg ) {
	return svg.replace( /currentColor/g, '#000' ).replace( /<!--[\s\S]*?-->/g, '' );
}

/**
 * System font loading costs ~90 ms per render and would make results depend on
 * the machine. Icons never contain text (the normalizer rejects <text>), so it
 * is disabled.
 */
const RESVG_OPTIONS = { background: 'rgba(0,0,0,0)', font: { loadSystemFonts: false, fontFiles: [] } };

export function render( svg, size = RENDER_SIZE ) {
	const img = new Resvg( prepareForRender( svg ), { ...RESVG_OPTIONS, fitTo: { mode: 'width', value: size } } ).render();
	return { width: img.width, height: img.height, pixels: Buffer.from( img.pixels ) };
}

/**
 * @return {{ok:boolean, ratio:number, diffPixels:number, width:number, height:number, reason?:string}}
 */
export function compareSvgs( sourceSvg, outputSvg, size = RENDER_SIZE ) {
	let a;
	let b;
	try {
		a = render( sourceSvg, size );
		b = render( outputSvg, size );
	} catch ( e ) {
		return { ok: false, ratio: 1, diffPixels: -1, width: 0, height: 0, reason: `render failed: ${ e.message }` };
	}
	if ( a.width !== b.width || a.height !== b.height ) {
		return { ok: false, ratio: 1, diffPixels: -1, width: a.width, height: a.height, reason: `dimension mismatch ${ a.width }x${ a.height } vs ${ b.width }x${ b.height }` };
	}
	const diff = Buffer.alloc( a.width * a.height * 4 );
	const diffPixels = pixelmatch( a.pixels, b.pixels, diff, a.width, a.height, { threshold: PIXEL_THRESHOLD } );
	const ratio = diffPixels / ( a.width * a.height );
	return { ok: ratio <= MAX_DIFF_RATIO, ratio, diffPixels, width: a.width, height: a.height };
}

function pngDataUri( pixels, width, height ) {
	const png = new PNG( { width, height } );
	pixels.copy( png.data );
	return `data:image/png;base64,${ PNG.sync.write( png ).toString( 'base64' ) }`;
}

/** Renders source/output/diff images for the report. */
export function renderTriple( sourceSvg, outputSvg, size = RENDER_SIZE ) {
	const a = render( sourceSvg, size );
	const b = render( outputSvg, size );
	const diff = Buffer.alloc( a.width * a.height * 4 );
	pixelmatch( a.pixels, b.pixels, diff, a.width, a.height, { threshold: PIXEL_THRESHOLD } );
	return {
		source: pngDataUri( a.pixels, a.width, a.height ),
		output: pngDataUri( b.pixels, b.width, b.height ),
		diff: pngDataUri( diff, a.width, a.height ),
	};
}

const esc = ( s ) => String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ c ] ) );

/**
 * Writes an HTML report listing the N worst visual diffs plus all failures.
 *
 * @param {string} file
 * @param {{pack: object, version: string, icons: Array, failures: Array, worst: number}} data
 */
export function writeReport( file, { pack, version, icons, failures, worst = 50 } ) {
	mkdirSync( path.dirname( file ), { recursive: true } );
	const sorted = [ ...icons ].sort( ( a, b ) => b.ratio - a.ratio ).slice( 0, worst );
	const failing = icons.filter( ( i ) => i.ratio > MAX_DIFF_RATIO ).length;
	const mean = icons.length ? icons.reduce( ( s, i ) => s + i.ratio, 0 ) / icons.length : 0;
	const rows = sorted.map( ( icon ) => {
		const imgs = renderTriple( icon.source, icon.svg, 128 );
		const bad = icon.ratio > MAX_DIFF_RATIO;
		return `<tr class="${ bad ? 'fail' : 'pass' }"><td><code>${ esc( icon.name ) }</code><br><small>${ icon.warnings.map( esc ).join( '<br>' ) }</small></td>
<td>${ ( icon.ratio * 100 ).toFixed( 3 ) }%</td>
<td><img src="${ imgs.source }" alt=""></td><td><img src="${ imgs.output }" alt=""></td><td><img src="${ imgs.diff }" alt=""></td>
<td class="svg">${ icon.svg }</td></tr>`;
	} ).join( '\n' );
	const failRows = failures.map( ( f ) => `<tr><td><code>${ esc( f.name ) }</code></td><td>${ esc( f.stage ) }</td><td>${ esc( f.message ) }</td></tr>` ).join( '\n' );
	const html = `<!doctype html><meta charset="utf-8"><title>${ esc( pack.label ) } ${ esc( version ) } — visual report</title>
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:2rem;color:#222}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px;vertical-align:top}th{background:#f4f4f4;text-align:left}
img{width:128px;height:128px;background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px;image-rendering:pixelated}
tr.fail td:nth-child(2){background:#fdd;font-weight:700}tr.pass td:nth-child(2){background:#dfd}
td.svg{max-width:300px;font:11px/1.3 ui-monospace,monospace;word-break:break-all;color:#555}
td.svg svg{width:48px;height:48px;display:block;margin-bottom:4px;color:#000}
</style>
<h1>${ esc( pack.label ) } <small>${ esc( version ) }</small></h1>
<p>${ icons.length } icons · threshold ${ MAX_DIFF_RATIO * 100 }% of pixels at ${ RENDER_SIZE }px · mean diff ${ ( mean * 100 ).toFixed( 4 ) }% · <strong>${ failing } visual failures</strong> · ${ failures.length } total failures</p>
${ failures.length ? `<h2>Failures</h2><table><tr><th>Icon</th><th>Stage</th><th>Message</th></tr>${ failRows }</table>` : '' }
<h2>${ sorted.length } worst diffs</h2>
<table><tr><th>Icon</th><th>Diff</th><th>Upstream</th><th>Normalized</th><th>Pixel diff</th><th>Output SVG</th></tr>
${ rows }
</table>`;
	writeFileSync( file, html );
}

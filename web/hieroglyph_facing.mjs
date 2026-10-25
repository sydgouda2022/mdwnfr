/**
 * Unicode code-chart hieroglyphs have LTR sign orientation.
 * RTL mirrors visible quadrats, including paired-row visual order.
 * Stored codepoints, words and layout coordinates remain unchanged.
 * Unicode 17.0 Unikemet exceptions: https://www.unicode.org/Public/17.0.0/ucd/Unikemet.txt
 */
export const NO_MIRROR_HIEROGLYPHS=new Set([
 '\u{13081}', // D011 left eye white
 '\u{13084}', // D014 right eye white
 '\u{130BB}', // D054 movement
 '\u{130BD}'  // D055 reverse movement
]);
export function reverseVisualQuadrat(direction){
 if(direction!=='rtl'&&direction!=='ltr')throw new RangeError('Writing direction must be rtl or ltr');
 return direction==='rtl';
}
export function mirrorSign(direction,sign){
 return reverseVisualQuadrat(direction)&&!NO_MIRROR_HIEROGLYPHS.has(sign);
}

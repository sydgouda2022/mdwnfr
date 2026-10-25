// Display-only presets. Python continues to own every document/style transaction.
export const EGYPTIAN_COLOURS = [
  {name:'Egyptian blue', shades:['#b5d2ee','#1f4ba8','#153f8e','#102e64']},
  {name:'Nile green', shades:['#b9cdb0','#6f9d70','#2e7d56','#154e3c']},
  {name:'Turquoise', shades:['#afe3e6','#2ab6c8','#148e9f','#116576']},
  {name:'Ochre and gold', shades:['#e3c790','#ddb441','#cc971d','#996017']},
  {name:'Red ochre', shades:['#d6957e','#c24c32','#ad282b','#77342d']},
  {name:'Limestone and ink', shades:['#eae4d3','#b9b0a0','#595752','#171817']},
];

export function normalizeColour(value) {
  const raw=String(value).trim().replace(/^#/,'');
  if(/^[0-9a-f]{3}$/i.test(raw))return '#'+[...raw].map(c=>c+c).join('').toLowerCase();
  return /^[0-9a-f]{6}$/i.test(raw)?'#'+raw.toLowerCase():null;
}

export function buildEgyptianPalette(container,onChoose) {
  const fragment=document.createDocumentFragment();
  for(let shade=0;shade<4;shade++)for(const family of EGYPTIAN_COLOURS) {
    const value=family.shades[shade];
    const button=document.createElement('button');
    button.type='button';button.className='egyptian-swatch';
    button.dataset.color=value;button.style.setProperty('--chip',value);
    const name=family.name+' — '+['light','medium','rich','deep'][shade];
    button.title=name;button.setAttribute('aria-label',name);
    button.setAttribute('aria-pressed','false');
    button.onclick=()=>onChoose(value);
    fragment.append(button);
  }
  container.replaceChildren(fragment);
}

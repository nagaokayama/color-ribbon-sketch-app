'use strict';
// The canvas stores only transparent ink. White is composited for sampling/export.
const $ = id => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const roles = ['濃い影', '影', 'ベース', 'ハイライト', '明るいハイライト'];
const stacks = [
  ['#714d51', '#b3726c', '#df9e87', '#f1c2a3', '#f9e3c4'],
  ['#304a49', '#507765', '#83a77c', '#b6c998', '#e1e7bd'],
  ['#39405c', '#626e96', '#929fc5', '#bec9e2', '#e8eaf3']
];
const rampFields = [
  ['lightHue','ハイライトの色相移動',-30,30,-15,'°'],
  ['highlight','ハイライトの明度',0,100,65,'%'],
  ['highlightSat','ハイライトの彩度',0,100,30,'%'],
  ['shadowHue','影の色相移動',-30,30,20,'°'],
  ['shadowDepth','影の明度',0,100,45,'%'],
  ['shadowSat','影の彩度',0,100,45,'%']
];
// Shadow depth retains its JSON meaning; saturation is absolute.

const sliderValue = (key,value) => key==='shadowDepth'?100-value:value;
const rampValue = (key,value) => key==='shadowDepth'?100-value:value;
const sliderLabel = (key,value,unit) => value+unit;
const newRamp = () => Object.fromEntries(rampFields.map(([key,,,,value])=>[key,value]));
const ramps = stacks.map(newRamp);
const baseColors = stacks.map(colors => colors[2]);
const clamp = x => Math.max(0,Math.min(100,x));
// Oklab transforms by Björn Ottosson: https://bottosson.github.io/posts/oklab/
function hexToOklab(hex) {
  const [r,g,b]=hex.match(/\w\w/g).map(value=>{
    const c=parseInt(value,16)/255;
    return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
  });
  const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b);
  const m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b);
  const s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
  return [0.2104542553*l+0.7936177850*m-0.0040720468*s,
    1.9779984951*l-2.4285922050*m+0.4505937099*s,
    0.0259040371*l+0.7827717662*m-0.8086757660*s];
}
function oklabToLinearRgb([L,a,b]) {
  const l=(L+0.3963377774*a+0.2158037573*b)**3;
  const m=(L-0.1055613458*a-0.0638541728*b)**3;
  const s=(L-0.0894841775*a-1.2914855480*b)**3;
  return [4.0767416621*l-3.3077115913*m+0.2309699292*s,
    -1.2684380046*l+2.6097574011*m-0.3413193965*s,
    -0.0041960863*l-0.7034186147*m+1.7076147010*s];
}
function oklabToHex(lab) {
  const inGamut=rgb=>rgb.every(c=>c>=-1e-7 && c<=1+1e-7);
  let rgb=oklabToLinearRgb(lab);
  if(!inGamut(rgb)){
    // Reduce chroma at constant lightness/hue rather than clip RGB channels.
    let low=0,high=1;
    for(let i=0;i<24;i++){
      const scale=(low+high)/2;
      if(inGamut(oklabToLinearRgb([lab[0],lab[1]*scale,lab[2]*scale])))low=scale;
      else high=scale;
    }
    rgb=oklabToLinearRgb([lab[0],lab[1]*low,lab[2]*low]);
  }
  return '#'+rgb.map(c=>{
    c=Math.max(0,Math.min(1,c));
    return Math.round(255*(c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055)).toString(16).padStart(2,'0');
  }).join('');
}
function oklabMidpoint(from,to) {
  const a=hexToOklab(from),b=hexToOklab(to);
  return oklabToHex(a.map((value,i)=>(value+b[i])/2));
}
function colorAtLightness(hue,saturation,lightness) {
  // Use HSV only to choose the color direction, then set perceptual lightness.
  const [L,a,b]=hexToOklab(hsvToHex(hue,saturation,100));
  const scale=lightness/L;
  return oklabToHex([lightness,a*scale,b*scale]);
}
function regenerate(i) {
  const base=baseColors[i],[h]=hexToHsv(base),r=ramps[i];
  const L=hexToOklab(base)[0];
  const shadowL=L*(1-r.shadowDepth/100);
  const highlightL=L+(1-L)*r.highlight/100;
  const shadow=colorAtLightness(h+r.shadowHue,r.shadowSat,shadowL);
  const highlight=colorAtLightness(h+r.lightHue,r.highlightSat,highlightL);
  stacks[i]=[shadow,oklabMidpoint(shadow,base),base,oklabMidpoint(base,highlight),highlight];
}
stacks.forEach((_,i)=>regenerate(i));
let selected = [0, 2], tool = 'pen', ink = stacks[0][2];
const sizes = { pen: 16, eraser: 16 };
let penOpacity=100;
const strokeCanvas=document.createElement('canvas');
strokeCanvas.width=strokeCanvas.height=1024;
const strokeCtx=strokeCanvas.getContext('2d');
$('penOpacity').oninput=e=>{penOpacity=+e.target.value;$('penOpacityValue').textContent=penOpacity+'%';};
let active = null;
const undo = [], redo = [];
const viewport=$('viewport');
const zoomSteps=[0.1,0.125,0.25,0.5,0.75,1,1.5,2,3,4];
let zoom=1,fitZoom=true;
function renderZoom() {
  if(active!==null) return;
  if(fitZoom) zoom=Math.max(1/1024,Math.min((viewport.clientWidth-32)/1024,(viewport.clientHeight-32)/1024));
  canvas.style.width=(1024*zoom)+'px';
  canvas.style.height=(1024*zoom)+'px';
  $('zoomValue').textContent=(zoom*100).toFixed(1).replace(/\.0$/,'')+'%';
  $('zoomOut').disabled=zoom<=zoomSteps[0];
  $('zoomIn').disabled=zoom>=zoomSteps[zoomSteps.length-1];
  if(fitZoom){viewport.scrollLeft=0;viewport.scrollTop=0;}
}
function changeZoom(direction) {
  if(active!==null) return;
  const next=direction>0?zoomSteps.find(step=>step>zoom+0.00001):[...zoomSteps].reverse().find(step=>step<zoom-0.00001);
  if(next===undefined) return;
  const centerX=(viewport.scrollLeft+viewport.clientWidth/2)/zoom;
  const centerY=(viewport.scrollTop+viewport.clientHeight/2)/zoom;
  fitZoom=false;zoom=next;renderZoom();
  viewport.scrollLeft=centerX*zoom-viewport.clientWidth/2;
  viewport.scrollTop=centerY*zoom-viewport.clientHeight/2;
}
$('zoomOut').onclick=()=>changeZoom(-1);
$('zoomIn').onclick=()=>changeZoom(1);
$('zoomFit').onclick=()=>{if(active!==null)return;fitZoom=true;renderZoom();};
new ResizeObserver(()=>{if(fitZoom)renderZoom();}).observe(viewport);
renderZoom();
const snapshot = () => ctx.getImageData(0, 0, 1024, 1024);
function historyButtons() {
  $('undo').disabled = !undo.length || active !== null;
  $('redo').disabled = !redo.length || active !== null;
}
function travel(from, to) {
  if (active !== null || !from.length) return;
  to.push(snapshot());
  ctx.putImageData(from.pop(), 0, 0);
  historyButtons();
}
function setTool(value) {
  if (active !== null) return;
  tool = value;
  document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === tool));
}
function hexToHsv(hex) {
  const [r,g,b]=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255);
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=0;
  if(d)h=(max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4)*60;
  return [h,max?d/max*100:0,max*100];
}
function hsvToHex(h,s,v) {
  h=((h%360)+360)%360;s=clamp(s)/100;v=clamp(v)/100;
  return '#'+[5,3,1].map(n=>{const k=(n+h/60)%6;return Math.round(255*v*(1-s*Math.max(0,Math.min(k,4-k,1)))).toString(16).padStart(2,'0');}).join('');
}
function renderStacks() {
  $('stacks').replaceChildren();
  stacks.forEach((colors, i) => {
    const row = document.createElement('div'); row.className = 'stack';
    row.innerHTML = `<div class="stack-title"><span>SET ${String(i+1).padStart(2,'0')}</span><button class="remove" aria-label="色セット${i+1}を削除" ${stacks.length===1?'disabled':''}>×</button></div><div class="swatches"></div><div class="labels"><span>濃い影</span><span>影</span><span>ベース</span><span>ハイライト</span><span>明るいハイライト</span></div>`;
    row.querySelector('.remove').onclick = () => {
      if (stacks.length===1) return;
      stacks.splice(i,1); ramps.splice(i,1); baseColors.splice(i,1);
      selected[0] = selected[0] === i ? Math.max(0,i-1) : selected[0] > i ? selected[0]-1 : selected[0];
      selectColor(...selected);
    };
    colors.forEach((color,j) => {
      const button = document.createElement('button'); button.className = 'swatch';
      button.style.background = color; button.title = `${roles[j]} ${color}`;
      button.setAttribute('aria-label', `セット${i+1} ${roles[j]} ${color}`);
      button.setAttribute('aria-pressed', selected[0]===i && selected[1]===j);
      button.onclick = () => selectColor(i,j);
      row.querySelector('.swatches').append(button);
    });
    $('stacks').append(row);
  });
}
function updateSliders() {
  const h=+$('h').value,s=+$('s').value,v=+$('v').value;
  $('hValue').textContent=h+'°';$('sValue').textContent=s+'%';$('vValue').textContent=v+'%';
  $('v').style.background='linear-gradient(to right,#000,'+hsvToHex(h,s,100)+')';
  $('s').style.background='linear-gradient(to right,'+hsvToHex(h,0,v)+','+hsvToHex(h,100,v)+')';
}
function showColor(syncSliders=true) {
  const base=baseColors[selected[0]];
  $('preview').style.background=ink;$('hex').textContent=ink.toUpperCase();$('color').value=base;
  $('role').textContent=roles[selected[1]];
  if(syncSliders){const [h,s,v]=hexToHsv(base);$('h').value=Math.round(h);$('s').value=Math.round(s);$('v').value=Math.round(v);}
  for(const [key,,,,,unit] of rampFields){$(key).value=sliderValue(key,ramps[selected[0]][key]);$(key+'Value').textContent=sliderLabel(key,+$(key).value,unit);}
  updateSliders();renderStacks();
}
function selectColor(i,j){selected=[i,j];ink=stacks[i][j];showColor();}
function editBase(color,syncSliders=true){
  baseColors[selected[0]]=color;regenerate(selected[0]);selected[1]=2;ink=stacks[selected[0]][2];showColor(syncSliders);
}
for(const id of ['h','s','v'])$(id).oninput=()=>editBase(hsvToHex(+$('h').value,+$('s').value,+$('v').value),false);
$('color').oninput=e=>editBase(e.target.value);
for(const [key,label,min,max,value,unit] of rampFields){
  const wrapper=document.createElement('label');
  wrapper.innerHTML=label+' <output id="'+key+'Value"></output><input id="'+key+'" type="range" min="'+Math.min(sliderValue(key,min),sliderValue(key,max))+'" max="'+Math.max(sliderValue(key,min),sliderValue(key,max))+'" value="'+sliderValue(key,value)+'">';
  $(key.startsWith('shadow') ? 'shadowControls' : 'highlightControls').append(wrapper);
  $(key).oninput=()=>{
    const value=rampValue(key,+$(key).value);
    ramps.forEach((ramp,i)=>{
      if(!$('applyAllSets').checked && i!==selected[0]) return;
      ramp[key]=value;regenerate(i);
    });
    ink=stacks[selected[0]][selected[1]];showColor(false);
  };
}
$('add').onclick=()=>{stacks.push([...stacks[selected[0]]]);ramps.push({...ramps[selected[0]]});baseColors.push(baseColors[selected[0]]);selectColor(stacks.length-1,2);};
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
for (const name of ['pen','eraser']) $(name+'Size').oninput = e => {
  sizes[name]=+e.target.value; $(name+'SizeValue').textContent=sizes[name]+' px';
};
$('undo').onclick = () => travel(undo,redo); $('redo').onclick = () => travel(redo,undo);
function point(e) { const r=canvas.getBoundingClientRect(); return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}; }
function sample(p) {
  const [r,g,b,a]=ctx.getImageData(Math.max(0,Math.min(1023,Math.floor(p.x))), Math.max(0,Math.min(1023,Math.floor(p.y))),1,1).data;
  ink='#'+[r,g,b].map(c=>Math.round(c*a/255+255-a).toString(16).padStart(2,'0')).join('');
  $('preview').style.background=ink; $('hex').textContent=ink.toUpperCase(); $('role').textContent='スポイト';

}
function draw(p, first = false) {
  const target=active.tool==='pen'?strokeCtx:ctx;
  target.globalCompositeOperation=active.tool==='eraser'?'destination-out':'source-over';
  target.fillStyle=active.ink;target.strokeStyle=active.ink;target.lineWidth=active.size;target.lineCap='round';target.lineJoin='round';
  target.beginPath();
  if(first){target.arc(p.x,p.y,active.size/2,0,Math.PI*2);target.fill();}
  else{target.moveTo(active.last.x,active.last.y);target.lineTo(p.x,p.y);target.stroke();}
  if(active.tool==='pen'){
    ctx.putImageData(active.before,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.globalAlpha=active.opacity/100;
    ctx.drawImage(strokeCanvas,0,0);
    ctx.globalAlpha=1;
  }
  active.last=p;
}
canvas.addEventListener('pointerdown', e => {
  if (active !== null || e.button!==0) return;
  e.preventDefault(); const p=point(e);
  if (tool==='picker' || e.altKey) {sample(p);return;}
  active={id:e.pointerId,before:snapshot(),last:p,tool,size:sizes[tool],ink,opacity:penOpacity};
  if(tool==='pen')strokeCtx.clearRect(0,0,1024,1024);
  canvas.setPointerCapture(e.pointerId); draw(p,true); historyButtons();
});
canvas.addEventListener('pointermove', e => {
  if (!active || active.id!==e.pointerId) return;
  for (const event of e.getCoalescedEvents?.() || [e]) draw(point(event));
});
function finish(e, cancel=false) {
  if (!active || active.id!==e.pointerId) return;
  if(cancel) ctx.putImageData(active.before,0,0);
  else {draw(point(e)); undo.push(active.before); if(undo.length>10) undo.shift(); redo.length=0;}
  active=null; ctx.globalCompositeOperation='source-over'; historyButtons(); if(fitZoom)renderZoom();
  if(canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
}
canvas.addEventListener('pointerup', e=>finish(e));
canvas.addEventListener('pointercancel', e=>finish(e,true));
canvas.addEventListener('lostpointercapture', e=>finish(e,true));
canvas.addEventListener('contextmenu',e=>e.preventDefault());
function canvasFilename(now=new Date()) {
  const animals=['cat','dog','fox','wolf','bear','panda','otter','rabbit','deer','tiger','lion','koala','owl','eagle','penguin','dolphin','whale','seal','horse','squirrel'];
  const pad=value=>String(value).padStart(2,'0');
  const date=String(now.getFullYear()).padStart(4,'0')+pad(now.getMonth()+1)+pad(now.getDate());
  const time=pad(now.getHours())+pad(now.getMinutes());
  const animal=animals[Math.floor(Math.random()*animals.length)];
  return date+'-'+time+'-'+animal+'.png';
}
$('export').onclick = () => {
  const filename=canvasFilename();
  const output=document.createElement('canvas'); output.width=output.height=1024;
  const c=output.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,1024,1024); c.drawImage(canvas,0,0);
  output.toBlob(blob=>{ if(!blob) return; const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); },'image/png');
};
document.addEventListener('keydown', e=>{
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.isComposing || active) return;
  const key=e.key.toLowerCase();
  if((e.ctrlKey||e.metaKey)&&key==='z'){e.preventDefault(); e.shiftKey?travel(redo,undo):travel(undo,redo);}
  else if((e.ctrlKey||e.metaKey)&&key==='y'){e.preventDefault(); travel(redo,undo);}
  else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&{b:1,e:1,i:1}[key])setTool({b:'pen',e:'eraser',i:'picker'}[key]);
});
selectColor(...selected); setTool('pen'); historyButtons();

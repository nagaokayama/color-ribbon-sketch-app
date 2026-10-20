// State-level checks; browser rendering and pointer delivery require browser QA.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Element {
  constructor(){ this.style={}; this.value='0'; this.children=[]; this.handlers={}; }
  setAttribute(){} append(e){this.children.push(e)} replaceChildren(){this.children=[]}
  querySelector(){return new Element()}
  addEventListener(k,f){this.handlers[k]=f}
}
let pixels=0,restoreCount=0,compositeCount=0;
const strokeContext={clearRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){}};
const context={getImageData:()=>({value:pixels,data:[0,0,0,0]}),putImageData(d){restoreCount++;pixels=d.value},drawImage(){compositeCount++;pixels++},beginPath(){},arc(){},fill(){pixels++},stroke(){pixels++},moveTo(){},lineTo(){}};
const elements=new Map();
const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
Object.assign(get('canvas'),{getContext:()=>context,width:1024,height:1024,getBoundingClientRect:()=>({left:0,top:0,width:512,height:512}),setPointerCapture(){},hasPointerCapture:()=>false});
Object.assign(get('viewport'),{clientWidth:544,clientHeight:800,scrollLeft:0,scrollTop:0});
const sandbox={ResizeObserver:class {observe(){}},document:{getElementById:get,querySelectorAll:()=>[],createElement:tag=>tag==='canvas'?Object.assign(new Element(),{getContext:()=>strokeContext}):new Element(),addEventListener(){}},setTimeout,URL,console};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('dist/app.js','utf8'),sandbox);
function run(s){return vm.runInContext(s,sandbox)}
function event(id){return {pointerId:id,button:0,clientX:20,clientY:20,preventDefault(){}}}
const c=get('canvas');
// Fit uses both dimensions; zoom changes only the display and keeps bitmap/history intact.
assert.equal(run('zoom'),0.5);
const zoomPixels=pixels;
get('zoomIn').onclick();assert.equal(run('zoom'),0.75);
get('zoomOut').onclick();assert.equal(run('zoom'),0.5);
get('viewport').clientHeight=288;
get('zoomFit').onclick();assert.equal(run('zoom'),0.25);
assert.equal(get('canvas').style.width,'256px');
assert.equal(get('canvas').width,1024);assert.equal(pixels,zoomPixels);
get('viewport').clientHeight=800;get('zoomFit').onclick();
for(let i=0;i<12;i++){c.handlers.pointerdown(event(i));c.handlers.pointerup(event(i))}
assert.equal(run('undo.length'),10);
const finished=pixels;
for(let i=0;i<10;i++)run('travel(undo,redo)');
assert.equal(run('undo.length'),0);assert.equal(run('redo.length'),10);
const oldest=pixels;run('travel(undo,redo)');assert.equal(pixels,oldest);
for(let i=0;i<10;i++)run('travel(redo,undo)');assert.equal(pixels,finished);
run('travel(undo,redo)');c.handlers.pointerdown(event(40));c.handlers.pointerup(event(40));assert.equal(run('redo.length'),0);
const beforeCancel=pixels;c.handlers.pointerdown(event(50));c.handlers.pointercancel(event(50));assert.equal(pixels,beforeCancel);
assert.equal(run('active'),null);
assert.equal(run("hsvToHex(0,100,100)"),'#ff0000');
assert.equal(run("hsvToHex(120,100,100)"),'#00ff00');
assert.equal(run("hsvToHex(240,100,100)"),'#0000ff');
assert.equal(run("hsvToHex(0,0,100)"),'#ffffff');
for(const hex of ['#df9e87','#304a49','#000000','#ffffff'])assert.equal(run(`hsvToHex(...(()=>{const [h,s,l]=hexToHsv('${hex}');return [h,s,l]})())`),hex);
run("editBase('#123456')");assert.equal(run('stacks[0][2]'),'#123456');
run('sample({x:1,y:1})');assert.equal(run('ink'),'#ffffff');
run("setTool('picker')");
const beforePick=pixels;
c.handlers.pointerdown(event(60));c.handlers.pointerdown(event(61));
assert.equal(run('tool'),'picker');assert.equal(run('active'),null);assert.equal(pixels,beforePick);
run("setTool('eraser')");assert.equal(run('tool'),'eraser');
run('selectColor(0,0)');
const base=run('stacks[0][2]');
run('ramps[0].shadowDepth=90; regenerate(0)');
assert.equal(run('stacks[0][2]'),base);
assert.equal(run('stacks[0].length'),5);
assert.ok(run('hexToOklab(stacks[0][0])[0] < hexToOklab(stacks[0][2])[0]'));
const paletteBefore=run('JSON.stringify(stacks)');run('sample({x:1,y:1})');assert.equal(run('JSON.stringify(stacks)'),paletteBefore);
console.log('PASS: 10-stroke limit, undo/redo, redo branching, canceled stroke, HSV round trips and ramp invariants, palette edit, transparent sampling');

assert.equal(run('point({clientX:256,clientY:128}).x'),512);
assert.equal(run('point({clientX:256,clientY:128}).y'),256);
get('penSize').oninput({target:{value:'9'}});
get('eraserSize').oninput({target:{value:'42'}});
run("setTool('pen')");c.handlers.pointerdown(event(70));assert.equal(run('active.size'),9);c.handlers.pointerup(event(70));
run("setTool('eraser')");c.handlers.pointerdown(event(71));assert.equal(run('active.size'),42);c.handlers.pointerup(event(71));
console.log('PASS: scaled canvas coordinates and independent pen/eraser sizes');

// Opacity is fixed for each pen stroke, composited once, and reset for erasing.
get('penOpacity').oninput({target:{value:'35'}});
run("setTool('pen')");c.handlers.pointerdown(event(80));
assert.equal(run('active.opacity'),35);assert.equal(context.globalAlpha,1);
get('penOpacity').oninput({target:{value:'0'}});
assert.equal(run('active.opacity'),35);
c.handlers.pointerup(event(80));
c.handlers.pointerdown(event(81));assert.equal(run('active.opacity'),0);c.handlers.pointerup(event(81));
run("setTool('eraser')");c.handlers.pointerdown(event(82));
assert.equal(context.globalCompositeOperation,'destination-out');assert.equal(context.globalAlpha,1);
c.handlers.pointerup(event(82));
console.log('PASS: pen opacity capture, zero opacity and eraser alpha isolation');
// Opaque strokes bypass compositing; translucent strokes keep the existing path.
run("setTool('pen')");get('penOpacity').oninput({target:{value:'100'}});
const opaqueRestores=restoreCount,opaqueComposites=compositeCount;
c.handlers.pointerdown(event(83));
c.handlers.pointermove({...event(83),clientX:40,clientY:40});
c.handlers.pointerup({...event(83),clientX:50,clientY:50});
assert.equal(restoreCount,opaqueRestores);assert.equal(compositeCount,opaqueComposites);
get('penOpacity').oninput({target:{value:'50'}});
const translucentRestores=restoreCount,translucentComposites=compositeCount;
c.handlers.pointerdown(event(84));
c.handlers.pointermove({...event(84),clientX:40,clientY:40});
c.handlers.pointerup({...event(84),clientX:50,clientY:50});
assert.equal(restoreCount-translucentRestores,3);assert.equal(compositeCount-translucentComposites,3);
const opaqueBeforeCancel=pixels;
get('penOpacity').oninput({target:{value:'100'}});
c.handlers.pointerdown(event(85));c.handlers.pointercancel(event(85));
assert.equal(pixels,opaqueBeforeCancel);
console.log('PASS: opaque pen bypasses restore/composite, translucent path retained, opaque cancel restored');
// Shadow and highlight saturation remain independent of the base color.
run("selectColor(0,2); editBase('#c08040')");
run('ramps[0].shadowSat=70; ramps[0].highlightSat=70; regenerate(0)');
assert.equal(run('stacks[0][2]'),'#c08040');
assert.ok(run('Math.abs(hexToOklab(stacks[0][0])[0]-hexToOklab(baseColors[0])[0]*(1-ramps[0].shadowDepth/100))<0.003'));
assert.ok(run('Math.abs(hexToOklab(stacks[0][4])[0]-(hexToOklab(baseColors[0])[0]+(1-hexToOklab(baseColors[0])[0])*ramps[0].highlight/100))<0.003'));
get('add').onclick();
assert.equal(run('baseColors[3]'),run('baseColors[0]'));
const duplicatedPalette=run('JSON.stringify(stacks[3])');
run('regenerate(3)');assert.equal(run('JSON.stringify(stacks[3])'),duplicatedPalette);
console.log('PASS: independent endpoint saturation, unchanged base and duplicated palette');

// Verify slider bounds and direction before saving the test palette.
assert.equal(run("sliderValue('shadowSat',70)"),70);
assert.equal(run("rampValue('highlightSat',30)"),30);
assert.equal(run("sliderLabel('shadowSat',15,'%')"),'15%');
get('shadowDepth').value='0';get('shadowDepth').oninput();
const darkShadow=run('hexToHsv(stacks[selected[0]][0])[2]');
get('shadowDepth').value='100';get('shadowDepth').oninput();
assert.ok(run('hexToHsv(stacks[selected[0]][0])[2]')>darkShadow);
assert.equal(run('ramps[selected[0]].shadowDepth'),0);
// Bulk edits affect only the manipulated field; unchecked edits remain local.
const basesBeforeBulk=run('JSON.stringify(baseColors)');
const otherSettings=run('JSON.stringify(ramps.map(({lightHue,...rest})=>rest))');
get('applyAllSets').checked=true;
get('lightHue').value='30';get('lightHue').oninput();
assert.ok(run('ramps.every(r=>r.lightHue===30)'));
assert.equal(run('JSON.stringify(baseColors)'),basesBeforeBulk);
assert.equal(run('JSON.stringify(ramps.map(({lightHue,...rest})=>rest))'),otherSettings);
assert.equal(run('ink'),run('stacks[selected[0]][selected[1]]'));
get('shadowSat').value='70';get('shadowSat').oninput();
assert.ok(run('ramps.every(r=>r.shadowSat===70)'));
get('shadowDepth').value='25';get('shadowDepth').oninput();
assert.ok(run('ramps.every(r=>r.shadowDepth===75)'));
get('applyAllSets').checked=false;
get('lightHue').value='-30';get('lightHue').oninput();
assert.equal(run('ramps[selected[0]].lightHue'),-30);
assert.ok(run('ramps.every((r,i)=>i===selected[0] || r.lightHue===30)'));
console.log('PASS: bulk field edits, saturation/depth conversion, independent bases and single-set mode');
// Highlight saturation directly sets HSV S.
get('highlightSat').value='0';get('highlightSat').oninput();
assert.equal(run('hexToHsv(stacks[selected[0]][4])[1]'),0);
get('highlightSat').value='100';get('highlightSat').oninput();
assert.ok(run('hexToHsv(stacks[selected[0]][4])[1]>0'));
// Published Oklab reference for red, neutral midpoint and sRGB round trips.
const redLab=run("hexToOklab('#ff0000')");
assert.ok(Math.abs(redLab[0]-0.62795536)<1e-6);
assert.ok(Math.abs(redLab[1]-0.22486306)<1e-6);
assert.ok(Math.abs(redLab[2]-0.12584630)<1e-6);
for(const color of ['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#df9e87'])
  assert.equal(run(`oklabToHex(hexToOklab('${color}'))`),color);
assert.equal(run("oklabMidpoint('#000000','#ffffff')"),'#636363');
for(const [from,to] of [['#714d51','#df9e87'],['#df9e87','#f4b6b5'],['#000000','#ffffff'],['#0000ff','#ffff00']]){
  sandbox.from=from;sandbox.to=to;
  assert.ok(run(`(()=>{
    const a=hexToOklab(from),b=hexToOklab(to),m=hexToOklab(oklabMidpoint(from,to));
    const distance=(x,y)=>Math.hypot(...x.map((value,i)=>value-y[i]));
    return Math.abs(distance(a,m)-distance(m,b))<0.005;
  })()`));
}
get('shadowSat').value='0';get('shadowSat').oninput();
assert.equal(run('hexToHsv(stacks[selected[0]][0])[1]'),0);
get('shadowSat').value='100';get('shadowSat').oninput();
assert.ok(run('hexToHsv(stacks[selected[0]][0])[1]>0'));
assert.equal(run('stacks[selected[0]][2]'),run('baseColors[selected[0]]'));
console.log('PASS: Oklab reference, round trips, perceptual midpoints and absolute shadow saturation');
// Perceptual lightness stays stable while color direction and saturation vary.
for(const hue of [0,60,120,180,240,300]){
  for(const saturation of [0,30,70,100]){
    for(const lightness of [0.1,0.4,0.75,0.95]){
      sandbox.testColor={hue,saturation,lightness};
      assert.ok(run('Math.abs(hexToOklab(colorAtLightness(testColor.hue,testColor.saturation,testColor.lightness))[0]-testColor.lightness)<0.005'),JSON.stringify({hue,saturation,lightness,actual:run('hexToOklab(colorAtLightness(testColor.hue,testColor.saturation,testColor.lightness))[0]')}));
    }
  }
}
for(const base of ['#df9e87','#00ff00','#0000ff','#ff0000','#000000','#ffffff']){
  sandbox.testBase=base;run('editBase(testBase);ramps[selected[0]].shadowDepth=45;ramps[selected[0]].highlight=65;regenerate(selected[0])');
  const levels=run('stacks[selected[0]].map(color=>hexToOklab(color)[0])');
  for(let i=1;i<5;i++)assert.ok(levels[i]>=levels[i-1]-0.003);
  assert.ok(Math.abs(levels[1]-(levels[0]+levels[2])/2)<0.003);
  assert.ok(Math.abs(levels[3]-(levels[2]+levels[4])/2)<0.003);
  assert.equal(run('stacks[selected[0]][2]'),base);
}
assert.equal(run('colorAtLightness(45,100,0)'),'#000000');
assert.equal(run('colorAtLightness(240,100,1)'),'#ffffff');
console.log('PASS: lightness stability across hue/saturation, monotonic ramps, equal L midpoints, black and white limits');

// Names follow their sets through additions and deletions; deleting the final set is blocked.
assert.equal(run('setNames.length'),run('stacks.length'));
assert.equal(run("renameSet(0,'  skin <tone>  ')"),true);
assert.equal(run('setNames[0]'),'skin <tone>');
assert.equal(run("renameSet(0,'   ')"),false);
assert.equal(run('setNames[0]'),'skin <tone>');
run('selectColor(1,4)');
const selectedBaseBeforeDelete=run('baseColors[1]');
const selectedNameBeforeDelete=run('setNames[1]');
run('removeSet(0)');
assert.equal(run('selected[0]'),0);
assert.equal(run('baseColors[selected[0]]'),selectedBaseBeforeDelete);
assert.equal(run('setNames[selected[0]]'),selectedNameBeforeDelete);
get('add').onclick();
assert.equal(run('setNames.length'),run('stacks.length'));
assert.ok(run('new Set(setNames).size===setNames.length'));
while(run('stacks.length')>1)run('removeSet(0)');
run('removeSet(0)');
assert.equal(run('stacks.length'),1);
assert.equal(run('setNames.length'),1);
assert.equal(run('baseColors.length'),1);assert.equal(run('ramps.length'),1);
console.log('PASS: rename validation, set/name alignment, selection preservation, unique new names and final-set protection');

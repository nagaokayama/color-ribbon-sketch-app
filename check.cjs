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
let pixels=0;
const strokeContext={clearRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){}};
const context={getImageData:()=>({value:pixels,data:[0,0,0,0]}),putImageData:d=>pixels=d.value,drawImage(){pixels++},beginPath(){},arc(){},fill(){pixels++},stroke(){pixels++},moveTo(){},lineTo(){}};
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
assert.ok(run('hexToHsv(stacks[0][0])[2] < hexToHsv(stacks[0][2])[2]'));
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
// Shadow and highlight saturation remain independent of the base color.
run("selectColor(0,2); editBase('#c08040')");
run('ramps[0].shadowSat=70; ramps[0].highlightSat=70; regenerate(0)');
assert.equal(run('stacks[0][2]'),'#c08040');
assert.ok(run('Math.abs(hexToHsv(stacks[0][0])[1]-hexToHsv(baseColors[0])[1]*0.7)<1'));
assert.ok(run('Math.abs(hexToHsv(stacks[0][4])[1]-70)<1'));
get('add').onclick();
assert.equal(run('baseColors[3]'),run('baseColors[0]'));
const duplicatedPalette=run('JSON.stringify(stacks[3])');
run('regenerate(3)');assert.equal(run('JSON.stringify(stacks[3])'),duplicatedPalette);
console.log('PASS: independent endpoint saturation, unchanged base and duplicated palette');

// Verify slider bounds and direction before saving the test palette.
assert.equal(run("sliderValue('shadowSat',70)"),-30);
assert.equal(run("rampValue('highlightSat',30)"),30);
assert.equal(run("sliderLabel('shadowSat',15,'%')"),'+15%');
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
get('shadowSat').value='-30';get('shadowSat').oninput();
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
assert.equal(run('hexToHsv(stacks[selected[0]][4])[1]'),100);
// Old multiplier-based files migrate to absolute highlight saturation.
const beforeMigration=run('serializePalette()');
const legacy=JSON.parse(beforeMigration);legacy.version=1;
legacy.sets.forEach(set=>set.ramp.highlightSat=70);
sandbox.legacyText=JSON.stringify(legacy);
run('loadPalette(legacyText)');
assert.ok(run('ramps.every((r,i)=>r.highlightSat===Math.round(clamp(hexToHsv(baseColors[i])[1]*0.7)))'));
sandbox.restoreText=beforeMigration;run('loadPalette(restoreText)');
assert.equal(run('serializePalette()'),beforeMigration);
// Round trips preserve all palette sources and generated colors, without touching ink history.
const savedPalette=run('serializePalette()');
const savedColors=run('JSON.stringify(stacks)');
const historyBeforeLoad=run('JSON.stringify([undo,redo])');
const pixelsBeforeLoad=pixels;
run("editBase('#abcdef')");
sandbox.paletteText=savedPalette;
run('loadPalette(paletteText)');
assert.equal(run('serializePalette()'),savedPalette);
assert.equal(run('JSON.stringify(stacks)'),savedColors);
assert.equal(run('JSON.stringify(selected)'),'[0,2]');
assert.equal(pixels,pixelsBeforeLoad);
assert.equal(run('JSON.stringify([undo,redo])'),historyBeforeLoad);
for(const mutate of [
  ()=>'{',
  data=>{data.version=3;return JSON.stringify(data)},
  data=>{data.sets=[];return JSON.stringify(data)},
  data=>{data.sets[1].base='red';return JSON.stringify(data)},
  data=>{data.sets[1].ramp.shadowDepth=101;return JSON.stringify(data)},
  data=>{data.sets[1].ramp.lightHue=31;return JSON.stringify(data)},
  data=>{data.sets[1].ramp.shadowSat=69;return JSON.stringify(data)},
  data=>{delete data.sets[1].ramp.lightHue;return JSON.stringify(data)}
]){
  sandbox.paletteText=mutate(JSON.parse(savedPalette));
  assert.throws(()=>run('loadPalette(paletteText)'));
  assert.equal(run('serializePalette()'),savedPalette);
  assert.equal(run('JSON.stringify(stacks)'),savedColors);
}
console.log('PASS: palette JSON round trip, invalid files preserve state, canvas and history unchanged');

(async()=>{
  const input=get('paletteFile');
  input.files=[{size:savedPalette.length,text:async()=>savedPalette}];
  await input.onchange({target:input});
  assert.equal(run('serializePalette()'),savedPalette);
  assert.equal(input.value,'');assert.equal(get('loadPalette').disabled,false);
  assert.match(get('paletteStatus').textContent,/セットを読み込みました/);
  input.files=[{size:1,text:async()=>'{'}];
  await input.onchange({target:input});
  assert.match(get('paletteStatus').textContent,/読み込めませんでした/);
  assert.equal(run('serializePalette()'),savedPalette);
  input.files=[{size:1024*1024+1,text:async()=>{throw new Error('Must not read oversized file')}}];
  await input.onchange({target:input});
  assert.match(get('paletteStatus').textContent,/1MB以下/);
  assert.equal(run('serializePalette()'),savedPalette);
  console.log('PASS: file input loading, error messages, size limit and input reset');
})().catch(error=>{console.error(error);process.exitCode=1});

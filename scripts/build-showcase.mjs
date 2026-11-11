import {createServer} from 'vite';
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const dest='media/showcase';
await mkdir(dest+'/assets',{recursive:true});
await mkdir('media/renders',{recursive:true});
const vite=await createServer({server:{middlewareMode:true}});
try {
 const {assets}=await vite.ssrLoadModule('/media/showcase-ui.tsx');
 const ui=assets();
 let html=await readFile('media/showcase-template.html','utf8');
 let instance=0;
 for(const [name,markup]of Object.entries(ui))html=html.replaceAll(`<!-- UI:${name} -->`,()=>{
   const prefix=`demo-${instance++}-`;
   return markup.replace(/id="([^"]+)"/g,(_,id)=>`id="${prefix}${id}"`).replace(/url\(#([^)]+)\)/g,(_,id)=>`url(#${prefix}${id})`);
 });
 await writeFile(dest+'/index.html',html);
} finally {await vite.close();}
const {build}=createRequire(import.meta.resolve('vite'))('esbuild');
await build({stdin:{contents:"export {liquidCompactFrame} from './src/utils/liquid-island';export {eqCurvePath} from './src/utils/equalizer';",resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'IslaGeometry',outfile:dest+'/assets/production-geometry.js'});
const css=(await readdir('dist/assets')).find(f=>f.endsWith('.css'));
let appCss=await readFile('dist/assets/'+css,'utf8');
appCss=appCss.replace(/font-family:[^;}]+/g,'font-family:Inter,sans-serif').replace(/--font-(?:sans|mono):[^;}]+/g,'--font-sans:Inter,sans-serif').replace(/transition(?:-[a-z-]+)?:[^;}]+;?/g,'');
await writeFile(dest+'/assets/app.css',appCss);
await copyFile('node_modules/motion/dist/motion.js',dest+'/assets/motion.min.js');
await copyFile('node_modules/gsap/dist/gsap.min.js',dest+'/assets/gsap.min.js');
await copyFile('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2',dest+'/assets/inter-regular.woff2');
await copyFile('node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2',dest+'/assets/inter-semibold.woff2');
await copyFile('node_modules/@fontsource/inter/LICENSE',dest+'/assets/INTER-LICENSE.txt');
await copyFile('src-tauri/icons/512x512.png',dest+'/assets/isla.png');
// Original, deterministic ambient score. No samples, copyrighted songs or external audio.
const rate=48000,seconds=24,pcm=Buffer.alloc(rate*seconds*2);
for(let i=0;i<rate*seconds;i++){
 const t=i/rate,beat=t%0.625,bar=Math.floor(t/2.5)%4;
 const chord=[[130.8128,164.8138,195.9977],[110,130.8128,164.8138],[87.3071,110,130.8128],[97.9989,123.4708,146.8324]][bar];
 const fade=Math.min(1,t/1.5,(seconds-t)/2);
 let v=chord.reduce((sum,f)=>sum+Math.sin(t*f*2*Math.PI)*.024,0)*fade;
 v+=Math.sin(2*Math.PI*(48*t+2*(1-Math.exp(-beat*18))))*Math.exp(-beat*22)*.10*fade;
 const onset=t%2.5;v+=Math.sin(t*880*2*Math.PI)*Math.exp(-onset*10)*.012*fade;
 pcm.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(v*32767))),i*2);
}
const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
await writeFile(dest+'/assets/isla-original-score.wav',Buffer.concat([header,pcm]));
console.log('Built showcase from production React components + Motion; 24 seconds, 1920×1080.');


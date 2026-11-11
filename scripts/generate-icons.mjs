import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Package the selected imagegen master, preserving its alpha and artwork.
const scripts = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(scripts,'../src-tauri/icons');
const resized = spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(scripts,'generate-icons.ps1')],{stdio:'inherit',windowsHide:true});
if(resized.status !== 0) throw new Error('Icon conversion failed');
const sizes=[16,20,24,32,40,48,64,96,128,256];
const frames=sizes.map(size=>({size,png:fs.readFileSync(path.join(outDir,size+'x'+size+'.png'))}));
const header=Buffer.alloc(6);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);
let offset=6+16*frames.length;
const directory=frames.map(({size,png})=>{
  const entry=Buffer.alloc(16);entry[0]=size===256?0:size;entry[1]=entry[0];
  entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(png.length,8);entry.writeUInt32LE(offset,12);offset+=png.length;
  return entry;
});
fs.writeFileSync(path.join(outDir,'icon.ico'),Buffer.concat([header,...directory,...frames.map(f=>f.png)]));
fs.copyFileSync(path.join(outDir,'256x256.png'),path.join(outDir,'icon.png'));
fs.copyFileSync(path.join(outDir,'256x256.png'),path.join(outDir,'128x128@2x.png'));
fs.copyFileSync(path.join(outDir,'512x512.png'),path.join(outDir,'icon-preview.png'));
console.log('Packaged imagegen Isla master into ten native ICO sizes and PNG assets.');

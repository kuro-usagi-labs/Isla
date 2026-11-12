import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync,rmSync,mkdirSync,statSync} from 'node:fs';
import path from 'node:path';
const exe=path.resolve('src-tauri/target/x86_64-pc-windows-gnu/release/isla.exe');
if(!readFileSync(exe).includes(Buffer.from('ISLA_INPUT_AUDIT_REPORT')))throw Error('Build with --features tauri/custom-protocol,input-audit first; refusing to launch a production app');
const report=path.resolve('.codex-backups/native-input-audit.json');
mkdirSync(path.dirname(report),{recursive:true});
rmSync(report,{force:true});
const launcher=path.resolve('.codex-backups/native-input-audit-launcher.exe');
const launcherSource=path.resolve('scripts/native-input-audit-launcher.rs');
if(!existsSync(launcher)||statSync(launcher).mtimeMs<statSync(launcherSource).mtimeMs){
  const build=spawnSync('rustc',['--edition','2021',launcherSource,'-o',launcher],{encoding:'utf8',windowsHide:true});
  if(build.status!==0)throw Error('Cannot build the private audit launcher: '+build.stderr);
}
const result=spawnSync(launcher,[exe],{timeout:60000,windowsHide:true,encoding:'utf8',env:{...process.env,ISLA_INPUT_AUDIT_REPORT:report,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:process.env.ISLA_TEST_BROWSER_ARGS||''}});
if(result.error)throw result.error;
if(!existsSync(report))throw Error('Native audit did not produce a report: '+result.status);
const data=JSON.parse(readFileSync(report,'utf8'));console.log(JSON.stringify(process.env.ISLA_AUDIT_COMPACT?{passed:data.passed,error:data.error,mode:process.env.ISLA_AUDIT_MODE,anchor:process.env.ISLA_AUDIT_ANCHOR,stages:data.stages.map(s=>({label:s.label,origin:s.origin,flags:s.flags,ignore:s.ignore,drag:s.drag})),events:data.events.length}:data,null,2));
if(result.status!==0||!data.passed)process.exitCode=1;

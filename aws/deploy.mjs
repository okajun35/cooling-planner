#!/usr/bin/env node
/** End-to-end AWS deploy: site build -> lambda bundles -> CDK -> Amplify zip.
 * Usage: node aws/deploy.mjs [--skip-site] [--skip-cdk]
 * State (bearer token, app id, urls) is kept in aws/deploy.local.json (gitignored). */
import {execFileSync,execSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,createWriteStream} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {crc32} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const AWS_DIR=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(AWS_DIR,'..');
const INFRA=path.join(AWS_DIR,'infra');
const DIST=path.join(AWS_DIR,'dist');
const SITE_DIR=path.join(ROOT,'dist-offline');
const STATE_FILE=path.join(AWS_DIR,'deploy.local.json');
const ARGS=new Set(process.argv.slice(2));
const log=(...a)=>console.log('[deploy]',...a);
const run=(cmd,args,opts={})=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','inherit'],...opts});
const aws=(args)=>JSON.parse(run('aws',[...args,'--output','json']));

// ---- state ---------------------------------------------------------------
const state=existsSync(STATE_FILE)?JSON.parse(readFileSync(STATE_FILE,'utf8')):{};
if(!state.mcpBearerToken){
 state.mcpBearerToken=randomBytes(24).toString('base64url');
 writeFileSync(STATE_FILE,JSON.stringify(state,null,2));
 log('generated MCP bearer token ->',STATE_FILE);
}

// ---- 1. site build --------------------------------------------------------
if(!ARGS.has('--skip-site')){
 log('npm run build (site)');
 run('npm',['run','build'],{cwd:ROOT,stdio:'inherit'});
}

// ---- 2. lambda bundles ----------------------------------------------------
mkdirSync(DIST,{recursive:true});
const esbuild=await import('esbuild');
for(const name of['mcp','api']){
 await esbuild.build({
  entryPoints:[path.join(AWS_DIR,'lambda',`${name}.ts`)],
  outfile:path.join(DIST,`${name}.mjs`),
  bundle:true,platform:'node',format:'esm',target:'node22',
  logLevel:'warning',
 });
 log('bundled',`aws/dist/${name}.mjs`);
}

// ---- 3. cdk bootstrap + deploy --------------------------------------------
if(!ARGS.has('--skip-cdk')){
 try{
  aws(['cloudformation','describe-stacks','--stack-name','CDKToolkit']);
 }catch{
  log('CDKToolkit stack not found — running cdk bootstrap');
  run('npx',['aws-cdk','bootstrap'],{cwd:INFRA,stdio:'inherit'});
 }
 log('cdk deploy');
 run('npx',['aws-cdk','deploy','--require-approval','never',
  '-c',`mcpBearerToken=${state.mcpBearerToken}`,
  '--outputs-file',path.join(AWS_DIR,'cdk-outputs.json')],{cwd:INFRA,stdio:'inherit'});
 const outputs=JSON.parse(readFileSync(path.join(AWS_DIR,'cdk-outputs.json'),'utf8')).CoolingPlanner;
 Object.assign(state,outputs);
 writeFileSync(STATE_FILE,JSON.stringify(state,null,2));
}

// ---- 4. zip dist-offline (store method) ------------------------------------
async function zipDir(dir,out){
 const entries=[];
 const walk=(d,rel)=>{for(const f of readdirSync(d)){const fp=path.join(d,f),r=rel?`${rel}/${f}`:f;
  statSync(fp).isDirectory()?walk(fp,r):entries.push({name:r,data:readFileSync(fp)});}};
 walk(dir,'');
 const chunks=[],central=[];
 let offset=0;
 for(const e of entries){
  const name=Buffer.from(e.name),crc=crc32(e.data)>>>0;
  const h=Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);// UTF-8 flag
  h.writeUInt16LE(0,8);h.writeUInt16LE(0,10);h.writeUInt16LE(0x9800,12);
  h.writeUInt32LE(crc,14);h.writeUInt32LE(e.data.length,18);h.writeUInt32LE(e.data.length,22);
  h.writeUInt16LE(name.length,26);h.writeUInt16LE(0,28);
  chunks.push(h,name,e.data);
  const c=Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x0800,8);
  c.writeUInt16LE(0,10);c.writeUInt16LE(0,12);c.writeUInt16LE(0x9800,14);
  c.writeUInt32LE(crc,16);c.writeUInt32LE(e.data.length,20);c.writeUInt32LE(e.data.length,24);
  c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
  central.push(Buffer.concat([c,name]));
  offset+=30+name.length+e.data.length;
 }
 const cd=Buffer.concat(central);
 const eocd=Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(entries.length,8);eocd.writeUInt16LE(entries.length,10);
 eocd.writeUInt32LE(cd.length,12);eocd.writeUInt32LE(offset,16);
 const ws=createWriteStream(out);
 ws.write(Buffer.concat([...chunks,cd,eocd]));
 await new Promise((res,rej)=>{ws.end(()=>res());ws.on('error',rej)});
 return entries.length;
}

if(!ARGS.has('--skip-site')){
 const zipPath=path.join(DIST,'site.zip');
 const n=await zipDir(SITE_DIR,zipPath);
 log('zipped',n,'files ->',zipPath);

 // ---- 5. amplify manual deploy ---------------------------------------------
 const appId=state.AmplifyAppId??aws(['amplify','list-apps']).apps.find(a=>a.name==='cooling-planner')?.appId;
 if(!appId)throw new Error('Amplify app id unknown — run without --skip-cdk first');
 const dep=aws(['amplify','create-deployment','--app-id',appId,'--branch-name','main']);
 const zipBuf=readFileSync(zipPath);
 const put=await fetch(dep.zipUploadUrl,{method:'PUT',headers:{'content-length':String(zipBuf.length)},body:zipBuf});
 if(!put.ok)throw new Error(`zip upload failed: ${put.status} ${await put.text()}`);
 aws(['amplify','start-deployment','--app-id',appId,'--branch-name','main','--job-id',dep.jobId]);
 log('amplify deploy started, job',dep.jobId);
 for(let i=0;i<40;i++){
  await new Promise(r=>setTimeout(r,3000));
  const job=aws(['amplify','get-job','--app-id',appId,'--branch-name','main','--job-id',dep.jobId]);
  const s=job.job.summary.status;
  if(s==='SUCCEED'){log('amplify deploy SUCCEED');break}
  if(s==='FAILED'||s==='CANCELLED')throw new Error(`amplify deploy ${s}: ${job.job.summary.statusReason??''}`);
  if(i===39)throw new Error('amplify deploy timed out');
 }
 state.AmplifyUrl=`https://main.${aws(['amplify','get-app','--app-id',appId]).app.defaultDomain}`;
 writeFileSync(STATE_FILE,JSON.stringify(state,null,2));
}

// ---- summary ----------------------------------------------------------------
console.log('\n=== deployed ===');
console.log('Site     :',state.AmplifyUrl??'(pending)');
console.log('MCP URL  :',state.McpUrl??'(pending)');
console.log('REST API :',state.ApiUrl??'(pending)');
console.log('\nMCP client config (streamable HTTP + Bearer):');
console.log(JSON.stringify({'cooling-planner-remote':{type:'http',url:state.McpUrl,headers:{Authorization:`Bearer ${state.mcpBearerToken}`}}},null,2));

#!/usr/bin/env node
/** End-to-end AWS deploy: site build -> lambda bundles -> CDK.
 * The site itself is deployed by the GitHub-connected Amplify app on push;
 * this script deploys the Lambda backend and keeps dist-offline/ fresh.
 * Usage: node aws/deploy.mjs [--skip-site] [--skip-cdk]
 * State (bearer token, urls) is kept in aws/deploy.local.json (gitignored). */
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const AWS_DIR=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(AWS_DIR,'..');
const INFRA=path.join(AWS_DIR,'infra');
const DIST=path.join(AWS_DIR,'dist');
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
if(!state.mcpDemoToken){
 state.mcpDemoToken='demo-'+randomBytes(18).toString('base64url');
 writeFileSync(STATE_FILE,JSON.stringify(state,null,2));
 log('generated MCP demo token ->',STATE_FILE);
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
  loader:{'.md':'text'},
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
  '-c',`mcpDemoToken=${state.mcpDemoToken}`,
  '--outputs-file',path.join(AWS_DIR,'cdk-outputs.json')],{cwd:INFRA,stdio:'inherit'});
 const outputs=JSON.parse(readFileSync(path.join(AWS_DIR,'cdk-outputs.json'),'utf8')).CoolingPlanner;
 Object.assign(state,outputs);
 writeFileSync(STATE_FILE,JSON.stringify(state,null,2));
}

// ---- summary ----------------------------------------------------------------
console.log('\n=== deployed ===');
console.log('Site     :',state.AmplifyUrl??'(GitHub-connected Amplify app — deploys on push to main)');
console.log('MCP URL  :',state.McpUrl??'(pending)');
console.log('REST API :',state.ApiUrl??'(pending)');
console.log('\nMCP client config (streamable HTTP + Bearer):');
console.log(JSON.stringify({'cooling-planner-remote':{type:'http',url:state.McpUrl,headers:{Authorization:`Bearer ${state.mcpBearerToken}`}}},null,2));

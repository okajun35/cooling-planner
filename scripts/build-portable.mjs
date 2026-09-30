/** Build a deterministic offline browser distribution from TypeScript output.
 * This does not pretend to be a Vite production build. No runtime CDN is used.
 */
import {readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),require=createRequire(import.meta.url);
let ts;try{ts=require('typescript')}catch{ts=require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'))}
const modules=new Map();async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())await walk(f);else if(e.name.endsWith('.js')){const id=path.relative(path.join(root,'.compiled'),f).split(path.sep).join('/'),src=(await readFile(f,'utf8')).replace(/^import\s+['"]\.\/styles\.css['"];?\s*$/m,'');modules.set(id,ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)}}}await walk(path.join(root,'.compiled'));
const threeDir=path.join(root,'node_modules/three/build');for(const [id,file]of [['three','three.module.min.js'],['three.core.min.js','three.core.min.js']]){const src=await readFile(path.join(threeDir,file),'utf8');modules.set(id,ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)}
const resolve=(id,from)=>path.posix.normalize(path.posix.join(path.posix.dirname(from),id));
function bundle(entry){const included=new Set();function visit(id){if(included.has(id))return;if(!modules.has(id))throw Error(`Missing local module ${id}`);included.add(id);for(const m of modules.get(id).matchAll(/require\(["']([^"']+)["']\)/g)){if(m[1].startsWith('.'))visit(resolve(m[1],id));else if(modules.has(m[1]))visit(m[1]);else throw Error(`Unbundled dependency ${m[1]} required by ${id}`)}}visit(entry);const payload=[...included].map(id=>`${JSON.stringify(id)}:function(require,module,exports){\n${modules.get(id)}\n}`).join(',\n');return `(()=>{'use strict';const modules={${payload}};const cache={};function resolve(id,from){if(!id.startsWith('.')){if(modules[id])return id;throw Error('Optional dependency not included in the offline distribution: '+id)}const out=[];for(const x of (from.slice(0,from.lastIndexOf('/')+1)+id).split('/')){if(x==='..')out.pop();else if(x!=='.'&&x)out.push(x)}return out.join('/')}function load(id){if(cache[id])return cache[id].exports;const fn=modules[id];if(!fn)throw Error('Missing module: '+id);const module={exports:{}};cache[id]=module;fn(s=>load(resolve(s,id)),module,module.exports);return module.exports}load(${JSON.stringify(entry)});})();`}
const worker=bundle('worker/simulation.worker.js');await mkdir(path.join(root,'public'),{recursive:true});await writeFile(path.join(root,'public/worker.js'),worker);
const out=path.join(root,'dist-offline');await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const threeLicense=await readFile(path.join(root,'node_modules/three/LICENSE'),'utf8');
const css=await readFile(path.join(root,'src/styles.css'),'utf8'),app=`/* Three.js license\n${threeLicense}\n*/\n`+bundle('main.js'),html=await readFile(path.join(root,'index.html'),'utf8');
await writeFile(path.join(out,'THREE-LICENSE.txt'),threeLicense);
await writeFile(path.join(out,'styles.css'),css);await writeFile(path.join(out,'app.js'),app);await writeFile(path.join(out,'worker.js'),worker);
await writeFile(path.join(out,'llms.txt'),await readFile(path.join(root,'llms.txt'),'utf8'));
const portable=html.replace('./src/styles.css','./styles.css').replace('<script type="module" src="./src/main.ts"></script>','<script src="./app.js"></script>');await writeFile(path.join(out,'index.html'),portable);
const script=s=>s.replace(/<\/script/gi,'<\\/script');
const standalone=portable.replace('<link rel="stylesheet" href="./styles.css">',`<style>${css}</style>`).replace('<script src="./app.js"></script>',`<script>window.__DCS_WORKER_SOURCE__=${JSON.stringify(worker).replace(/<\/script/gi,'<\\/script')};</script><script>${script(app)}</script>`);
await writeFile(path.join(root,'cooling-planner-v0.9.html'),standalone);
console.log(`Built offline HTTP distribution and standalone HTML (${Math.round(Buffer.byteLength(standalone)/1024)} KiB).`);console.log('Renderer: Three.js r180 (bundled). Runtime is self-contained; no CDN or API server.');

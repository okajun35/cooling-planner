import {parseProject} from '../domain/validation.js';
import type {ProjectStore} from '../state/store.js';

/** Kept outside layout.ts so layout work can proceed independently. The textarea
 * is not rebuilt on worker messages, preserving pasted input while calculating. */
export function openProjectImport(store:ProjectStore,onImported:()=>void){
 let dialog=document.getElementById('project-import-dialog') as HTMLDialogElement|null;
 if(!dialog){
  dialog=document.createElement('dialog');dialog.id='project-import-dialog';
  dialog.innerHTML=`<div class="dialog-head"><h2>MCP案のJSONを読込</h2><button type="button" data-close="project-import-dialog" aria-label="閉じる">×</button></div><div><p>MCPのevaluateが返したJSON全体、またはprojectのJSONを貼り付けてください。配置・気象・モデル係数・基準案をまとめて復元し、この画面で再計算します。</p><label for="project-import-text">案のJSON（最大2MiB）</label><textarea id="project-import-text" rows="10" style="width:100%;box-sizing:border-box" spellcheck="false"></textarea><p class="micro">読込は全案・共通条件を置き換えます。戻すで読込前の条件へ戻せます。受け取った計算結果は表示せず再計算します。</p><button type="button" id="project-import-apply">読み込んで再計算</button><p id="project-import-error" role="alert" hidden></p></div>`;
  document.body.append(dialog);
  const apply=dialog.querySelector<HTMLButtonElement>('#project-import-apply')!,text=dialog.querySelector<HTMLTextAreaElement>('#project-import-text')!,error=dialog.querySelector<HTMLElement>('#project-import-error')!;
  apply.addEventListener('click',()=>{
   try{
    const project=parseProject(text.value);
    // Normalize an envelope back to a plain saved Project. This also discards
    // claimed result values, hashes and explanatory text from the other client.
    store.importJSON(JSON.stringify(project));
    dialog!.close();onImported();
   }catch(e){error.textContent=e instanceof Error?e.message:String(e);error.hidden=false}
  });
  text.addEventListener('input',()=>{error.hidden=true});
 }
 const error=dialog.querySelector<HTMLElement>('#project-import-error')!;error.hidden=true;
 dialog.showModal();dialog.querySelector<HTMLTextAreaElement>('textarea')!.focus();
}

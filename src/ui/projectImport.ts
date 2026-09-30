import type {ProjectStore} from '../state/store.js';

/** Kept outside layout.ts so layout work can proceed independently. The textarea
 * is not rebuilt on worker messages, preserving pasted input while calculating. */
export function openProjectImport(store:ProjectStore,onImported:()=>void){
 let dialog=document.getElementById('project-import-dialog') as HTMLDialogElement|null;
 if(!dialog){
  dialog=document.createElement('dialog');dialog.id='project-import-dialog';
  dialog.innerHTML=`<div class="dialog-head"><h2>Import MCP scenario JSON</h2><button type="button" data-close="project-import-dialog" aria-label="Close">×</button></div><div><p>Paste the full JSON returned by MCP evaluate, or a project JSON. Layout, weather, model coefficients and the baseline are restored together and recalculated in this view.</p><label for="project-import-text">Scenario JSON (max 2MiB)</label><textarea id="project-import-text" rows="10" style="width:100%;box-sizing:border-box" spellcheck="false"></textarea><p class="micro">Importing replaces all scenarios and shared conditions. Undo returns to the pre-import state. Supplied results are not displayed — they are recomputed.</p><button type="button" id="project-import-apply">Import &amp; recalculate</button><p id="project-import-error" role="alert" hidden></p></div>`;
  document.body.append(dialog);
  const apply=dialog.querySelector<HTMLButtonElement>('#project-import-apply')!,text=dialog.querySelector<HTMLTextAreaElement>('#project-import-text')!,error=dialog.querySelector<HTMLElement>('#project-import-error')!;
  apply.addEventListener('click',()=>{
   try{
    store.importJSON(text.value);
    dialog!.close();onImported();
   }catch(e){error.textContent=e instanceof Error?e.message:String(e);error.hidden=false}
  });
  text.addEventListener('input',()=>{error.hidden=true});
 }
 const error=dialog.querySelector<HTMLElement>('#project-import-error')!;error.hidden=true;
 dialog.showModal();dialog.querySelector<HTMLTextAreaElement>('textarea')!.focus();
}

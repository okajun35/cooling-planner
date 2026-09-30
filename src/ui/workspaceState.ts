import type {PlacementKind} from '../template/placement.js';
import {PLACEMENT_HEIGHTS} from '../template/placement.js';

export type SheetTab='compare'|'areas'|'timeline'|'reference';
export type PanelKind='device'|'probe'|'devices'|'roof'|'weather';
export interface Placement{kind:PlacementKind;heightM:number;x:number|null;y:number|null;valid:boolean}
export interface Workspace{
 /** right-hand panel; null = hidden. Selection itself lives in Project.view. */
 panel:PanelKind|null;
 /** bottom results sheet tab; null = closed. */
 sheet:SheetTab|null;
 /** ghost placement in progress; never part of Project state. */
 placement:Placement|null;
 guide:{step:number;done:boolean};
}

export const createWorkspace=():Workspace=>({panel:null,sheet:null,placement:null,guide:{step:0,done:false}});

export function startPlacement(w:Workspace,kind:PlacementKind){w.placement={kind,heightM:PLACEMENT_HEIGHTS[kind],x:null,y:null,valid:false}}
export function moveCandidate(w:Workspace,x:number|null,y:number|null,valid:boolean){if(w.placement){w.placement.x=x;w.placement.y=y;w.placement.valid=valid}}
export function cancelPlacement(w:Workspace){w.placement=null}
/** Returns the pose to commit, or null while the candidate is missing/invalid. */
export function confirmCandidate(w:Workspace):{kind:PlacementKind;x:number;y:number}|null{
 const pl=w.placement;if(!pl||pl.x===null||pl.y===null||!pl.valid)return null;
 w.placement=null;return{kind:pl.kind,x:pl.x,y:pl.y};
}
/** A committed/external project change must drop any unconfirmed ghost (GUI05). */
export function notifyExternalChange(w:Workspace,_kind:'project'|'view'|'draft'){w.placement=null}

export function openPanel(w:Workspace,kind:PanelKind){w.panel=kind}
export function closePanel(w:Workspace){w.panel=null}
export function openSheet(w:Workspace,tab:SheetTab){w.sheet=tab}
export function closeSheet(w:Workspace){w.sheet=null}

export const GUIDE_STEPS=4;
export function guideAdvance(w:Workspace){if(!w.guide.done){w.guide.step++;if(w.guide.step>=GUIDE_STEPS)w.guide.done=true}}
export function guideSkip(w:Workspace){w.guide.done=true}
export function guideRestart(w:Workspace){w.guide={step:0,done:false}}

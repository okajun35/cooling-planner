import type {Project} from '../domain/project.js';
import {buildLayout} from './layout.js';

export type PlacementCheck='ok'|'outside'|'blocked';
export type PlacementKind='fan'|'soaker'|'mist';

/** Initial device heights used for the placement preview plane and the created device. */
export const PLACEMENT_HEIGHTS:Record<PlacementKind,number>={fan:3,soaker:2.5,mist:2.5};

/**
 * Click-placement validity shared by all view modes. Only existing constraints apply:
 * inside the barn floor, outside solid zones. The physics model itself decides the
 * rest — a fan parked in the feed lane stays legal here even if the sim dislikes it.
 */
export function checkPlacement(p:Project,x:number,y:number):PlacementCheck{
 if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>p.template.lengthM||y<0||y>p.template.widthM)return'outside';
 if(buildLayout(p.template).solids.some(b=>x>=b.min[0]&&x<=b.max[0]&&y>=b.min[2]&&y<=b.max[2]))return'blocked';
 return'ok';
}

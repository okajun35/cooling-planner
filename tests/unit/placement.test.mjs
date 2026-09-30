import {test} from 'node:test';import assert from 'node:assert/strict';
import {checkPlacement} from '../../.compiled/template/placement.js';
import {createProject} from '../../.compiled/data/defaults.js';

test('placement validity: inside barn ok, outside rejected, solid zones blocked',()=>{
 const p=createProject();
 assert.equal(checkPlacement(p,10,5),'ok');
 assert.equal(checkPlacement(p,0,0),'ok','barn corner is valid');
 assert.equal(checkPlacement(p,p.template.lengthM,p.template.widthM),'ok');
 assert.equal(checkPlacement(p,-1,5),'outside');
 assert.equal(checkPlacement(p,10,-0.1),'outside');
 assert.equal(checkPlacement(p,p.template.lengthM+1,5),'outside');
 assert.equal(checkPlacement(p,10,p.template.widthM+.5),'outside');
 assert.equal(checkPlacement(p,NaN,5),'outside');
 // utility building is a solid zone (x 33.4–36.4, y 8–11 at default size)
 assert.equal(checkPlacement(p,34.9,9.5),'blocked');
 // robot zone is not solid: placing there is allowed by placement rules
 assert.equal(checkPlacement(p,31.4,9.5),'ok');
});

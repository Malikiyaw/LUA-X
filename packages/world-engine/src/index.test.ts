import {describe,expect,it} from 'vitest';
import {validateWorld,worldStats,type WorldSpec} from './index.js';
const base=():WorldSpec=>({id:'map',name:'Map',assets:[],zones:[],landmarks:[],paths:[],budget:{maxInstances:10,notes:[]},streaming:{enabled:false,regions:[]},design:{paletteTokens:{},mood:'neutral',density:'balanced'}});
describe('world engine',()=>{
 it('accepts a valid world',()=>{const w=base();w.assets.push({id:'spawn',name:'Spawn',kind:'spawn',transform:{position:{x:0,y:1,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}});expect(validateWorld(w).filter(x=>x.severity==='error')).toHaveLength(0)});
 it('rejects duplicate ids and inverted bounds',()=>{const w=base();w.assets.push({id:'a',name:'A',kind:'part',transform:{position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}},{id:'a',name:'A2',kind:'decor',transform:{position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}});w.zones.push({id:'z',name:'Z',kind:'combat',bounds:{min:{x:2,y:2,z:2},max:{x:1,y:1,z:1}}});const codes=validateWorld(w).map(x=>x.code);expect(codes).toContain('DUPLICATE_ID');expect(codes).toContain('INVERTED_BOUNDS')});
 it('detects missing path references',()=>{const w=base();w.paths=[{id:'a',position:{x:0,y:0,z:0},neighbors:['missing']}];expect(validateWorld(w).some(x=>x.code==='MISSING_PATH_NODE')).toBe(true)});
 it('reports useful world stats',()=>{const w=base();w.landmarks=[{id:'l',name:'Boss',purpose:'boss arena',position:{x:0,y:0,z:0},importance:'critical'}];expect(worldStats(w).highPriorityLandmarks).toBe(1)});
});

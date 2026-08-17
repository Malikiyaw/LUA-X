export type ZoneKind = 'spawn'|'safe'|'combat'|'objective'|'traversal'|'interaction'|'checkpoint';
export type AssetKind = 'model'|'part'|'folder'|'terrain'|'light'|'spawn'|'decor';
export interface Vec3 { x:number; y:number; z:number }
export interface Transform { position:Vec3; rotation:Vec3; scale:Vec3 }
export interface Bounds { min:Vec3; max:Vec3 }
export interface WorldAsset { id:string; name:string; kind:AssetKind; transform:Transform; bounds?:Bounds; tags?:string[]; collision?:'none'|'simple'|'complex' }
export interface WorldZone { id:string; name:string; kind:ZoneKind; bounds:Bounds; tags?:string[]; linkedAssetIds?:string[] }
export interface Landmark { id:string; name:string; purpose:string; position:Vec3; importance:'low'|'medium'|'high'|'critical' }
export interface PathNode { id:string; position:Vec3; neighbors:string[] }
export interface PerformanceBudget { maxInstances?:number; maxDecorativeParts?:number; maxDynamicParts?:number; maxLights?:number; notes:string[] }
export interface WorldSpec { id:string; name:string; assets:WorldAsset[]; zones:WorldZone[]; landmarks:Landmark[]; paths:PathNode[]; budget:PerformanceBudget; streaming:{enabled:boolean; regions:string[]}; design:{paletteTokens:Record<string,string>; mood:string; density:'sparse'|'balanced'|'dense'} }
export interface WorldIssue { severity:'error'|'warning'; code:string; message:string; id?:string }
const finite=(n:number)=>Number.isFinite(n);
const validVec=(v:Vec3)=>finite(v.x)&&finite(v.y)&&finite(v.z);
export function validateWorld(world:WorldSpec):WorldIssue[]{
 const out:WorldIssue[]=[]; const ids=new Set<string>();
 if(!world.id.trim()||!world.name.trim()) out.push({severity:'error',code:'WORLD_IDENTITY',message:'World id and name are required.'});
 const add=(id:string,type:string)=>{if(!id.trim())out.push({severity:'error',code:'EMPTY_ID',message:`${type} requires an id.`,id});else if(ids.has(id))out.push({severity:'error',code:'DUPLICATE_ID',message:`Duplicate world id: ${id}`,id});else ids.add(id)};
 for(const a of world.assets){add(a.id,'Asset');if(!validVec(a.transform.position)||!validVec(a.transform.rotation)||!validVec(a.transform.scale))out.push({severity:'error',code:'INVALID_TRANSFORM',message:`Invalid transform for ${a.id}`,id:a.id});if(a.transform.scale.x<0||a.transform.scale.y<0||a.transform.scale.z<0)out.push({severity:'error',code:'NEGATIVE_SCALE',message:`Negative scale for ${a.id}`,id:a.id})}
 for(const z of world.zones){add(z.id,'Zone');if(!validVec(z.bounds.min)||!validVec(z.bounds.max))out.push({severity:'error',code:'INVALID_BOUNDS',message:`Invalid bounds for ${z.id}`,id:z.id});if(z.bounds.min.x>z.bounds.max.x||z.bounds.min.y>z.bounds.max.y||z.bounds.min.z>z.bounds.max.z)out.push({severity:'error',code:'INVERTED_BOUNDS',message:`Inverted bounds for ${z.id}`,id:z.id})}
 for(const l of world.landmarks){add(l.id,'Landmark');if(!validVec(l.position))out.push({severity:'error',code:'INVALID_POSITION',message:`Invalid landmark position for ${l.id}`,id:l.id})}
 const pathIds=new Set(world.paths.map(p=>p.id));for(const p of world.paths){add(p.id,'Path node');for(const n of p.neighbors)if(!pathIds.has(n))out.push({severity:'error',code:'MISSING_PATH_NODE',message:`Path ${p.id} references missing node ${n}`,id:p.id})}
 if(world.budget.maxInstances!==undefined&&world.budget.maxInstances<0)out.push({severity:'error',code:'BUDGET_RANGE',message:'maxInstances cannot be negative'});
 if(world.assets.length>(world.budget.maxInstances??Infinity))out.push({severity:'warning',code:'INSTANCE_BUDGET',message:'World asset count exceeds the declared instance budget.'});
 if(world.streaming.enabled&&world.streaming.regions.length===0)out.push({severity:'warning',code:'STREAMING_REGIONS',message:'Streaming is enabled but no regions are defined.'});
 return out;
}
export function worldStats(world:WorldSpec){return {assets:world.assets.length,zones:world.zones.length,landmarks:world.landmarks.length,pathNodes:world.paths.length,highPriorityLandmarks:world.landmarks.filter(l=>l.importance==='high'||l.importance==='critical').length}};

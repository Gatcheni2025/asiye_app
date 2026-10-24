'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const ratings=require('../functions/trip-ratings');
function fixture(patch={}){
 let trip={status:'completed',type:'ehailing',taxiId:'d',driverAuthUid:'d-auth',commuterId:'p',...patch};
 const db={ref:path=>({once:async()=>({val:()=>path.startsWith('requests/')?trip:{authUid:'p-auth'}})})};
 const save=body=>ratings.handle({db,id:'completed-trip-001',uid:'d-auth',body,
  ownsProfile:async(root,id,uid)=>root==='taxis'&&id==='d'&&uid==='d-auth',
  transact:async(_ref,fn)=>{trip=fn(trip);return {committed:true,snapshot:{val:()=>trip}};}});
 return {save,read:()=>trip};
}
test('a completed-trip rating persists once, retries preserve it and changes are rejected',async()=>{
 const f=fixture(),result=await f.save({passengerId:'p',score:5});
 assert.equal(result.ok,true);assert.equal(typeof f.read().tripRatings,'string');
 assert.equal(result.ratings.driverToPassenger.p.score,5);
 const persisted=f.read().tripRatings;
 assert.equal((await f.save({passengerId:'p',score:5})).ok,true);assert.equal(f.read().tripRatings,persisted);
 await assert.rejects(f.save({passengerId:'p',score:4}),/already saved/);
});
test('unfinished trips, unrelated passengers and non-integer scores cannot create a rating',async()=>{
 await assert.rejects(fixture({status:'in_transit'}).save({passengerId:'p',score:5}),/completed/);
 await assert.rejects(fixture().save({passengerId:'other',score:5}),/passenger/);
 for(const score of [0,6,1.5,'5',NaN,Infinity])await assert.rejects(fixture().save({passengerId:'p',score}),/1 to 5/);
});
test('Club ratings target only members who completed the ride and preserve other votes',async()=>{
 const f=fixture({type:'club',passengers:{p:{status:'completed'},p2:{status:'completed'},left:{status:'cancelled_by_commuter'}}});
 await f.save({passengerId:'p',score:3});await f.save({passengerId:'p2',score:5});
 await assert.rejects(f.save({passengerId:'left',score:5}),/completed/);
 assert.deepEqual(Object.keys(ratings.record(f.read()).driverToPassenger),['p','p2']);
});

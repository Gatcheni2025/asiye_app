const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sandbox={window:{},ASIYE:{ui:{escape}},console};
vm.runInNewContext(fs.readFileSync('assets/passenger-v2/js/ride-controller.js','utf8'),sandbox);
const ride=sandbox.ASIYE.ride;
test('Corolla illustration matches normalized make/model and known body colour',()=>{
 const svg=ride.vehicleIllustration({vehicleMake:' TOYOTA ',vehicleModel:'Corolla Quest',vehicleColor:'White'});
 assert.match(svg,/data-vehicle-art="toyota-corolla"/);
 assert.match(svg,/fill="#f5f5f0"/);
});
test('Unknown vehicle safely uses generic art and never injects supplied markup or photo',()=>{
 const svg=ride.vehicleIllustration({vehicleMake:'<script>x</script>',vehicleModel:'Corolla',vehicleColor:'red" onload="bad',driverVehiclePhoto:'https://private/car.jpg'});
 assert.match(svg,/data-vehicle-art="generic"/);
 assert.doesNotMatch(svg,/<script|onload|private\/car|fill="red/);
});
test('Assigned driver card uses SVG and retains real driver portrait and plate',()=>{
 const html=ride.driverCard({driverName:'Driver',vehicleMake:'Toyota',vehicleModel:'Corolla',vehicleReg:'ND 123',driverVehiclePhoto:'https://private/car.jpg',driverProfileImageUrl:'https://public/face.jpg'});
 assert.match(html,/data-vehicle-art="toyota-corolla"/);
 assert.match(html,/ND 123/);
 assert.match(html,/https:\/\/public\/face.jpg/);
 assert.doesNotMatch(html,/https:\/\/private\/car.jpg/);
});

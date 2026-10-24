'use strict';
// Merge reviewed app assets while preserving existing homepage/policy files.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {PROJECT,PRODUCTION_FILES}=require('./production_card_preflight.cjs');
const HOST='https://firebasehosting.googleapis.com/v1beta1';
const ROOT_ASSETS=new Set([...PRODUCTION_FILES.filter(p=>!p.includes('/')),
 'brand.css','native-notifications.js','session.js','support-chat.js','trip-chat.js','trip-chat.css',
 'live-car.js','sw.js','success.html','cancel.html','track.html','driver-onboarding.html','admin-release.js']);
const versionName=value=>typeof value==='string'&&new RegExp('^sites/'+PROJECT+'/versions/[A-Za-z0-9_-]+$').test(value);
async function liveVersion(api){
 const releases=await api('GET',HOST+'/sites/'+PROJECT+'/releases?pageSize=1');
 const name=releases.releases?.[0]?.version?.name;
 if(!versionName(name))throw Error('HOSTING_CURRENT_VERSION_UNAVAILABLE');
 const version=await api('GET',HOST+'/'+name),files=Object.create(null);let page='';
 do{
  const query=new URLSearchParams({pageSize:'1000'});if(page)query.set('pageToken',page);
  const result=await api('GET',HOST+'/'+name+'/files?'+query);
  for(const file of result.files||[]){
   if(typeof file.path!=='string'||!file.path.startsWith('/')||!/^[a-f0-9]{64}$/.test(file.hash||''))throw Error('HOSTING_FILE_METADATA_INVALID');
   files[file.path]=file.hash;
  }
  page=result.nextPageToken||'';
 }while(page);
 if(!Object.keys(files).length)throw Error('HOSTING_EXISTING_FILES_EMPTY');
 return {name,config:version.config||{},files};
}
function mergeConfig(current,review){
 const headers=(review.headers||[]).map(h=>({glob:h.source,headers:Object.fromEntries(h.headers.map(v=>[v.key,v.value]))}));
 const replaced=new Set(headers.map(h=>h.glob));
 return {...current,headers:[...(current.headers||[]).filter(h=>!replaced.has(h.glob)),...headers],
  rewrites:[{glob:'/admin',path:'/admin/index.html'},...(current.rewrites||[]).filter(r=>r.glob!=='/admin')]};
}
function assetsForHosting(root){
 const files=Object.create(null),rawHashes=Object.create(null),uploads=new Map();
 function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  if(entry.name.startsWith('.')||entry.name==='node_modules')continue;
  const file=path.join(folder,entry.name);
  if(entry.isSymbolicLink())throw Error('HOSTING_ASSET_SYMLINK');
  if(entry.isDirectory()){walk(file);continue;}if(!entry.isFile())continue;
  const relative=path.relative(root,file).split(path.sep).join('/');
  if(relative.startsWith('admin/testing.')||!/^(?:driver-v2|passenger-v2|admin|data)\//.test(relative)&&!ROOT_ASSETS.has(relative))continue;
  const raw=fs.readFileSync(file),zipped=zlib.gzipSync(raw),hash=crypto.createHash('sha256').update(zipped).digest('hex');
  files['/'+relative]=hash;rawHashes['/'+relative]=crypto.createHash('sha256').update(raw).digest('hex');uploads.set(hash,zipped);
 }}walk(root);return {files,rawHashes,uploads};
}
async function promoteHosting({api,previous,assets,reviewConfig,source,assertOff}){
 if((await liveVersion(api)).name!==previous.name)throw Error('HOSTING_RELEASE_CHANGED');
 const merged={...previous.files,...assets.files};
 for(const ext of ['html','js','css'])delete merged['/admin/testing.'+ext];
 await assertOff();
 const created=await api('POST',HOST+'/sites/'+PROJECT+'/versions',{config:mergeConfig(previous.config,reviewConfig)});
 if(!versionName(created.name))throw Error('HOSTING_CREATED_VERSION_INVALID');
 const entries=Object.entries(merged);
 for(let i=0;i<entries.length;i+=1000){
  const result=await api('POST',HOST+'/'+created.name+':populateFiles',{files:Object.fromEntries(entries.slice(i,i+1000))});
  const required=result.uploadRequiredHashes||[];
  if(required.some(h=>!/^[a-f0-9]{64}$/.test(h)||!assets.uploads.has(h)))throw Error('HOSTING_OLD_CONTENT_REUPLOAD_REQUIRED');
  if(required.length){
   const url=new URL(result.uploadUrl||'https://invalid.invalid');
   if(url.origin!=='https://upload-firebasehosting.googleapis.com'||url.pathname!=='/upload/'+created.name+'/files'||url.search||url.hash)throw Error('HOSTING_UPLOAD_URL_INVALID');
   for(let j=0;j<required.length;j+=5)await Promise.all(required.slice(j,j+5).map(h=>api('POST',url.href+'/'+h,assets.uploads.get(h),true)));
  }
 }
 await api('PATCH',HOST+'/'+created.name+'?updateMask=status',{status:'FINALIZED'});
 const current=await api('GET',HOST+'/sites/'+PROJECT+'/releases?pageSize=1');
 if(current.releases?.[0]?.version?.name!==previous.name)throw Error('HOSTING_RELEASE_CHANGED');
 await assertOff();
 await api('POST',HOST+'/sites/'+PROJECT+'/releases?'+new URLSearchParams({versionName:created.name}),
  {message:'Asiye reviewed app '+source+'; checkout gate remains off'});
 const after=await liveVersion(api);
 if(after.name!==created.name||Object.entries(merged).some(([p,h])=>after.files[p]!==h))throw Error('HOSTING_RELEASE_READBACK_MISMATCH');
 return {version:created.name,files:Object.keys(merged).length,
  preservedFiles:Object.keys(previous.files).filter(p=>!Object.hasOwn(assets.files,p)&&!p.startsWith('/admin/testing.')).length};
}
module.exports={HOST,versionName,liveVersion,mergeConfig,assetsForHosting,promoteHosting};

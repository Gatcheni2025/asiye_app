#!/usr/bin/env python3
"""Read immutable deployed source in the pinned production project; never extract it."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
try:
    from .audit_staging_function_source import compare_archive
except ImportError:
    from audit_staging_function_source import compare_archive
ROOT = Path(__file__).resolve().parents[1]
PROJECT, NUMBER, REGION = 'asiye-80386', '531902350858', 'us-central1'
GEN1 = frozenset(('disburseCompletedCardTrips', 'releaseCancelledGoTripPayment', 'releaseCancelledClubPassengerPayment',
                  'refreshClubPaymentReadinessAfterSafetyShare', 'synchronizeClubBooking'))
def command(args):
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=90)
    if r.returncode: raise ValueError('LOCAL_SOURCE_READ_UNAVAILABLE')
    return r.stdout
def pinned_name(name): return f'projects/{PROJECT}/locations/{REGION}/functions/{name}'
def source_for(item, name, get_json, reviewed=True):
    identities = {pinned_name(name), f'projects/{NUMBER}/locations/{REGION}/functions/{name}'}
    if item.get('name') not in identities or item.get('state') != 'ACTIVE': raise ValueError('ACTIVE_PRODUCTION_FUNCTION_UNAVAILABLE')
    if name not in GEN1 and not (not reviewed and item.get('environment') == 'GEN_1'):
        b = item.get('buildConfig', {})
        if reviewed and (item.get('environment') == 'GEN_1' or b.get('runtime') != 'nodejs22' or b.get('entryPoint') != name):
            raise ValueError('REVIEWED_RUNTIME_OR_ENTRYPOINT_MISMATCH')
        resolved=b.get('sourceProvenance', {}).get('resolvedStorageSource', {})
        if not reviewed and not resolved.get('generation'):
            original=b.get('source',{}).get('storageSource',{})
            if original.get('generation'):return original
            return {'currentGen2UpdateTime':item.get('updateTime','')}
        return resolved
    if item.get('environment') == 'GEN_2': raise ValueError('REVIEWED_GENERATION_MISMATCH')
    old = get_json('https://cloudfunctions.googleapis.com/v1/' + pinned_name(name))
    if old.get('name') not in identities or old.get('status') != 'ACTIVE' or (reviewed and (old.get('runtime') != 'nodejs22' or old.get('entryPoint') != name)):
        raise ValueError('REVIEWED_RUNTIME_OR_ENTRYPOINT_MISMATCH')
    version = str(old.get('versionId', ''))
    if not re.fullmatch(r'[1-9][0-9]*', version): raise ValueError('GEN1_DEPLOYED_VERSION_UNAVAILABLE')
    return {'functionVersion': version}
def storage_identity(source):
    bucket, obj, gen = (str(source.get(k, '')) for k in ('bucket', 'object', 'generation'))
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]', bucket) or not obj or not re.fullmatch(r'[1-9][0-9]*', gen): raise ValueError('IMMUTABLE_SOURCE_UNAVAILABLE')
    if NUMBER not in bucket and PROJECT not in bucket: raise ValueError('SOURCE_BUCKET_NOT_PRODUCTION')
    return bucket, obj, gen
def signed_source_url(value):
    try:
        p = urllib.parse.urlsplit(value); host = p.hostname or ''
        valid = p.scheme == 'https' and p.port in (None, 443) and not p.username and not p.password and not p.fragment and bool(p.path.strip('/')) and (host == 'storage.googleapis.com' or host.endswith('.storage.googleapis.com'))
    except (TypeError, ValueError): valid = False
    if not valid: raise ValueError('SIGNED_SOURCE_URL_INVALID')
    return value
def audit(items, names, expected, get_json, read_storage, read_version):
    indexed = {i.get('name', '').split('/')[-1]: i for i in items}; cache = {}
    result = {'project': PROJECT, 'matched': [], 'mismatched': [], 'blocked': [], 'readOnly': True, 'dependencyInstallationNotAttested': True}
    for name in names:
        try:
            source = source_for(indexed.get(name, {}), name, get_json)
            if 'functionVersion' in source: diff = compare_archive(read_version(name, source['functionVersion']), expected)
            else:
                key = storage_identity(source)
                if key not in cache: cache[key] = compare_archive(read_storage(*key), expected)
                diff = cache[key]
            if diff: result['mismatched'].append({'name': name, 'files': diff})
            else: result['matched'].append(name)
        except urllib.error.HTTPError as e: result['blocked'].append({'name': name, 'reason': 'SOURCE_READ_HTTP_' + str(e.code)})
        except Exception as e:
            safe = {'ACTIVE_PRODUCTION_FUNCTION_UNAVAILABLE','REVIEWED_RUNTIME_OR_ENTRYPOINT_MISMATCH','REVIEWED_GENERATION_MISMATCH','GEN1_DEPLOYED_VERSION_UNAVAILABLE','IMMUTABLE_SOURCE_UNAVAILABLE','SOURCE_BUCKET_NOT_PRODUCTION','SIGNED_SOURCE_URL_INVALID','SOURCE_REDIRECT_BLOCKED','ARCHIVE_SIZE_LIMIT','GEN1_DEPLOYMENT_CHANGED_DURING_AUDIT','DUPLICATE_ARCHIVE_ENTRIES'}
            result['blocked'].append({'name': name, 'reason': str(e) if isinstance(e, ValueError) and str(e) in safe else 'SOURCE_READ_UNAVAILABLE'})
    result['ok'] = bool(names) and len(names) == len(set(names)) == len(result['matched'])
    return result
def main():
    if command(['gcloud','config','get-value','project']).strip() != PROJECT or command(['gcloud','projects','describe',PROJECT,'--format=value(projectNumber)']).strip() != NUMBER: raise ValueError('PRODUCTION_PROJECT_IDENTITY_MISMATCH')
    names = json.loads(command(['node','-e',"process.stdout.write(JSON.stringify(require('./scripts/production_release_scope.cjs').FUNCTIONS))"]))
    if len(names) != 44 or len(set(names)) != 44 or 'adminStagingTestConsole' in names: raise ValueError('PRODUCTION_SCOPE_INVALID')
    expected = {p.name:p.read_bytes() for p in (ROOT/'functions').glob('*.js')}
    pkg = json.loads((ROOT/'functions/package.json').read_text()); pkg['main'] = 'production-index.generated.cjs'
    expected['package.json'] = json.dumps(pkg).encode()
    expected[pkg['main']] = command(['node','-e',"process.stdout.write(require('./scripts/production_release_scope.cjs').renderEntry())"]).encode()
    items = json.loads(command(['gcloud','functions','list','--v2','--regions='+REGION,'--project='+PROJECT,'--format=json']))
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args): raise ValueError('SOURCE_REDIRECT_BLOCKED')
    opener = urllib.request.build_opener(NoRedirect())
    def read(req):
        with opener.open(req, timeout=45) as r: data = r.read(80*1024*1024+1)
        if len(data)>80*1024*1024: raise ValueError('ARCHIVE_SIZE_LIMIT')
        return data
    def request(url, body=None):
        headers = {'Authorization':'Bearer '+command(['gcloud','auth','print-access-token']).strip()}
        if body is not None: headers['Content-Type']='application/json'
        return urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,headers=headers,method='POST' if body is not None else 'GET')
    def get_json(url): return json.loads(read(request(url)))
    def read_storage(bucket,obj,gen):
        url='https://storage.googleapis.com/storage/v1/b/'+urllib.parse.quote(bucket,safe='')+'/o/'+urllib.parse.quote(obj,safe='')
        return read(request(url+'?'+urllib.parse.urlencode({'alt':'media','generation':gen})))
    def read_version(name,version):
        url='https://cloudfunctions.googleapis.com/v1/'+pinned_name(name)
        meta=json.loads(read(request(url+':generateDownloadUrl',{'versionId':version})))
        data=read(urllib.request.Request(signed_source_url(meta.get('downloadUrl'))))
        current=get_json(url)
        if str(current.get('versionId','')) != version or current.get('status') != 'ACTIVE': raise ValueError('GEN1_DEPLOYMENT_CHANGED_DURING_AUDIT')
        return data
    def read_current_gen2(name,updated):
        if not updated:raise ValueError('CURRENT_GEN2_SOURCE_IDENTITY_UNAVAILABLE')
        url='https://cloudfunctions.googleapis.com/v2/'+pinned_name(name)
        meta=json.loads(read(request(url+':generateDownloadUrl',{})))
        data=read(urllib.request.Request(signed_source_url(meta.get('downloadUrl'))))
        current=get_json(url)
        if current.get('updateTime')!=updated or current.get('state')!='ACTIVE':raise ValueError('GEN2_DEPLOYMENT_CHANGED_DURING_BACKUP')
        return data
    if len(sys.argv)==3 and sys.argv[1]=='--backup-dir':
        folder=Path(sys.argv[2]);folder.mkdir(parents=True,mode=0o700,exist_ok=True);folder.chmod(0o700);records=[]
        for item in items:
            name=item.get('name','').split('/')[-1]
            if name not in names: continue
            try:
                src=source_for(item,name,get_json,reviewed=False)
                data=(read_version(name,src['functionVersion']) if 'functionVersion' in src else
                      read_current_gen2(name,src['currentGen2UpdateTime']) if 'currentGen2UpdateTime' in src else
                      read_storage(*storage_identity(src)))
                sha=hashlib.sha256(data).hexdigest();file=folder/(sha+'.archive')
                if not file.exists():file.write_bytes(data);file.chmod(0o600)
                records.append({'name':name,'sha256':sha,'source':src})
            except Exception as e:
                print('PRODUCTION_SOURCE_BACKUP: BLOCKED '+name+'='+('HTTP_'+str(e.code) if isinstance(e,urllib.error.HTTPError) else 'SOURCE_READ_UNAVAILABLE'));return 2
        file=folder/'manifest.json';file.write_text(json.dumps({'project':PROJECT,'functions':records},indent=2)+'\n');file.chmod(0o600)
        print('PRODUCTION_SOURCE_BACKUP: PRESERVED='+str(len(records)));return 0
    if len(sys.argv)!=1:raise ValueError('SOURCE_AUDIT_ARGUMENT_INVALID')
    result=audit(items,names,expected,get_json,read_storage,read_version)
    result['reviewCommit']=command(['git','rev-parse','HEAD']).strip()
    folder=ROOT/'production-release-readback';folder.mkdir(exist_ok=True)
    (folder/'source.json').write_text(json.dumps(result,indent=2)+'\n')
    print('PRODUCTION_FUNCTION_SOURCE: MATCH='+str(len(result['matched']))+'/'+str(len(names)))
    for kind in ('blocked','mismatched'):
        for item in result[kind]:print('SOURCE_'+kind.upper()+': '+item['name']+'='+item.get('reason',','.join(item.get('files',[]))))
    return 0 if result['ok'] else 2
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception:print('PRODUCTION_FUNCTION_SOURCE: BLOCKED SOURCE_AUDIT_UNAVAILABLE');raise SystemExit(2)

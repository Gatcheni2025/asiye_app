import io
import json
import unittest
import zipfile
from scripts.audit_production_function_source import PROJECT, NUMBER, source_for, audit, signed_source_url

def archive(value=b'reviewed'):
    data=io.BytesIO()
    with zipfile.ZipFile(data,'w') as z:
        z.writestr('index.js',value)
        z.writestr('package.json','{"main":"index.js"}')
        z.writestr('.env','PRIVATE_SECRET_MUST_NOT_BE_READ')
    return data.getvalue()
def item(name='prepareTripPayment'):
    return {'name':f'projects/{PROJECT}/locations/us-central1/functions/{name}','state':'ACTIVE','environment':'GEN_2',
            'buildConfig':{'runtime':'nodejs22','entryPoint':name,'sourceProvenance':{'resolvedStorageSource':{'bucket':'gcf-v2-sources-'+NUMBER+'-us-central1','object':'source.zip','generation':'123'}}}}

class ProductionSourceProofTests(unittest.TestCase):
    def test_archive_bytes_and_project_runtime_identity_are_both_required(self):
        expected={'index.js':b'reviewed','package.json':b'{"main":"index.js"}'}
        for changed in (False,True):
            result=audit([item()],['prepareTripPayment'],expected,lambda _:self.fail('Unexpected legacy call'),lambda *args:archive(b'old' if changed else b'reviewed'),lambda *args:self.fail('Unexpected version download'))
            self.assertEqual(result['ok'],not changed)
        other=item();other['name']=other['name'].replace(PROJECT,'asiye-paystack-staging')
        self.assertRaisesRegex(ValueError,'PRODUCTION_FUNCTION',source_for,other,'prepareTripPayment',lambda _:None)
        old=item();old['buildConfig']['runtime']='nodejs20'
        self.assertRaisesRegex(ValueError,'RUNTIME',source_for,old,'prepareTripPayment',lambda _:None)
        self.assertIn('generation',source_for(old,'prepareTripPayment',lambda _:None,reviewed=False))

    def test_shared_immutable_generations_are_downloaded_once(self):
        reads=[]
        result=audit([item('prepareTripPayment'),item('paystackWebhook')],['prepareTripPayment','paystackWebhook'],
                     {'index.js':b'reviewed','package.json':b'{"main":"index.js"}'},lambda _:None,
                     lambda *args:reads.append(args) or archive(),lambda *args:None)
        self.assertTrue(result['ok']);self.assertEqual(len(reads),1)

    def test_gen1_source_is_bound_to_an_exact_active_deployed_version(self):
        name='releaseCancelledGoTripPayment';current={'name':f'projects/{PROJECT}/locations/us-central1/functions/{name}','state':'ACTIVE','environment':'GEN_1'}
        legacy={'name':current['name'],'status':'ACTIVE','runtime':'nodejs22','entryPoint':name,'versionId':'17'}
        self.assertEqual(source_for(current,name,lambda _:legacy),{'functionVersion':'17'})
        for url in ['http://storage.googleapis.com/file','https://attacker.example/file','https://storage.googleapis.com.evil/file','https://user:pass@storage.googleapis.com/file']:
            self.assertRaisesRegex(ValueError,'URL_INVALID',signed_source_url,url)
        self.assertEqual(signed_source_url('https://storage.googleapis.com/private/source.zip?signature=private'),'https://storage.googleapis.com/private/source.zip?signature=private')

    def test_missing_or_unreadable_source_never_qualifies_as_a_match(self):
        result=audit([],['prepareTripPayment'],{},lambda _:None,lambda *args:None,lambda *args:None)
        self.assertFalse(result['ok']);self.assertEqual(result['matched'],[])

if __name__=='__main__':unittest.main()

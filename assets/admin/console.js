/* Asiye Operations Console v1. Server-side callable authorization is
   mandatory; never read or write privileged RTDB collections from browser. */
(() => {
 'use strict';
 const firebaseConfig={
   apiKey:'AIzaSyCX_euO2EEPhfhuG5DTsSi5vCpZ9MFZczY',
   authDomain:'asiye-80386.firebaseapp.com',
   databaseURL:'https://asiye-80386-default-rtdb.firebaseio.com',
   projectId:'asiye-80386',
   storageBucket:'asiye-80386.firebasestorage.app',
   appId:'1:531902350858:web:f8a4a246bf350d50e3c1f3'
 };
 firebase.initializeApp(firebaseConfig);
 const auth=firebase.auth();
 const callable=name=>firebase.functions().httpsCallable(name);
 const fetchResource=async resource=>{
   const result=await callable('adminFetchData')({resource,limit:500});
   return result.data?.data||{};
 };
 const manage=async payload=>(await callable('adminManagePlatform')(payload)).data;
 const ops=async payload=>(await callable('adminOperations')(payload)).data;
 const review=async payload=>(await callable('reviewDriverEnrollment')(payload)).data;
 const $=id=>document.getElementById(id);
 const el=(tag,cls,text)=>{
   const node=document.createElement(tag);
   if(cls) node.className=cls;
   if(text!==undefined) node.textContent=String(text);
   return node;
 };
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const fmtDate=value=>{
   const n=Number(value||0);
   return n>0?new Date(n).toLocaleString('en-ZA'):'—';
 };
 const money=value=>'R '+Number(value||0).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2});
 const shorten=(value,n=35)=>{
   const str=String(value??'');
   return str.length>n?str.slice(0,n-1)+'…':str;
 };
 const safeUrl=url=>{
   try{
     const u=new URL(String(url||''));
     return u.protocol==='https:'&&[
       'firebasestorage.googleapis.com','storage.googleapis.com'
     ].includes(u.hostname)?u.href:'';
   }catch{return '';}
 };
 const refs=(records)=>Object.entries(records||{}).filter(([id,r])=>r&&typeof r==='object')
  .map(([id,record])=>({...record,id})); // DB key, never user-supplied id, owns actions
 const latest=(rows,key)=>{
   return rows.sort((a,b)=>Number(b[key]||b.updatedAt||b.createdAt||b.timestamp||0)
    -Number(a[key]||a.updatedAt||a.createdAt||a.timestamp||0));
 };
 const info={
   overview:['Overview','A live snapshot of recent operational records. Figures are not lifetime totals.',''],
   enrollments:['Driver approvals','Review new drivers, identities, vehicles and supporting evidence.','driverEnrollments'],
   drivers:['Drivers','View verification, vehicle and on-platform state.','taxis'],
   passengers:['Passengers','Profile details, identity and account status.','commuters'],
   bookings:['Ride bookings','Review ride requests and operational status.','requests'],
   parcels:['Deliveries','Track parcel requests and fulfillment status.','delivery_requests'],
   wallets:['Wallet balances','Inspect passenger balances and audited manual adjustments.','commuters'],
   payments:['Payments','Wallet deposits and EFT reconciliation records.','walletPayments'],
   earnings:['Earning records','Recorded driver card payouts; not a complete earnings ledger.','driverCardPayouts'],
   payouts:['Payouts','Withdrawal and payout requests. Approval does not initiate bank transfers.','payout_requests'],
   refunds:['Refund cases','Track disputed charges and refunds without moving money.','refundCases'],
   support:['Support chats','Read and respond to customer support requests.','support_chats'],
   documents:['Documents','Document links from driver registration submissions.','driverEnrollments'],
   invitations:['Register users','Pre-register passenger and driver invitations; users verify OTP themselves.','adminInvitations'],
   audit:['Audit log','Recent privileged activity, actor and timestamp.','adminAudit']
 };
 let view='overview',items=[],records={},authenticated=false,currentToken=0,search='';
 function banner(message,type=''){
   const node=$('notice');node.replaceChildren();
   if(!message)return;
   node.append(el('div','notice'+(type==='error'?' error':''),message));
 }
 let accessError='';
 function showLogin(message=''){
   authenticated=false;
   currentToken++;
   items=[];records={};
   $('shell').hidden=true;$('loginScreen').hidden=false;$('boot').hidden=true;
   $('loginError').textContent=message||accessError;
 }
 function setUser(user){
   accessError='';
   $('adminEmail').textContent=user.email||'Administrator';
   $('loginScreen').hidden=true;$('boot').hidden=true;$('shell').hidden=false;
   authenticated=true;
 }
 async function authorize(user){
   const result=await callable('adminWhoAmI')({});
   if(!result.data?.ok||!result.data?.uid||result.data.uid!==user.uid)
     throw Error('Your account is not an authorized Asiye administrator.');
 }
 auth.onAuthStateChanged(async user=>{
   if(!user){showLogin();return;}
   try{
     await authorize(user);
     setUser(user);
     await navigate(view);
   }catch(err){
     accessError='Admin access denied. '+(err.code==='functions/permission-denied'?
       'Your account is not on the Asiye administrator list.':
       'Please contact an authorized platform administrator.');
     await auth.signOut();
     showLogin(accessError);
   }
 },()=>showLogin('Unable to restore Firebase authentication.'));
 $('loginForm').addEventListener('submit',async ev=>{
   ev.preventDefault();
   $('loginError').textContent='';
   $('loginButton').disabled=true;
   try{
     await auth.signInWithEmailAndPassword($('loginEmail').value.trim(),$('loginPassword').value);
   }catch(err){$('loginError').textContent=err.message||'Unable to sign in.';}
   finally{$('loginButton').disabled=false;}
 });
 $('resetPassword').onclick=async()=>{
   const email=$('loginEmail').value.trim();
   if(!email){$('loginError').textContent='Enter your email first.';return;}
   try{await auth.sendPasswordResetEmail(email);
     $('loginError').textContent='If that account exists, a password-reset email has been requested.';}
   catch{$('loginError').textContent='Unable to request a password reset.';}
 };
 $('logout').onclick=()=>auth.signOut();
 $('refresh').onclick=()=>navigate(view);
 $('menuToggle').onclick=()=>$('sidebar').classList.add('open');
 $('sideClose').onclick=()=>$('sidebar').classList.remove('open');
 $('drawerClose').onclick=()=>$('drawer').close();
 $('drawer').addEventListener('click',ev=>{if(ev.target===$('drawer'))$('drawer').close();});
 document.querySelectorAll('.nav[data-view]').forEach(button=>
   button.addEventListener('click',()=>navigate(button.dataset.view)));
 $('search').addEventListener('input',()=>{search=$('search').value.trim().toLowerCase();render();});
 $('newRecord').onclick=()=>openCreate();
 function loading(text='Loading latest records…'){
   $('workspaceBody').replaceChildren(el('div','empty loading-dot',text));
 }
 function recordRow(id,record){return {id,...(record||{})};}
 async function navigate(next){
   if(!authenticated||!info[next])return;
   const token=++currentToken;view=next;search='';
   $('search').value='';$('sidebar').classList.remove('open');
   document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===view));
   $('breadcrumb').textContent=info[view][0];$('pageTitle').textContent=info[view][0];
   $('pageSubtitle').textContent=info[view][1];
   $('newRecord').hidden=!['invitations','refunds'].includes(view);
   $('newRecord').textContent=view==='refunds'?'+ New refund case':'+ Invite user';
   $('tableTitle').textContent=view==='overview'?'Activity overview':info[view][0];
   $('tableNote').textContent='Latest 500 records per resource maximum · not lifetime platform totals.';
   $('metrics').replaceChildren();banner();loading();
   try{
     if(view==='overview'){
       const keys=['requests','commuters','taxis','driverEnrollments','walletPayments','support_chats'];
       const entries=await Promise.all(keys.map(async k=>[k,await fetchResource(k)]));
       if(currentToken!==token)return;
       records=Object.fromEntries(entries);
       renderOverview();
     }else if(view==='payouts'){
       const [pr,withdraw]=await Promise.all([fetchResource('payout_requests'),fetchResource('withdrawals')]);
       if(currentToken!==token)return;
       records={payout_requests:pr,withdrawals:withdraw};
       items=latest([...refs(pr).map(r=>({...r,_collection:'payout_requests'})),
         ...refs(withdraw).map(r=>({...r,_collection:'withdrawals'}))]);
       render();
     }else{
       const key=info[view][2];const list=await fetchResource(key);
       if(currentToken!==token)return;
       records={[key]:list};
       items=latest(refs(list),view==='enrollments'||view==='documents'?'submittedAt':view==='bookings'?'createdAt':'updatedAt');
       if(view==='bookings') items=items.filter(row=>row.type!=='delivery');
       render();
     }
     $('lastRefreshed').textContent='Refreshed '+new Date().toLocaleTimeString('en-ZA');
   }catch(error){
     if(currentToken!==token)return;
     console.error('Admin records unavailable',error?.code||'unknown');
     banner('Unable to load this section. Check administrator permission and Firebase connection.','error');
     $('workspaceBody').replaceChildren(el('div','empty','No data loaded. Use Refresh to retry.'));
   }
 }
 function metric(label,value,hint){
   const box=el('article','metric');
   box.append(el('div','label',label),el('div','value',value),el('div','hint',hint));
   return box;
 }
 function renderOverview(){
   const data=records;
   const rides=refs(data.requests).filter(r=>r.type!=='delivery');
   const passengers=refs(data.commuters),drivers=refs(data.taxis);
   const en=refs(data.driverEnrollments);
   const pay=refs(data.walletPayments),tickets=refs(data.support_chats);
   const pending=en.filter(r=>r.status==='pending');
   const outstanding=tickets.filter(r=>!['closed','resolved'].includes(r.status));
   const completed=rides.filter(r=>r.status==='completed');
   const balance=passengers.reduce((sum,r)=>sum+Number(r.walletBalance??r.credits??0),0);
   const cards=[
     ['Pending approvals',pending.length,'Recent enrollment sample'],
     ['Ride bookings',rides.length,'Most recent requests'],
     ['Passenger profiles',passengers.length,'Most recent profiles'],
     ['Driver profiles',drivers.length,'Most recent profiles'],
     ['Support awaiting action',outstanding.length,'Open or pending conversations'],
     ['Recorded wallet balances',money(balance),'Visible passenger sample'],
     ['Completed rides',completed.length,'Among fetched requests'],
     ['Wallet payment records',pay.length,'Recent deposits / top-ups']
   ];
   $('metrics').replaceChildren(...cards.map(c=>metric(...c)));
   const root=$('workspaceBody');root.replaceChildren();
   const panel=el('div','overview-list');
   for(const [label,count,link] of [
     ['New driver applications',pending.length,'enrollments'],
     ['Open support chats',outstanding.length,'support'],
     ['Recent wallet payments',pay.length,'payments'],
     ['Completed ride requests',completed.length,'bookings']
   ]){
     const row=el('div','overview-row');
     row.append(el('span','',label),el('strong','',count));
     const b=el('button','soft','Open →');b.onclick=()=>navigate(link);row.append(b);panel.append(row);
   }
   panel.append(el('p','note','Figures are calculated from the most recent 500 records in each collection. They are operational snapshots, not accounting reconciliations or certified platform totals.'));
   root.append(panel);
 }
 const columns={
   enrollments:[['Driver',r=>r.fullName||r.name],['Phone',r=>r.phone],['Vehicle',r=>[r.vehicleMake,r.vehicleModel].filter(Boolean).join(' ')],['Submitted',r=>fmtDate(r.submittedAt)],['Status',r=>r.status]],
   drivers:[['Driver',r=>r.fullName||r.name],['Phone',r=>r.phone],['Car registration',r=>r.vehicleReg||r.taxiRegistrationNumber],['Online',r=>r.isOnline?'Online':'Offline'],['Verification',r=>r.verificationStatus]],
   passengers:[['Passenger',r=>r.name],['Phone',r=>r.phone],['Account',r=>r.isActive===false?'Suspended':'Active'],['Wallet',r=>money(r.walletBalance??r.credits)]],
   bookings:[['Booking',r=>r.id],['Passenger',r=>r.commuterId],['Driver',r=>r.taxiId||r.driverAuthUid],['Fare',r=>money(r.finalAmount??r.agreedFare??r.calculatedPrice)],['Status',r=>r.status]],
   parcels:[['Delivery',r=>r.id],['Sender',r=>r.commuterId||r.senderId],['Driver',r=>r.taxiId],['Amount',r=>money(r.finalAmount??r.agreedFare??r.calculatedPrice)],['Status',r=>r.status]],
   wallets:[['Passenger',r=>r.name],['Phone',r=>r.phone],['Wallet balance',r=>money(r.walletBalance??r.credits)],['Updated',r=>fmtDate(r.walletUpdatedAt)]],
   payments:[['Payment reference',r=>r.reference||r.id],['Provider',r=>r.provider],['Passenger',r=>r.passengerId||r.uid],['Amount',r=>money(r.amount)],['Status',r=>r.status]],
   earnings:[['Payout record',r=>r.reference||r.id],['Driver',r=>r.driverId||r.uid],['Trip',r=>r.requestId||r.tripId],['Amount',r=>money(r.amount??r.netAmount??r.driverAmount)],['Status',r=>r.status]],
   payouts:[['Payout',r=>r.id],['Source',r=>r._collection],['Driver',r=>r.driverId||r.uid||r.userId],['Amount',r=>money(r.amount)],['Status',r=>r.status]],
   refunds:[['Case',r=>r.id],['Booking',r=>r.bookingId],['Amount',r=>money(r.amount)],['Created',r=>fmtDate(r.createdAt)],['Status',r=>r.status]],
   support:[['Conversation',r=>r.id],['Customer',r=>r.userName||r.name||r.userId],['Role',r=>r.role],['Last update',r=>fmtDate(r.updatedAt)],['Status',r=>r.status]],
   documents:[['Driver',r=>r.fullName||r.name],['Phone',r=>r.phone],['Documents',r=>Object.keys(r.documents||{}).length+' uploaded'],['Submitted',r=>fmtDate(r.submittedAt)],['Status',r=>r.status]],
   invitations:[['Name',r=>r.fullName],['Role',r=>r.role],['Phone',r=>r.phone],['Invited',r=>fmtDate(r.createdAt)],['Status',r=>r.status]],
   audit:[['Action',r=>r.action],['Admin',r=>r.adminEmail||r.adminUid],['Target',r=>r.target],['Time',r=>fmtDate(r.createdAt)]]
 };
 function chip(text){
   const status=String(text||'unknown').toLowerCase();
   const cls=/rejected|failed|cancelled|suspend/.test(status)?'bad':/pending|waiting|open|under_review|awaiting/.test(status)?'warn':'';
   const node=el('span','pill'+(cls?' '+cls:''),text||'—');return node;
 }
 function render(){
   if(view==='overview'){renderOverview();return;}
   const root=$('workspaceBody');root.replaceChildren();
   const filtered=items.filter(r=>!search || JSON.stringify(r).toLowerCase().includes(search));
   if(!filtered.length){root.append(el('div','empty',search?'No records match your search.':'No records in this section.'));return;}
   const table=el('table','data-table');
   const head=el('thead'),headRow=el('tr');
   for(const [label] of columns[view]||[])headRow.append(el('th','',label));
   headRow.append(el('th','','Actions'));head.append(headRow);table.append(head);
   const tbody=el('tbody');
   for(const record of filtered.slice(0,500)){
     const tr=el('tr');
     for(const [label,get] of columns[view]||[]){
       const cell=el('td');const val=get(record);
       if(/Status|Verification|Account|Online/.test(label))cell.append(chip(val));
       else{
         cell.append(el('div','row-primary',shorten(val,70)));
         if(label==='Driver' || label==='Passenger')cell.append(el('div','row-secondary',shorten(record.id,28)));
       }
       tr.append(cell);
     }
     const td=el('td');const btn=el('button','soft','View details');
     btn.onclick=()=>openRecord(record);td.append(btn);tr.append(td);tbody.append(tr);
   }
   table.append(tbody);root.append(table);
 }
 const addLine=(root,key,value)=>{
   const row=el('div','detail-line');
   row.append(el('div','key',key),el('div','val',value==null||value===''?'—':String(value)));
   root.append(row);
 };
 function showDrawer(title,subtitle,body,actions=[]){
   $('drawerTitle').textContent=title;$('drawerEyebrow').textContent=subtitle;
   $('drawerBody').replaceChildren(body);
   $('drawerActions').replaceChildren();
   for(const [label,handler,cls] of actions){
     const btn=el('button',cls||'soft',label);
     btn.onclick=async()=>{btn.disabled=true;
       try{await handler();}catch(error){banner(error?.message||'Action unsuccessful.','error');}
       finally{btn.disabled=false;}
     };
     $('drawerActions').append(btn);
   }
   $('drawer').showModal();
 }
 const changed=async(payload,message)=>{
   await manage(payload);
   $('drawer').close();banner(message||'Changes saved.');await navigate(view);
 };
 const ask=(message)=>window.confirm(message);
 const required=(prompt,defaultValue='')=>{
   const value=window.prompt(prompt,defaultValue);
   return value===null?null:value.trim();
 };
 function docLinks(r){
   const container=el('div','doc-list');
   const docs=r.documentUrls||{};
   const categories={selfie:'Verified face photo',car:'Vehicle photo',
     identity:'ID or passport',licence:'Driver licence',address:'Proof of address'};
   let count=0;
   for(const [key,label] of Object.entries(categories)){
     const url=safeUrl(docs[key]||'');
     if(!url)continue;
     count++;
     const row=el('div','doc-item');
     row.append(el('span','',label));
     const a=el('a','','View file ↗');a.href=url;a.target='_blank';
     a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';
     row.append(a);container.append(row);
   }
   if(!count)container.append(el('p','muted','No browser-viewable document links on this record.'));
   return container;
 }
 function openRecord(row){
   const body=el('div','detail-grid');
   const hide=new Set(['documents','documentUrls','walletAppliedPayments','walletRideHolds','password','token','accessToken','secret','messages','banking','accountNumber','idNumber','identityNumber']);
   for(const [key,value] of Object.entries(row)){
     if(hide.has(key)||key.startsWith('_'))continue;
     if(value && typeof value==='object') {
       addLine(body,key,JSON.stringify(value).slice(0,1200));
     }else if(value!=null){
       addLine(body,key,/password|secret|token/i.test(key)?'••••••':value);
     }
   }
   const actions=[];
   const id=row.id;
   if(view==='enrollments'&&row.status==='pending'){
     body.append(el('p','note','All five documents should be reviewed before approval. An approval activates the verified driver account.'));
     body.append(docLinks(row));
     actions.push(['Approve driver',async()=>{
       if(!ask('Approve '+(row.fullName||id)+'? Confirm their selfie, ID, licence, address and vehicle are valid.'))return;
       await review({uid:id,decision:'approved'});
       $('drawer').close();banner('Driver approved.');await navigate(view);
     },'primary']);
     actions.push(['Reject',async()=>{
       const reason=required('Reason for rejection (required):');
       if(!reason)return;
       if(!ask('Reject this application?'))return;
       await review({uid:id,decision:'rejected',reason});
       $('drawer').close();banner('Application rejected.');await navigate(view);
     },'soft danger']);
   } else if(view==='documents'){body.append(docLinks(row));}
   if(view==='support'){
     const messages=row.messages||{};
     const convo=el('section','doc-list');
     convo.append(el('h3','','Conversation'));
     Object.values(messages).filter(Boolean).sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0))
       .slice(-100).forEach(m=>{
         const card=el('div','doc-item');
         card.append(el('div','',String(m.senderRole||m.senderUid||'Customer')+': '+String(m.text||'').slice(0,1500)));
         convo.append(card);
       });
     body.append(convo);
     actions.push(['Reply',async()=>{
       const message=required('Type a support reply (2–1500 characters):');
       if(!message)return;
       await changed({action:'replySupport',id,message},'Support reply sent.');
     },'primary']);
     actions.push(['Resolve ticket',async()=>{
       if(!ask('Mark this conversation resolved?'))return;
       await changed({action:'updateSupport',id,status:'resolved',note:'Resolved from Operations Desk'},'Ticket resolved.');
     }]);
   }
   if(view==='passengers'||view==='wallets'){
     actions.push(['Edit account',async()=>{
       const name=required('Passenger display name:',row.name||'');
       if(name===null||!name)return;
       await changed({action:'updatePassenger',id,patch:{name}},'Passenger name updated.');
     }]);
     actions.push(['Wallet adjustment',async()=>{
       const value=required('Adjustment in Rands (+ credit, - debit), maximum R5,000:');
       if(value===null)return;
       const delta=Number(value);
       const reason=required('Reason and authorisation reference (required):');
       if(!reason||!Number.isFinite(delta)||delta===0||Math.abs(delta)>5000)
         throw Error('Enter a valid amount and audit reason.');
       if(!ask('FINANCIAL ACTION: Change this passenger wallet by '+money(delta)+'? This will change the real account balance.'))return;
       await changed({action:'adjustWallet',passengerId:id,delta,reason},'Wallet adjustment recorded.');
     },'soft danger']);
   }
   if(view==='bookings'){
     actions.push(['Cancel booking',async()=>{
       const reason=required('Why is this ride being cancelled?');
       if(!reason)return;
       if(!ask('Cancel this live ride? This does not automatically issue a refund.'))return;
       await changed({action:'cancelRequest',requestId:id,reason},'Booking cancelled. Check payment holds separately.');
     },'soft danger']);
   }
   if(view==='payments'){
     actions.push(['Add payment note',async()=>{
       const note=required('Note for the transaction audit trail:',row.adminNote||'');
       if(!note)return;
       await changed({action:'updatePaymentNote',id,note},'Payment note saved.');
     }]);
     if(row.provider==='manual_eft'&&row.status==='awaiting_payment'){
       actions.push(['Confirm EFT against bank',async()=>{
         const bankTrace=required('Bank-confirmed trace/reference (mandatory):');
         const note=required('Reconciliation proof / reviewer note:');
         if(!bankTrace||!note)throw Error('Bank trace and reconciliation note are required.');
         if(!ask('FINANCIAL ACTION: Credit '+money(row.amount)+' to the wallet only if the bank statement confirms receipt. Continue?'))return;
         await changed({action:'reconcileEftTopup',id,bankTrace,note},'EFT reconciled. Review balance and audit record.');
       },'soft danger']);
     }
   }
   if(view==='payouts'&&['pending','requested'].includes(String(row.status||'').toLowerCase())){
     actions.push(['Approve payout request',async()=>{
       const note=required('Review note (approval alone does NOT send a bank transfer):');
       if(!note)return;
       if(!ask('Approve this request for payment review? No transfer is initiated.'))return;
       await changed({action:'reviewPayout',collection:row._collection,id,status:'approved',note},'Request marked approved.');
     }]);
     actions.push(['Reject',async()=>{
       const note=required('Reason for rejection:');if(!note)return;
       await changed({action:'reviewPayout',collection:row._collection,id,status:'rejected',note},'Payout request rejected.');
     },'soft danger']);
   }
   if(view==='refunds'){
     body.append(el('p','note','This is a refund case tracker. No Paystack or bank refund has been executed. Reconcile with the gateway outside this console.'));
     actions.push(['Update case status',async()=>{
       const status=required('Choose: open, under_review, awaiting_gateway, resolved, rejected',row.status||'open');
       if(!status)return;
       const note=required('Audit note / gateway evidence:');
       if(!note)return;
       await ops({action:'updateRefundCase',id,status,note});
       $('drawer').close();banner('Case status saved; no funds moved.');await navigate(view);
     },'primary']);
   }
   const title=String(row.fullName||row.name||row.reference||row.id);
   showDrawer(title,info[view][0]+' · '+shorten(id,20),body,actions);
 }
 function formField(container,label,name,type='text',required=true,placeholder=''){
   const wrap=el('label','',label);const input=el(type==='textarea'?'textarea':type==='select'?'select':'input');
   if(type!=='textarea'&&type!=='select')input.type=type;
   input.name=name;input.required=required;input.placeholder=placeholder;
   wrap.append(input);container.append(wrap);return input;
 }
 function openCreate(){
   const body=el('div','form-stack');
   const fields={};
   if(view==='invitations'){
     fields.fullName=formField(body,'Full name','fullName');
     fields.phone=formField(body,'Mobile number','phone','tel',true,'082 123 4567');
     fields.email=formField(body,'Email (optional)','email','email',false);
     fields.role=formField(body,'Registration type','role','select');
     for(const role of ['passenger','driver']){
       const opt=el('option','',role==='driver'?'Driver':'Passenger');opt.value=role;fields.role.append(opt);
     }
     body.append(el('p','note','This creates a pending pre-registration invitation, not a live Firebase Auth account. The person must sign in with SMS OTP and complete registration themselves.'));
     showDrawer('Invite a user','REGISTRATION',body,[['Create invitation',async()=>{
       const payload=Object.fromEntries(Object.entries(fields).map(([k,input])=>[k,input.value.trim()]));
       if(!payload.fullName||!payload.phone)throw Error('Name and phone are required.');
       await ops({action:'inviteUser',...payload});
       $('drawer').close();banner('Invitation recorded. The user must verify their own mobile with SMS OTP to activate.');await navigate(view);
     },'primary']]);
   }else if(view==='refunds'){
     fields.bookingId=formField(body,'Booking ID (optional if gateway reference)','bookingId','text',false);
     fields.passengerId=formField(body,'Passenger ID (optional)','passengerId','text',false);
     fields.providerReference=formField(body,'Paystack/gateway reference (optional if booking ID)','providerReference','text',false);
     fields.amount=formField(body,'Amount in Rands','amount','number',true,'0.00');
     fields.reason=formField(body,'Reason for refund request','reason','textarea',true);
     body.append(el('p','note','Creating a refund case does not send funds. Financial approval, payment reference verification, and gateway refund execution are separate controlled actions.'));
     showDrawer('Open refund case','FINANCIAL REVIEW',body,[['Record case',async()=>{
       const payload=Object.fromEntries(Object.entries(fields).map(([k,input])=>[k,input.value.trim()]));
       if(!ask('Create this refund case for manual reconciliation? No payment will be sent.'))return;
       await ops({action:'createRefundCase',...payload});
       $('drawer').close();banner('Refund case created. No funds were moved.');await navigate(view);
     },'primary']]);
   }
 }
})();

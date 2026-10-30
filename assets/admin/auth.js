/* Isolated admin authentication; all roles are checked by callable Functions. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.AsiyeAdminAuth=api;
})(typeof window==='undefined'?globalThis:window,()=>{
 'use strict';
 function create(firebase,config){
  const app=firebase.apps.find(item=>item.name==='asiye-admin')||firebase.initializeApp(config,'asiye-admin');
  const auth=app.auth();
  const callable=name=>app.functions('us-central1').httpsCallable(name);
  const ready=auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
  async function authorize(user){
   if(!user)throw Error('Sign in to continue.');
   await user.getIdToken(true);
   let result,scope='platform';
   if(config.projectId==='asiye-paystack-staging'){
    result=await callable('adminEnrollmentConsole')({action:'session'});scope='enrollments';
   }else{
    try{result=await callable('adminWhoAmI')({});}
    catch(error){
     if(error.code!=='functions/permission-denied')throw error;
     result=await callable('adminEnrollmentConsole')({action:'session'});scope='enrollments';
    }
   }
   if(!result.data?.ok||result.data.uid!==user.uid)throw Error('The admin session could not be verified.');
   return scope;
  }
  async function signIn(providerName){
   await ready;
   const provider=providerName==='google'?new firebase.auth.GoogleAuthProvider():new firebase.auth.OAuthProvider('apple.com');
   if(providerName==='google')provider.setCustomParameters({prompt:'select_account'});
   else{provider.addScope('email');provider.addScope('name');}
   return auth.signInWithPopup(provider);
  }
  function errorMessage(error){
   const messages={
    'auth/popup-closed-by-user':'Sign-in cancelled. Choose Google, Apple or email to continue.',
    'auth/popup-blocked':'Allow the sign-in popup in your browser, then try again.',
    'auth/account-exists-with-different-credential':'Use the sign-in provider already linked to this account.',
    'auth/invalid-login-credentials':'Check your email and password, or use your linked Google or Apple account.',
    'auth/wrong-password':'Check your email and password, or use your linked Google or Apple account.',
    'functions/permission-denied':'You are signed in. Driver-approval access has not been assigned to this account.',
    'functions/not-found':'The admin service has not been deployed to this Firebase project.',
    'functions/unavailable':'The admin service is unavailable. Please retry.',
    'functions/internal':'The admin service could not be reached. Check deployment and retry.',
    'auth/operation-not-allowed':'This sign-in method is not enabled for this Firebase project.'
   };
   return messages[error?.code]||error?.message||'Unable to sign in. Please try again.';
  }
  return {app,auth,callable,ready,authorize,signIn,errorMessage};
 }
 return {create};
});

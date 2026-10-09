'use strict';

// Create-once driver application, independent of browser RTDB write rules.
// Only an OTP-linked Firebase Auth identity may submit. Each uploaded object
// must have been created by the authenticated enrollment uploader for this UID.
function makeEnrollmentSubmission({ admin, bucketName, cors }) {
  const clean = (value, max = 180) =>
    typeof value === 'string' ? value.trim().slice(0, max + 1) : '';
  const valid = (value, min, max) =>
    typeof value === 'string' && value.trim().length >= min &&
    value.trim().length <= max && !/[<>\u0000-\u001f]/.test(value);

  function bad(message, code = 422) {
    const error = new Error(message);
    error.httpStatus = code;
    throw error;
  }

  return async function submitDriverEnrollmentSecure(req, res) {
    cors(req, res);
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({error:'POST required.'});

    try {
      const match = String(req.get('authorization') || '').match(/^Bearer (.+)$/);
      if (!match) bad('Please sign in using SMS OTP.', 401);
      const identity = await admin.auth().verifyIdToken(match[1]);
      const uid = identity.uid;
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) bad('Invalid driver identity.', 403);
      const authUser = await admin.auth().getUser(uid);
      // Never trust phone text from the form or a WebView bridge payload.
      const phone = String(authUser.phoneNumber || identity.phone_number || '').trim();
      if (!phone || (authUser.phoneNumber && identity.phone_number &&
          authUser.phoneNumber !== identity.phone_number))
        bad('Your Firebase account has no verified mobile number. Sign in using SMS OTP.', 403);

      const input = req.body?.enrollment;
      const submissionId = clean(req.body?.submissionId, 72);
      if (!/^[A-Za-z0-9_-]{10,72}$/.test(submissionId) ||
          !input || typeof input !== 'object' || Array.isArray(input))
        bad('Invalid driver application.');
      const fullName = clean(input.fullName, 100);
      const residentialAddress = clean(input.residentialAddress, 300);
      if (!valid(fullName, 2, 100) || !valid(residentialAddress, 10, 300))
        bad('Full name and complete residential address are required.');
      const vehicle = input.vehiclePending || {};
      for (const [key,max] of Object.entries({type:35,make:80,model:80,colour:40,registration:20}))
        if (!valid(vehicle[key], 2, max)) bad('Missing vehicle ' + key + '.');
      const year = Number(vehicle.year), seats = Number(vehicle.seats);
      if (!Number.isInteger(year) || year < 1990 || year > 2100 ||
          !Number.isInteger(seats) || seats < 1 || seats > 15)
        bad('Invalid vehicle year or passenger seats.');
      const references = {};
      const uniquePhones = new Set();
      for (let i=1; i<=3; i++) {
        const entry = input.references?.['reference' + i] || {};
        if (!valid(entry.name,1,120) || !valid(entry.relationship,1,80) ||
            !valid(entry.phone,7,25) || !/^\+?[\d\s()-]+$/.test(entry.phone))
          bad('Three complete references are required.');
        const key = entry.phone.replace(/\D/g,'').replace(/^27(?=\d{9}$)/,'0');
        if (uniquePhones.has(key)) bad('Reference phone numbers must be different.');
        uniquePhones.add(key);
        references['reference' + i] = {
          name:clean(entry.name,120),phone:clean(entry.phone,25),
          relationship:clean(entry.relationship,80)
        };
      }
      const sourceBank = input.banking || {};
      for (const [key,max] of Object.entries({accountHolder:100,bank:80,accountType:40}))
        if (!valid(sourceBank[key], 2, max)) bad('Missing banking ' + key + '.');
      if (!/^\d{6,20}$/.test(sourceBank.accountNumber) ||
          !/^\d{6}$/.test(sourceBank.branchCode))
        bad('Please check your bank account and six-digit branch code.');
      if (input.consent !== true) bad('Application consent is required.');

      const ref = admin.database().ref('driverEnrollments/' + uid);
      // Only the authenticated owner can view or create this record.
      const prior = (await ref.once('value')).val();
      if (prior) return res.status(200).json({
        ok:true, alreadySubmitted:true, status:prior.status || 'pending'
      });
      const taxi = (await admin.database().ref('taxis/' + uid).once('value')).val();
      if (taxi?.verificationStatus === 'verified' || taxi?.vehicleApproved === true)
        bad('This driver profile is already verified.', 409);

      const documents = {}, documentUrls = {};
      const bucket = admin.storage().bucket(bucketName);
      for (const kind of ['selfie','car','identity','licence','address']) {
        const path = 'driverEnrollments/' + uid + '/' + submissionId + '/' + kind;
        // Paths are derived, not trusted from the browser.
        const file = bucket.file(path);
        let metadata;
        try { [metadata] = await file.getMetadata(); }
        catch (error) {
          if (error.code === 404) bad('Missing uploaded ' + kind + ' photo or document.');
          throw error;
        }
        const custom = metadata.metadata || {};
        if (custom.ownerUid !== uid || custom.enrollmentKind !== kind ||
            !metadata.size || Number(metadata.size) > 7*1024*1024)
          bad('Invalid ' + kind + ' document ownership.',403);
        const token = String(custom.firebaseStorageDownloadTokens || '').split(',')[0];
        if (!/^[0-9a-f-]{36}$/i.test(token)) bad('Invalid document authorization.',403);
        documents[kind] = path;
        documentUrls[kind] = 'https://firebasestorage.googleapis.com/v0/b/' +
          encodeURIComponent(bucketName) + '/o/' + encodeURIComponent(path) +
          '?alt=media&token=' + encodeURIComponent(token);
      }

      const vehiclePending = {
        type:clean(vehicle.type,35), make:clean(vehicle.make,80),
        model:clean(vehicle.model,80), colour:clean(vehicle.colour,40),
        registration:clean(vehicle.registration,20), year, seats
      };
      const banking = {
        accountHolder:clean(sourceBank.accountHolder,100),
        bank:clean(sourceBank.bank,80),
        accountNumber:sourceBank.accountNumber,
        branchCode:sourceBank.branchCode,
        accountType:clean(sourceBank.accountType,40)
      };
      const record = {
        version:2, status:'pending', authUid:uid, fullName,
        phone, phoneVerified:true, residentialAddress,
        vehicleMake:vehiclePending.make, vehicleModel:vehiclePending.model,
        vehicleColor:vehiclePending.colour, vehicleYear:year,
        vehicleReg:vehiclePending.registration, vehiclePending,
        profile_picture_url:documentUrls.selfie,
        profileImageUrl:documentUrls.selfie,vehiclePhoto:documentUrls.car,
        documents,documentUrls,references,banking, consent:true, submissionId,
        submittedAt:admin.database.ServerValue.TIMESTAMP
      };
      const result = await ref.transaction(old => old === null ? record : undefined,
        undefined, false);
      if (!result.committed) return res.status(200).json({
        ok:true, alreadySubmitted:true, status:result.snapshot.val()?.status || 'pending'
      });
      // Seed a locked/offline taxi record only. Review/admin approval is
      // strictly separate. Never override an already approved taxi.
      try {
        const current = (await admin.database().ref('taxis/' + uid).once('value')).val() || {};
        if (current.verificationStatus !== 'verified' && current.vehicleApproved !== true)
          await admin.database().ref('taxis/' + uid).update({
            name:fullName,fullName,phone,authUid:uid,userUid:uid,
            profile_picture_url:documentUrls.selfie,profileImageUrl:documentUrls.selfie,
            vehiclePhoto:documentUrls.car,vehicleMake:vehiclePending.make,
            vehicleModel:vehiclePending.model,vehicleColor:vehiclePending.colour,
            vehicleYear:year,vehicleReg:vehiclePending.registration,
            taxiRegistrationNumber:vehiclePending.registration,vehiclePending,
            vehicleApproved:false,vehicleApprovalStatus:'pending',
            verificationStatus:'pending',provisionalActivation:false,
            isOnline:false,isBroadcasting:false,isFull:false,enrollmentVersion:2,
            updatedAt:admin.database.ServerValue.TIMESTAMP
          });
      } catch (error) {
        console.warn('Driver taxi seed deferred to admin review:', error.code || error.message);
      }
      return res.status(200).json({ok:true,status:'pending'});
    } catch(error) {
      const status = error.httpStatus ||
        (/auth\/|invalid.*token|id-token/.test(String(error.code || '')) ? 401 : 500);
      if (status >= 500) console.error('Driver enrollment secure submit failed:',
        error.code || 'unknown',error.message);
      return res.status(status).json({error:status>=500 ?
        'Unable to save the application right now. Please try again.' : error.message});
    }
  };
}

module.exports = {makeEnrollmentSubmission};

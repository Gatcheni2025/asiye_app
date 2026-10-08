(() => {
    const form = document.getElementById('enrollmentForm');
    const status = document.getElementById('enrollmentStatus');
    const photos = {}, previews = {}, capturedDocuments = {};
    let stream, current, user, busy = false;
    const kinds = { selfie: 'Live face scan (required)', identity: 'ID or passport photo', car: 'Rear camera car photo' };
    const verifiedPhone = document.getElementById('verifiedPhone');
    const pendingPanel = document.getElementById('pendingPanel');
    const phoneNote = document.getElementById('phoneVerifiedNote');

    const nativeChannel = () => window.Asiye?.postMessage ? window.Asiye :
        (window.Android?.postMessage ? window.Android : null);
    let pendingNative = null;
    window.onNativeFaceCaptureSuccess = payload => pendingNative?.resolve(payload);
    window.onNativeFaceCaptureError = reason =>
        pendingNative?.reject(new Error(String(reason || 'Camera cancelled.')));

    const nativeCapture = purpose => new Promise((resolve, reject) => {
        const channel = nativeChannel();
        if (!channel || pendingNative) return reject(new Error('Asiye camera is unavailable.'));
        const timer = setTimeout(() => {
            pendingNative = null;
            reject(new Error('Camera did not return to Asiye. Please retry.'));
        }, 120000);
        pendingNative = {
            resolve: result => { clearTimeout(timer); pendingNative = null; resolve(result); },
            reject: error => { clearTimeout(timer); pendingNative = null; reject(error); }
        };
        try { channel.postMessage(JSON.stringify({ action: 'captureFacePhoto', purpose })); }
        catch (error) { pendingNative.reject(error); }
    });
    const nativeBlob = payload => {
        const data = String(payload?.dataUrl || '');
        const [header,base64] = data.split(',');
        if (!/^data:image\/(jpeg|png|webp);base64$/i.test(header) || !base64) {
            throw Error('Camera did not return a valid picture.');
        }
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: header.slice(5,-7) });
    };
    const stopCamera = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; document.getElementById('captureVideo').hidden = true; document.getElementById('takePhoto').hidden = true; document.getElementById('cancelCamera').hidden = true; };
    const savePhoto = (key, file) => {
        if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) throw Error('Use a JPG, PNG or WebP image under 10 MB.');
        photos[key] = file;
        if (previews[key]) URL.revokeObjectURL(previews[key]);
        previews[key] = URL.createObjectURL(file);
        document.getElementById(`preview-${key}`).src = previews[key];
        document.getElementById(`preview-${key}`).hidden = false;
    };
    for (const [key,label] of Object.entries(kinds)) {
        const row = document.createElement('div'); row.className = 'capture-row';
        row.innerHTML = `<strong>${label}</strong><br><button type="button">${key === 'selfie' ? 'Start live face scan' : 'Take picture'}</button><label>Or select a clear picture<input type="file" accept="image/jpeg,image/png,image/webp" capture="${key === 'selfie' ? 'user' : 'environment'}"></label><img id="preview-${key}" alt="${label} preview" hidden>`;
        row.querySelector('input').onchange = event => { try { savePhoto(key, event.target.files[0]); } catch(error) { status.textContent = error.message; } };
        row.querySelector('button').onclick = async () => {
            stopCamera(); current = key;
            try {
                // Installed app: live face scan uses the front camera; car
                // photo uses the dedicated rear camera with auto-return.
                if (nativeChannel()) {
                    const purpose = key === 'selfie' ? 'driver-enrollment-face' : key === 'identity' ? 'driver-identity' : 'driver-vehicle';
                    const result = await nativeCapture(purpose);
                    savePhoto(key, nativeBlob(result));
                    status.textContent = label + ' captured. Continue to the next step.';
                    return;
                }
                stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:key === 'selfie' ? 'user' : 'environment'},audio:false});
                const video = document.getElementById('captureVideo'); video.srcObject = stream; video.hidden = false;
                document.getElementById('takePhoto').hidden = false; document.getElementById('cancelCamera').hidden = false;
                video.scrollIntoView({block:'center'});
            } catch { status.textContent = 'Camera unavailable. Enable camera permission or use the device camera field.'; }
        };
        document.getElementById('capture-' + key).append(row);
    }
    const extraDocuments = {
        licence: { button:'captureLicence', preview:'licencePreview', status:'licenceStatus', purpose:'driver-licence' },
        address: { button:'captureAddressProof', preview:'addressProofPreview', status:'addressProofStatus', purpose:'driver-address-proof' }
    };
    for (const [kind, spec] of Object.entries(extraDocuments)) {
        const button = document.getElementById(spec.button);
        const progress = document.getElementById(spec.status);
        const preview = document.getElementById(spec.preview);
        button.onclick = async () => {
            button.disabled = true;
            progress.textContent = 'Opening document camera…';
            try {
                let photo;
                if (nativeChannel()) {
                    photo = nativeBlob(await nativeCapture(spec.purpose));
                } else {
                    // Browser: choose the camera-enabled file input as fallback.
                    form.elements[kind].click();
                    progress.textContent = 'Capture a clear photo and return to Asiye.';
                    return;
                }
                if (!photo || photo.size < 100) throw Error('Camera returned an empty picture.');
                capturedDocuments[kind] = new File([photo],kind+'.jpg',{type:photo.type});
                preview.src = URL.createObjectURL(photo);
                preview.hidden = false;
                progress.textContent = 'Picture captured. You can continue.';
            } catch(error) {
                progress.textContent = error.message || 'Unable to capture document. Retry.';
            } finally { button.disabled = false; }
        };
        form.elements[kind].addEventListener('change', event => {
            if (event.target.files?.length) {
                capturedDocuments[kind] = null;
                preview.hidden = true;
                progress.textContent = 'Document selected: '+event.target.files[0].name;
            }
        });
    }
    const readDataUrl = blob => new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read this document. Please recapture.'));
        reader.readAsDataURL(blob);
    });
    async function uploadDocument(user,submissionId,kind,blob) {
        const dataUrl = await readDataUrl(blob);
        const token = await user.getIdToken(true);
        const response = await fetch(
            'https://us-central1-asiye-80386.cloudfunctions.net/uploadDriverEnrollmentDocument',
            {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
             body:JSON.stringify({submissionId,kind,dataUrl})}
        );
        const result = await response.json().catch(()=>({}));
        if (!response.ok || !result.url || !result.storagePath) {
            const problem = response.status === 404
                ? 'Document upload service is not deployed (HTTP 404). Admin must deploy uploadDriverEnrollmentDocument.'
                : result.error || 'Document could not be uploaded. Retry this step.';
            throw new Error(problem);
        }
        return result;
    }
    for (let i=1;i<=3;i++) document.getElementById('referenceFields').insertAdjacentHTML('beforeend', `<div class="reference"><h3>Reference ${i}</h3><label>Full name<input name="refName${i}" maxlength="120" required></label><label>Phone number<input name="refPhone${i}" type="tel" maxlength="25" aria-describedby="refPhoneHelp${i}" required></label><p id="refPhoneHelp${i}" class="field-help">Example: 082 123 4567 or +27 82 123 4567.</p><label>Relationship<input name="refRelation${i}" maxlength="80" required></label></div>`);
    document.getElementById('cancelCamera').onclick = stopCamera;
    const steps = [...form.querySelectorAll('fieldset')];
    const titles = ['Verified phone', 'Face scan & ID', 'Car & details', 'Licence & address', 'References', 'Banking', 'Review'];
    const errorBox = document.getElementById('stepError');
    let step = 0, advancing = false;
    const showError = message => {
        errorBox.textContent = message; errorBox.hidden = false; errorBox.focus();
    };
    const review = () => {
        const target = document.getElementById('enrollmentReview');
        target.replaceChildren();
        const data = new FormData(form);
        const rows = [['Name', data.get('fullName')], ['Verified phone', data.get('phone')], ['Address', data.get('residentialAddress')], ['Vehicle type', data.get('vehicleType')], ['Vehicle make',data.get('vehicleMake')], ['Vehicle model',data.get('vehicleModel')], ['Vehicle colour',data.get('vehicleColor')], ['Vehicle year',data.get('vehicleYear')], ['Vehicle registration',data.get('vehicleReg')], ['Passenger seats',data.get('vehicleSeats')], ['Photos','Live selfie, car and ID/passport added'], ['Licence',data.get('licence')?.name], ['Address confirmation',data.get('address')?.name], ['Bank',data.get('bank')], ['Account holder',data.get('accountHolder')], ['Account number','•••• ' + String(data.get('accountNumber')).slice(-4)], ['Branch code',data.get('branchCode')], ['Account type',data.get('accountType')]];
        for (let i=1;i<=3;i++) rows.push([`Reference ${i}`,`${data.get(`refName${i}`)} · ${data.get(`refPhone${i}`)}`]);
        rows.forEach(([label,value])=>{ const row=document.createElement('p');const strong=document.createElement('strong');strong.textContent=label+': ';row.append(strong,document.createTextNode(String(value || 'Not provided')));target.append(row); });
    };
    const showStep = index => {
        stopCamera(); step=index;
        steps.forEach((panel,i)=>panel.hidden=i!==step);
        errorBox.hidden=true;
        document.getElementById('stepLabel').textContent=`Step ${step+1} of ${steps.length} · ${titles[step]}`;
        document.getElementById('stepProgress').value=step+1;
        document.getElementById('previousStep').hidden=step===0;
        document.getElementById('nextStep').hidden=step===steps.length-1;
        if(step===steps.length-1) review();
        const legend=steps[step].querySelector('legend');legend.tabIndex=-1;legend.focus();
    };
    const validateStep = async index => {
        for(const input of steps[index].querySelectorAll('input,select,textarea')) {
            input.setCustomValidity('');
            if (['fullName','vehicleMake','vehicleModel','vehicleColor','vehicleReg','accountHolder','bank'].includes(input.name) && input.value.trim().length < 2) {
                input.setCustomValidity('Please enter at least two characters for this detail.');
            } else
            if(input.name==='residentialAddress' && input.value.trim().length < 10) input.setCustomValidity('Enter your full residential address to match its proof.');
            else if(input.type==='tel' && !EnrollmentValidation.phone(input.value)) input.setCustomValidity('Enter a valid phone number, for example 082 123 4567 or +27 82 123 4567.');
            else if(input.required && input.type==='text' && !input.value.trim()) input.setCustomValidity('Please enter this detail.');
            else if(input.name==='vehicleYear' && (!/^\d{4}$/.test(input.value) || Number(input.value) < 1990 || Number(input.value) > new Date().getFullYear() + 1)) input.setCustomValidity('Enter a valid four-digit vehicle year.');
            else if(input.name==='vehicleSeats' && (!Number.isInteger(Number(input.value)) || Number(input.value)<1 || Number(input.value)>15)) input.setCustomValidity('Enter 1–15 passenger seats.');
            else if(input.name==='accountNumber' && !/^[0-9]{6,20}$/.test(input.value)) input.setCustomValidity('Enter 6 to 20 digits from your bank account number, without spaces.');
            else if(input.name==='branchCode' && !/^[0-9]{6}$/.test(input.value)) input.setCustomValidity('Enter your bank’s six-digit branch code.');
            if(!input.checkValidity()) { showStep(index);showError(input.validationMessage);input.reportValidity();return false; }
        }
        if (index === 0 && (!user?.phoneNumber || form.elements.phone.value !== user.phoneNumber)) {
            showStep(index);showError('Verify your mobile number using OTP before enrolling.');return false;
        }
        if(index===1 && (!photos.selfie || !photos.identity)) {
            showStep(index);showError('Complete your live face scan and add your ID or passport picture.');return false;
        }
        if(index===2 && !photos.car) { showStep(index);showError('Capture a clear picture of your car.');return false; }
        if(index===3) {
            for (const key of ['licence','address']) {
                const file=form.elements[key].files[0] || capturedDocuments[key];
                if(!await EnrollmentValidation.licenceType(file)) {
                    showStep(index);showError('Upload a clear ' + (key === 'licence' ? 'driver licence' : 'proof of address') + ' image or PDF under 10 MB.');return false;
                }
            }
        }
        if(index===4 && new Set([1,2,3].map(i=>EnrollmentValidation.phoneKey(form.elements[`refPhone${i}`].value))).size!==3) {
            showStep(index);showError('Use three different reference phone numbers.');return false;
        }
        return true;
    };
    form.addEventListener('input', event=>event.target.setCustomValidity?.(''));
    document.getElementById('previousStep').onclick=()=>{if(!busy && !advancing)showStep(Math.max(0,step-1));};
    const nextStep = async () => {
        if (busy || advancing) return;
        advancing = true;
        try { if (await validateStep(step)) showStep(Math.min(steps.length-1,step+1)); }
        finally { advancing = false; }
    };
    document.getElementById('nextStep').onclick=nextStep;
    showStep(0);
    document.getElementById('takePhoto').onclick = () => {
        const video = document.getElementById('captureVideo');
        if (!video.videoWidth) return;
        const key = current, canvas = document.createElement('canvas');
        const scale = Math.min(1,1600/video.videoWidth); canvas.width = video.videoWidth*scale; canvas.height = video.videoHeight*scale;
        canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
        canvas.toBlob(blob => { if(blob) savePhoto(key,blob); }, 'image/jpeg', .88); stopCamera();
    };
    const check = async () => {
        if (!user || busy) return;
        status.textContent = 'Checking registration and admin approval…';
        form.hidden = true;
        pendingPanel.hidden = true;
        try {
            const state = await AsiyeEnrollment.getStatus(user);
            if (state.state === 'approved') {
                status.textContent = 'Approved. Opening your Asiye driver dashboard…';
                window.location.replace('./index.html');
                return;
            }
            if (state.state === 'pending' || state.state === 'rejected') {
                const rejected = state.state === 'rejected';
                document.getElementById('pendingTitle').textContent = rejected
                    ? 'Your application needs attention'
                    : 'Registration submitted · Pending approval';
                document.getElementById('pendingDescription').textContent = rejected
                    ? state.reason + ' Contact Asiye Support. A new application cannot be started from here.'
                    : 'Your information and documents have been sent for review. Admin approval is required before you can drive. There is no need to register again.';
                document.getElementById('applicationReference').textContent =
                    'Application reference: ' + user.uid.slice(-8).toUpperCase();
                pendingPanel.hidden = false;
                status.textContent = rejected
                    ? 'Review outcome: changes required or rejected'
                    : 'Pending · Waiting for Asiye Admin verification';
                return;
            }
            if (state.state === 'new') {
                if (!user.phoneNumber) {
                    status.textContent = 'Your mobile number must be verified with an OTP before driver registration. Log out and sign in using your phone number.';
                    return;
                }
                verifiedPhone.value = user.phoneNumber;
                phoneNote.textContent = '✓ Verified by SMS OTP · ' + user.phoneNumber;
                form.hidden = false;
                status.textContent = 'Complete the seven steps once. Your application will then wait for administrator approval.';
                return;
            }
            status.textContent = 'Sign in using your verified mobile number.';
        } catch (error) {
            console.warn('Driver enrollment status read failed:', error.code || error.message);
            status.textContent = 'Unable to check your existing enrollment. Please retry while connected to the internet. Your registration has not been reset.';
        }
    };

    document.getElementById('refreshEnrollment').onclick = check;
    document.getElementById('checkStatusAgain').onclick = check;
    document.getElementById('logoutEnrollment').onclick = async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            stopCamera();
            await firebase.auth().signOut();
            ['driverId','userId','commuterId','authUid','userType',
                'driverPhone','driverName','currentRequestId'].forEach(key => {
                try { localStorage.removeItem(key); } catch (_) {}
            });
            window.location.replace('./login.html');
        } catch (error) {
            button.disabled = false;
            status.textContent = 'Unable to log out. Please check your connection and retry.';
        }
    };
    firebase.auth().onAuthStateChanged(value => {
        user = value;
        if (!user) {
            window.location.replace('./login.html');
            return;
        }
        verifiedPhone.value = user.phoneNumber || '';
        check();
    });
    form.onsubmit = async event => {
        event.preventDefault(); if (!user || busy) return;
        if (step < steps.length-1) { await nextStep(); return; }
        for(let i=0;i<steps.length;i++) if(!await validateStep(i))return;
        const data = new FormData(form),
            file = capturedDocuments.licence || form.elements.licence.files[0],
            addressFile = capturedDocuments.address || form.elements.address.files[0];
        const references = EnrollmentValidation.references(data);
        if (new Set(Object.values(references).map(ref=>EnrollmentValidation.phoneKey(ref.phone))).size !== 3) { status.textContent='Please provide three different reference phone numbers.'; return; }
        if (Object.keys(kinds).some(key=>!photos[key])) { status.textContent='Add your selfie, car photo, and ID/passport photo.'; return; }
        const licenceType = await EnrollmentValidation.licenceType(file);
        const addressType = await EnrollmentValidation.licenceType(addressFile);
        if (!licenceType || !addressType) {
            status.textContent = 'Upload both your licence and proof of address as images or PDFs under 10 MB.';
            return;
        }
        if (!user.phoneNumber || String(data.get('phone')) !== user.phoneNumber) {
            status.textContent = 'Please verify your mobile number with OTP first.';
            return;
        }
        // The enrollment write is create-once. Check it again before uploads
        // so a stale tab cannot restart an application already under review.
        try {
            const state = await AsiyeEnrollment.getStatus(user);
            if (state.state !== 'new') { await check(); return; }
        } catch (error) {
            status.textContent = 'Could not verify your enrollment state. Check the connection before trying again.';
            return;
        }
        busy = true; stopCamera(); document.getElementById('submitEnrollment').disabled = true;
        steps.forEach(panel=>panel.disabled=true);
        try {
            const documents = {};
            const documentUrls = {};
            const submissionId = crypto.randomUUID();
            for (const [key,blob] of Object.entries({...photos,licence:file,address:addressFile})) {
                status.textContent = `Uploading ${key} securely…`;
                const saved = await uploadDocument(user,submissionId,key,blob);
                documents[key] = saved.storagePath;
                documentUrls[key] = saved.url;
            }

            const vehiclePending = {
                type: String(data.get('vehicleType')),
                make: String(data.get('vehicleMake')).trim(),
                model: String(data.get('vehicleModel')).trim(),
                colour: String(data.get('vehicleColor')).trim(),
                year: Number(data.get('vehicleYear')),
                registration: String(data.get('vehicleReg')).trim(),
                seats: Number(data.get('vehicleSeats'))
            };

            const enrollmentRecord = {
                version: 2,
                status: 'pending',
                fullName: String(data.get('fullName')).trim(),
                phone: user.phoneNumber,
                phoneVerified: true,
                authUid: user.uid,
                residentialAddress: String(data.get('residentialAddress')).trim(),
                vehicleMake: vehiclePending.make,
                vehicleModel: vehiclePending.model,
                vehicleColor: vehiclePending.colour,
                vehicleYear: vehiclePending.year,
                vehicleReg: vehiclePending.registration,
                vehiclePending,
                profile_picture_url: documentUrls.selfie,
                profileImageUrl: documentUrls.selfie,
                vehiclePhoto: documentUrls.car,
                documents,
                documentUrls,
                references,
                banking: {
                    accountHolder: String(data.get('accountHolder')).trim(),
                    bank: String(data.get('bank')).trim(),
                    accountNumber: String(data.get('accountNumber')),
                    branchCode: String(data.get('branchCode')),
                    accountType: String(data.get('accountType'))
                },
                consent: true,
                submittedAt: firebase.database.ServerValue.TIMESTAMP
            };

            await firebase.database()
                .ref(`driverEnrollments/${user.uid}`)
                .set(enrollmentRecord);

            // Seed the driver's own taxi profile while keeping it locked
            // offline. Approval promotes these verified enrollment fields.
            try {
                await firebase.database()
                    .ref(`taxis/${user.uid}`)
                    .update({
                    name: enrollmentRecord.fullName,
                    fullName: enrollmentRecord.fullName,
                    phone: enrollmentRecord.phone,
                    authUid: user.uid,
                    userUid: user.uid,
                    profile_picture_url: documentUrls.selfie,
                    profileImageUrl: documentUrls.selfie,
                    vehiclePhoto: documentUrls.car,
                    vehicleMake: vehiclePending.make,
                    vehicleModel: vehiclePending.model,
                    vehicleColor: vehiclePending.colour,
                    vehicleYear: vehiclePending.year,
                    vehicleReg: vehiclePending.registration,
                    taxiRegistrationNumber: vehiclePending.registration,
                    vehiclePending,
                    vehicleApproved: false,
                    vehicleApprovalStatus: 'pending',
                    verificationStatus: 'pending',
                    provisionalActivation: false,
                    isOnline: false,
                    isBroadcasting: false,
                    isFull: false,
                    enrollmentVersion: 2,
                    updatedAt: firebase.database.ServerValue.TIMESTAMP
                });
            } catch (profileError) {
                // The enrollment was already saved. Admin approval can create
                // the taxi profile using Admin SDK; never misreport a successful
                // one-time submission as failed or offer the form again.
                console.warn('Driver taxi profile seed deferred to admin review:',
                    profileError.code || 'unknown');
            }

            // Show the saved application state. The form cannot be reopened.
            busy = false;
            form.reset();
            form.hidden = true;
            await check();

        } catch (error) {
            if (error.code === 'storage/unauthorized') {
                status.textContent = 'Document upload authorization failed. Please sign out and sign in with OTP again.';
            } else if (/permission.?denied/i.test(String(error.code || error.message))) {
                status.textContent = 'The enrollment record could not be saved. Check Realtime Database enrollment permissions or refresh to see whether it was already submitted. Your entered details are still here.';
            } else {
                status.textContent = error?.message || 'Submission failed. Your entered details are still here. Check your connection and retry.';
            }
            console.warn('Enrollment submission failed:', error.code || 'unknown');
        }
        finally { busy=false; steps.forEach(panel=>panel.disabled=false); document.getElementById('submitEnrollment').disabled=false; }
    };
    window.addEventListener('pagehide',()=>{stopCamera();Object.values(previews).forEach(url=>URL.revokeObjectURL(url));});
})();

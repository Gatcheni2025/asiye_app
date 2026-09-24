(() => {
    const form = document.getElementById('enrollmentForm');
    const status = document.getElementById('enrollmentStatus');
    const photos = {}, previews = {};
    let stream, current, user, busy = false;
    const kinds = { selfie: 'Camera selfie', car: 'Photo of your car', identity: 'ID or passport copy' };
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
        row.innerHTML = `<strong>${label}</strong><br><button type="button">Open camera</button><label>Or use device camera / select a clear photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="${key === 'selfie' ? 'user' : 'environment'}"></label><img id="preview-${key}" alt="${label} preview" hidden>`;
        row.querySelector('input').onchange = event => { try { savePhoto(key, event.target.files[0]); } catch(error) { status.textContent = error.message; } };
        row.querySelector('button').onclick = async () => {
            stopCamera(); current = key;
            try {
                stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:key === 'selfie' ? 'user' : 'environment'},audio:false});
                const video = document.getElementById('captureVideo'); video.srcObject = stream; video.hidden = false;
                document.getElementById('takePhoto').hidden = false; document.getElementById('cancelCamera').hidden = false;
                video.scrollIntoView({block:'center'});
            } catch { status.textContent = 'Camera unavailable. Enable camera permission or use the device camera field.'; }
        };
        document.getElementById('captureFields').append(row);
    }
    for (let i=1;i<=3;i++) document.getElementById('referenceFields').insertAdjacentHTML('beforeend', `<div class="reference"><h3>Reference ${i}</h3><label>Full name<input name="refName${i}" maxlength="120" required></label><label>Phone number<input name="refPhone${i}" type="tel" maxlength="25" aria-describedby="refPhoneHelp${i}" required></label><p id="refPhoneHelp${i}" class="field-help">Example: 082 123 4567 or +27 82 123 4567.</p><label>Relationship<input name="refRelation${i}" maxlength="80" required></label></div>`);
    document.getElementById('cancelCamera').onclick = stopCamera;
    const steps = [...form.querySelectorAll('fieldset')];
    const titles = ['Photos', 'Driver’s licence', 'Your details', 'References', 'Banking details', 'Review'];
    const errorBox = document.getElementById('stepError');
    let step = 0, advancing = false;
    const showError = message => {
        errorBox.textContent = message; errorBox.hidden = false; errorBox.focus();
    };
    const review = () => {
        const target = document.getElementById('enrollmentReview');
        target.replaceChildren();
        const data = new FormData(form);
        const rows = [['Name', data.get('fullName')], ['Phone', data.get('phone')], ['Vehicle make',data.get('vehicleMake')], ['Vehicle model',data.get('vehicleModel')], ['Vehicle colour',data.get('vehicleColor')], ['Vehicle year',data.get('vehicleYear')], ['Vehicle registration',data.get('vehicleReg')], ['Photos','Selfie, car and ID/passport added'], ['Licence',data.get('licence')?.name], ['Bank',data.get('bank')], ['Account holder',data.get('accountHolder')], ['Account number','•••• ' + String(data.get('accountNumber')).slice(-4)], ['Branch code',data.get('branchCode')], ['Account type',data.get('accountType')]];
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
        for(const input of steps[index].querySelectorAll('input,select')) {
            input.setCustomValidity('');
            if (['fullName','vehicleMake','vehicleModel','vehicleColor','vehicleReg','accountHolder','bank'].includes(input.name) && input.value.trim().length < 2) {
                input.setCustomValidity('Please enter at least two characters for this detail.');
            } else
            if(input.type==='tel' && !EnrollmentValidation.phone(input.value)) input.setCustomValidity('Enter a valid phone number, for example 082 123 4567 or +27 82 123 4567.');
            else if(input.required && input.type==='text' && !input.value.trim()) input.setCustomValidity('Please enter this detail.');
            else if(input.name==='vehicleYear' && (!/^\d{4}$/.test(input.value) || Number(input.value) < 1990 || Number(input.value) > 2027)) input.setCustomValidity('Enter a valid four-digit vehicle year.');
            else if(input.name==='accountNumber' && !/^[0-9]{6,20}$/.test(input.value)) input.setCustomValidity('Enter 6 to 20 digits from your bank account number, without spaces.');
            else if(input.name==='branchCode' && !/^[0-9]{6}$/.test(input.value)) input.setCustomValidity('Enter your bank’s six-digit branch code.');
            if(!input.checkValidity()) { showStep(index);showError(input.validationMessage);input.reportValidity();return false; }
        }
        if(index===0 && Object.keys(kinds).some(key=>!photos[key])) { showStep(index);showError('Add all three photos: your selfie, your car, and your ID or passport.');return false; }
        if(index===1) {
            const file=form.elements.licence.files[0];
            if(!await EnrollmentValidation.licenceType(file)) { showStep(index);showError('Choose your licence as a PDF, JPG, PNG or WebP file, no larger than 10 MB. Make sure all details are readable.');return false; }
        }
        if(index===3 && new Set([1,2,3].map(i=>EnrollmentValidation.phoneKey(form.elements[`refPhone${i}`].value))).size!==3) { showStep(index);showError('Use three different reference phone numbers. The local and +27 versions of a number count as the same person.');return false; }
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
        try {
            const [application, approval] = await Promise.all(['driverEnrollments','driverApprovals'].map(node => firebase.database().ref(`${node}/${user.uid}`).once('value')));
            if (approval.val()?.status === 'approved') { status.textContent = 'Verified. Sign in to start driving.'; form.hidden = true; return; }
            if (application.exists()) { status.textContent = approval.val()?.status === 'rejected' ? 'Your application was not approved. Contact Asiye support for the review outcome.' : 'Application submitted. Waiting for verification. You cannot start driving yet.'; form.hidden = true; return; }
            status.textContent = 'Complete all sections below to apply.'; form.hidden = false;
        } catch (error) {
            const denied = /permission.?denied/i.test(String(error.code || error.message));
            status.textContent = denied
                ? 'Enrollment access is not configured. The administrator must publish Realtime Database rules for driverEnrollments and driverApprovals, then you can retry.'
                : 'Enrollment could not load. Check your connection, then retry.';
            console.warn('Enrollment database read failed:', error.code || 'unknown');
            form.hidden = true;
        }
    };
    document.getElementById('refreshEnrollment').onclick = check;
    firebase.auth().onAuthStateChanged(value => { user = value; if (!user) { window.location.replace('./login.html'); return; } check(); });
    form.onsubmit = async event => {
        event.preventDefault(); if (!user || busy) return;
        if (step < steps.length-1) { await nextStep(); return; }
        for(let i=0;i<steps.length;i++) if(!await validateStep(i))return;
        const data = new FormData(form), file = data.get('licence');
        const references = EnrollmentValidation.references(data);
        if (new Set(Object.values(references).map(ref=>EnrollmentValidation.phoneKey(ref.phone))).size !== 3) { status.textContent='Please provide three different reference phone numbers.'; return; }
        if (Object.keys(kinds).some(key=>!photos[key])) { status.textContent='Add your selfie, car photo, and ID/passport photo.'; return; }
        const licenceType = await EnrollmentValidation.licenceType(file);
        if (!licenceType) { status.textContent='Upload your licence as a PDF, JPG, PNG or WebP file, no larger than 10 MB.'; return; }
        busy = true; stopCamera(); document.getElementById('submitEnrollment').disabled = true;
        steps.forEach(panel=>panel.disabled=true);
        try {
            const documents = {};
            const documentUrls = {};
            const submissionId = crypto.randomUUID();
            for (const [key,blob] of Object.entries({...photos,licence:file})) {
                status.textContent = `Uploading ${key}…`;
                const path = `driverEnrollments/${user.uid}/${submissionId}/${key}`;
                const upload = await firebase.storage().ref(path).put(
                    blob,
                    {contentType:key === 'licence' ? licenceType : blob.type}
                );
                documents[key] = path;
                documentUrls[key] = await upload.ref.getDownloadURL();
            }

            const vehiclePending = {
                type: 'ehailing',
                make: String(data.get('vehicleMake')).trim(),
                model: String(data.get('vehicleModel')).trim(),
                colour: String(data.get('vehicleColor')).trim(),
                year: Number(data.get('vehicleYear')),
                registration: String(data.get('vehicleReg')).trim(),
                seats: 4
            };

            await firebase.database().ref(`driverEnrollments/${user.uid}`).set({
                version: 2,
                status: 'pending',
                fullName: String(data.get('fullName')).trim(),
                phone: String(data.get('phone')).trim(),
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
            });
            form.reset(); form.hidden = true; status.textContent='Application submitted. Waiting for verification. We will review your details before you can start driving.';
        } catch (error) {
            if (error.code === 'storage/unauthorized') {
                status.textContent = 'Document upload is not permitted. The administrator must publish the enrollment Storage rules. Your entered details are still here.';
            } else if (/permission.?denied/i.test(String(error.code || error.message))) {
                status.textContent = 'The enrollment record could not be saved. Check Realtime Database enrollment permissions or refresh to see whether it was already submitted. Your entered details are still here.';
            } else {
                status.textContent = 'Submission failed. Your entered details are still here. Check your connection and try again.';
            }
            console.warn('Enrollment submission failed:', error.code || 'unknown');
        }
        finally { busy=false; steps.forEach(panel=>panel.disabled=false); document.getElementById('submitEnrollment').disabled=false; }
    };
    window.addEventListener('pagehide',()=>{stopCamera();Object.values(previews).forEach(url=>URL.revokeObjectURL(url));});
})();

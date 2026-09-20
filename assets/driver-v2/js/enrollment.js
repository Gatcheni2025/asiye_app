(() => {
    const form = document.getElementById('enrollmentForm');
    const status = document.getElementById('enrollmentStatus');
    const photos = {}, previews = {};
    let licenceScan = null;
    let uploadedSelfieUrl = null;
    let stream, current, user, busy = false;
    const kinds = { selfie: 'Selfie scan', car: 'Vehicle scan', identity: 'ID / passport scan' };
    const stopCamera = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; document.getElementById('captureVideo').hidden = true; document.getElementById('takePhoto').hidden = true; document.getElementById('cancelCamera').hidden = true; };
    const savePhoto = (key, file) => {
        if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
            throw Error('The scan must be a clear JPG, PNG or WebP image under 10 MB.');
        }

        if (key === 'licence') {
            licenceScan = file;
        } else {
            photos[key] = file;
        }

        if (previews[key]) URL.revokeObjectURL(previews[key]);
        previews[key] = URL.createObjectURL(file);

        const preview = document.getElementById(`preview-${key}`);
        if (preview) {
            preview.src = previews[key];
            preview.hidden = false;
        }
    };

    const fileFromNativeScan = async result => {
        if (!window.AsiyePhpImageUpload) {
            throw Error(
                'Image upload service is unavailable.'
            );
        }

        return AsiyePhpImageUpload
            .toBlob(
                result
            );
    };

    const openWebCameraFallback = async key => {
        stopCamera();
        current = key;

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode:
                    key === 'selfie'
                        ? 'user'
                        : 'environment'
            },
            audio: false
        });

        const video = document.getElementById('captureVideo');
        video.srcObject = stream;
        video.hidden = false;

        document.getElementById('takePhoto').hidden = false;
        document.getElementById('cancelCamera').hidden = false;

        video.scrollIntoView({ block: 'center' });
    };

    const openScan = async key => {
        status.textContent =
            key === 'selfie'
                ? 'Opening live face scan…'
                : key === 'licence'
                    ? 'Opening licence scanner…'
                    : `Opening ${kinds[key] || 'camera scan'}…`;

        try {
            /*
             * A selfie is not a file upload. Keep the user inside
             * Asiye, show the live front camera with a face guide,
             * capture the face, and save it to PHP immediately.
             */
            if (key === 'selfie') {
                if (!user?.uid) {
                    throw Error(
                        'Your driver account is still loading.'
                    );
                }

                if (!window.AsiyePhpImageUpload) {
                    throw Error(
                        'Image upload service is unavailable.'
                    );
                }

                let blob = null;

                /*
                 * In the installed app, use the Flutter native front
                 * camera. It opens Camera directly and does not offer
                 * a gallery/file picker for the selfie.
                 */
                if (
                    window.AsiyeNativeBridge &&
                    typeof AsiyeNativeBridge.scanImage ===
                        'function'
                ) {
                    const nativeResult =
                        await AsiyeNativeBridge
                            .scanImage({
                                purpose:
                                    'driver-profile',
                                facing:
                                    'front'
                            });

                    if (!nativeResult) {
                        status.textContent =
                            'Camera cancelled. You can try again.';

                        return;
                    }

                    blob =
                        await fileFromNativeScan(
                            nativeResult
                        );

                } else if (
                    window.AsiyeFaceScanner
                ) {
                    const result =
                        await AsiyeFaceScanner
                            .open({
                                title:
                                    'Driver face scan',
                                subtitle:
                                    'Centre your face inside the guide. Move naturally and smile when prompted.'
                            });

                    blob =
                        result?.blob ||
                        null;
                } else {
                    throw Error(
                        'Camera service is unavailable in this build.'
                    );
                }

                if (!blob) {
                    status.textContent =
                        'No face photo was captured. Try again.';

                    return;
                }

                savePhoto(
                    key,
                    blob
                );

                status.textContent =
                    'Photo captured. Saving profile picture…';

                const uploaded =
                    await AsiyePhpImageUpload
                        .upload(
                            blob,
                            {
                                userId:
                                    user.uid,
                                purpose:
                                    'driver-profile',
                                filename:
                                    'driver-profile.jpg'
                            }
                        );

                uploadedSelfieUrl =
                    uploaded.url;

                try {
                    await firebase.auth()
                        .currentUser
                        ?.updateProfile?.({
                            photoURL:
                                uploadedSelfieUrl
                        });
                } catch (error) {
                    console.warn(
                        'Driver Auth profile photo update skipped:',
                        error
                    );
                }

                status.textContent =
                    'Profile photo saved. It will be used after your driver application is approved.';

                return;
            }

            if (window.AsiyeNativeBridge) {
                const result =
                    await AsiyeNativeBridge.scanImage({
                        purpose: `driver-enrollment-${key}`,
                        facing:
                            key === 'selfie'
                                ? 'front'
                                : 'rear'
                    });

                if (!result) {
                    status.textContent =
                        'Scan cancelled. You can try again.';
                    return;
                }

                const file =
                    await fileFromNativeScan(result);

                savePhoto(key, file);

                status.textContent =
                    key === 'licence'
                        ? 'Driver’s licence scan captured.'
                        : `${kinds[key]} captured.`;

                return;
            }

            await openWebCameraFallback(key);
        } catch (error) {
            console.warn('Image scan failed:', error);
            status.textContent =
                error?.message ||
                'Camera unavailable. Check camera permission and try again.';
        }
    };

    for (const [key, label] of Object.entries(kinds)) {
        const row = document.createElement('div');
        row.className = 'capture-row';

        row.innerHTML = `
            <strong>${label}</strong>
            <p class="field-help">
                ${key === 'selfie'
                    ? 'Face the camera in good light and keep your full face visible.'
                    : key === 'car'
                        ? 'Keep the full vehicle visible inside the camera frame.'
                        : 'Place the whole document inside the frame with readable details.'}
            </p>
            <button type="button" class="scan-action">
                Scan now
            </button>
            <img
                id="preview-${key}"
                class="scan-preview"
                alt="${label} preview"
                hidden
            >
        `;

        row.querySelector('button').onclick =
            () => openScan(key);

        document.getElementById('captureFields').append(row);
    }

    document.getElementById('scanLicence').onclick =
        () => openScan('licence');
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
        const rows = [['Name', data.get('fullName')], ['Phone', data.get('phone')], ['Vehicle type',data.get('vehicleType')], ['Vehicle make',data.get('vehicleMake')], ['Vehicle model',data.get('vehicleModel')], ['Vehicle colour',data.get('vehicleColor')], ['Passenger seats',data.get('vehicleSeats')], ['Vehicle registration',data.get('vehicleReg')], ['Scans','Selfie, vehicle and ID/passport captured'], ['Licence',licenceScan ? 'Scanned' : 'Not scanned'], ['Bank',data.get('bank')], ['Account holder',data.get('accountHolder')], ['Account number','•••• ' + String(data.get('accountNumber')).slice(-4)], ['Branch code',data.get('branchCode')], ['Account type',data.get('accountType')]];
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
            if (['fullName','vehicleType','vehicleMake','vehicleModel','vehicleColor','vehicleReg','accountHolder','bank'].includes(input.name) && input.value.trim().length < 2) {
                input.setCustomValidity('Please enter at least two characters for this detail.');
            } else
            if(input.type==='tel' && !EnrollmentValidation.phone(input.value)) input.setCustomValidity('Enter a valid phone number, for example 082 123 4567 or +27 82 123 4567.');
            else if(input.required && input.type==='text' && !input.value.trim()) input.setCustomValidity('Please enter this detail.');
            else if(input.name==='accountNumber' && !/^[0-9]{6,20}$/.test(input.value)) input.setCustomValidity('Enter 6 to 20 digits from your bank account number, without spaces.');
            else if(input.name==='vehicleSeats' && (!Number.isInteger(Number(input.value)) || Number(input.value) < 1 || Number(input.value) > 15)) input.setCustomValidity('Passenger seats must be a whole number between 1 and 15.');
            else if(input.name==='branchCode' && !/^[0-9]{6}$/.test(input.value)) input.setCustomValidity('Enter your bank’s six-digit branch code.');
            if(!input.checkValidity()) { showStep(index);showError(input.validationMessage);input.reportValidity();return false; }
        }
        if(index===0 && Object.keys(kinds).some(key=>!photos[key])) { showStep(index);showError('Scan all three items: your selfie, your vehicle, and your ID or passport.');return false; }
        if(index===1 && !licenceScan) { showStep(index);showError('Scan your driver’s licence before continuing.');return false; }
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
            if (approval.val()?.status === 'approved' && Number(approval.val()?.version) === 1) {
                status.textContent = 'Verified. Opening your driver dashboard…';
                form.hidden = true;

                const activated = await AsiyeEnrollment.activateApprovedDriver();

                if (!activated) {
                    status.textContent = 'Verified. We are linking your driver profile. Tap “Check verification status” to retry.';
                }

                return;
            }
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
    let approvalRef = null;
    let approvalListener = null;

    firebase.auth().onAuthStateChanged(value => {
        user = value;

        if (approvalRef && approvalListener) {
            approvalRef.off('value', approvalListener);
            approvalRef = null;
            approvalListener = null;
        }

        if (!user) {
            window.location.replace('./login.html');
            return;
        }

        approvalRef = firebase.database().ref(`driverApprovals/${user.uid}`);
        approvalListener = approvalRef.on('value', snapshot => {
            const approval = snapshot.val();

            if (
                approval?.status === 'approved' &&
                Number(approval.version) === 1
            ) {
                check();
            }
        });

        check();
    });
    form.onsubmit = async event => {
        event.preventDefault(); if (!user || busy) return;
        if (step < steps.length-1) { await nextStep(); return; }
        for(let i=0;i<steps.length;i++) if(!await validateStep(i))return;
        const data = new FormData(form);
        const references = EnrollmentValidation.references(data);
        if (new Set(Object.values(references).map(ref=>EnrollmentValidation.phoneKey(ref.phone))).size !== 3) { status.textContent='Please provide three different reference phone numbers.'; return; }
        if (Object.keys(kinds).some(key=>!photos[key])) { status.textContent='Scan your selfie, vehicle, and ID/passport before submitting.'; return; }
        if (!licenceScan) { status.textContent='Scan your driver’s licence before submitting.'; return; }
        busy = true; stopCamera(); document.getElementById('submitEnrollment').disabled = true;
        steps.forEach(panel=>panel.disabled=true);
        try {
            if (!window.AsiyePhpImageUpload) {
                throw Error(
                    'Image upload service is unavailable.'
                );
            }

            const documents = {};

            for (
                const [key, blob]
                of Object.entries({
                    ...photos,
                    licence:
                        licenceScan
                })
            ) {
                if (
                    key === 'selfie' &&
                    uploadedSelfieUrl
                ) {
                    documents[key] =
                        uploadedSelfieUrl;

                    continue;
                }

                status.textContent =
                    `Uploading ${key} scan…`;

                const uploaded =
                    await AsiyePhpImageUpload.upload(
                        blob,
                        {
                            userId:
                                user.uid,
                            purpose:
                                `driver-enrollment-${key}`,
                            filename:
                                `driver-${key}.jpg`
                        }
                    );

                documents[key] =
                    uploaded.url;
            }

            await firebase
                .database()
                .ref(
                    `driverEnrollments/${user.uid}`
                )
                .set({
                    version: 1,
                    status: 'pending',
                    fullName:
                        String(
                            data.get('fullName')
                        ).trim(),
                    phone:
                        String(
                            data.get('phone')
                        ).trim(),
                    vehicleType:
                        String(
                            data.get('vehicleType')
                        ).trim(),
                    vehicleMake:
                        String(
                            data.get('vehicleMake')
                        ).trim(),
                    vehicleModel:
                        String(
                            data.get('vehicleModel')
                        ).trim(),
                    vehicleColor:
                        String(
                            data.get('vehicleColor')
                        ).trim(),
                    vehicleSeats:
                        Number(
                            data.get('vehicleSeats')
                        ),
                    vehicleReg:
                        String(
                            data.get('vehicleReg')
                        ).trim(),
                    vehiclePending: {
                        type:
                            String(
                                data.get('vehicleType')
                            ).trim(),
                        make:
                            String(
                                data.get('vehicleMake')
                            ).trim(),
                        model:
                            String(
                                data.get('vehicleModel')
                            ).trim(),
                        colour:
                            String(
                                data.get('vehicleColor')
                            ).trim(),
                        seats:
                            Number(
                                data.get('vehicleSeats')
                            ),
                        registration:
                            String(
                                data.get('vehicleReg')
                            ).trim(),
                        submittedAt:
                            firebase
                                .database
                                .ServerValue
                                .TIMESTAMP
                    },
                    vehicleApprovalStatus:
                        'pending',
                    profile_picture_url:
                        documents.selfie ||
                        '',
                    vehiclePhoto:
                        documents.car ||
                        '',
                    documents,
                    references,
                    banking: {
                        accountHolder:
                            String(
                                data.get(
                                    'accountHolder'
                                )
                            ).trim(),
                        bank:
                            String(
                                data.get(
                                    'bank'
                                )
                            ).trim(),
                        accountNumber:
                            String(
                                data.get(
                                    'accountNumber'
                                )
                            ),
                        branchCode:
                            String(
                                data.get(
                                    'branchCode'
                                )
                            ),
                        accountType:
                            String(
                                data.get(
                                    'accountType'
                                )
                            )
                    },
                    consent: true,
                    submittedAt:
                        firebase
                            .database
                            .ServerValue
                            .TIMESTAMP
                });
            form.reset(); form.hidden = true; status.textContent='Application submitted. Waiting for verification. We will review your details before you can start driving.';
        } catch (error) {
            if (/permission.?denied/i.test(String(error.code || error.message))) {
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

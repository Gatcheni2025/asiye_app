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
    for (let i=1;i<=3;i++) document.getElementById('referenceFields').insertAdjacentHTML('beforeend', `<div class="reference"><h3>Reference ${i}</h3><label>Full name<input name="refName${i}" maxlength="120" required></label><label>Phone number<input name="refPhone${i}" type="tel" pattern="[+0-9 ()-]{7,25}" required></label><label>Relationship<input name="refRelation${i}" maxlength="80" required></label></div>`);
    document.getElementById('cancelCamera').onclick = stopCamera;
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
            if (approval.val()?.status === 'approved' && approval.val()?.version === 1) { status.textContent = 'Verified. Sign in to start driving.'; form.hidden = true; return; }
            if (application.exists()) { status.textContent = approval.val()?.status === 'rejected' ? 'Your application was not approved. Contact Asiye support for the review outcome.' : 'Application submitted. Waiting for verification. You cannot start driving yet.'; form.hidden = true; return; }
            status.textContent = 'Complete all sections below to apply.'; form.hidden = false;
        } catch { status.textContent = 'Enrollment could not load. Check your connection and enrollment access, then retry.'; form.hidden = true; }
    };
    document.getElementById('refreshEnrollment').onclick = check;
    firebase.auth().onAuthStateChanged(value => { user = value; if (!user) { window.location.replace('./login.html'); return; } check(); });
    form.onsubmit = async event => {
        event.preventDefault(); if (!user || busy || !form.reportValidity()) return;
        const data = new FormData(form), file = data.get('licence');
        const references = [1,2,3].map(i=>({name:String(data.get(`refName${i}`)).trim(),phone:String(data.get(`refPhone${i}`)).trim(),relationship:String(data.get(`refRelation${i}`)).trim()}));
        if (new Set(references.map(ref=>ref.phone.replace(/\D/g,''))).size !== 3) { status.textContent='Please provide three different reference phone numbers.'; return; }
        if (Object.keys(kinds).some(key=>!photos[key])) { status.textContent='Add your selfie, car photo, and ID/passport photo.'; return; }
        if (!file || file.type !== 'application/pdf' || file.size > 10*1024*1024 || new TextDecoder().decode(await file.slice(0,5).arrayBuffer()) !== '%PDF-') { status.textContent='Upload a valid licence PDF under 10 MB.'; return; }
        busy = true; stopCamera(); document.getElementById('submitEnrollment').disabled = true;
        try {
            const documents = {};
            const submissionId = crypto.randomUUID();
            for (const [key,blob] of Object.entries({...photos,licence:file})) {
                status.textContent = `Uploading ${key}…`;
                const path = `driverEnrollments/${user.uid}/${submissionId}/${key}`;
                await firebase.storage().ref(path).put(blob,{contentType:blob.type}); documents[key]=path;
            }
            await firebase.database().ref(`driverEnrollments/${user.uid}`).set({ version:1, status:'pending', fullName:String(data.get('fullName')).trim(),phone:String(data.get('phone')).trim(),vehicleReg:String(data.get('vehicleReg')).trim(),documents,references,banking:{accountHolder:String(data.get('accountHolder')).trim(),bank:String(data.get('bank')).trim(),accountNumber:String(data.get('accountNumber')),branchCode:String(data.get('branchCode')),accountType:String(data.get('accountType'))},consent:true,submittedAt:firebase.database.ServerValue.TIMESTAMP });
            form.reset(); form.hidden = true; status.textContent='Application submitted. Waiting for verification. We will review your details before you can start driving.';
        } catch { status.textContent='Submission failed. Your entered details are still here. Check your connection and try again.'; }
        finally { busy=false; document.getElementById('submitEnrollment').disabled=false; }
    };
    window.addEventListener('pagehide',()=>{stopCamera();Object.values(previews).forEach(url=>URL.revokeObjectURL(url));});
})();

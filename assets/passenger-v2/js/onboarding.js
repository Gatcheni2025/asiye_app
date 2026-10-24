/* One-time live photo at booking. A camera preview is never a saved capture. */
(() => {
    'use strict';
    function createSession() {
        let photo = '', phase = 'idle';
        return {
            get photo() { return photo; }, get phase() { return phase; },
            get canSave() { return phase === 'captured' && Boolean(photo); },
            opening() { photo = ''; phase = 'opening'; },
            live() { if (phase === 'opening') phase = 'live'; },
            captured(value) {
                if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(String(value || '')))
                    throw new Error('No picture was captured. Please try again.');
                photo = value; phase = 'captured';
            },
            saving() { if (!this.canSave) throw new Error('Capture your picture first.'); phase = 'saving'; },
            retry() { if (phase === 'saving') phase = 'captured'; },
            saved() { if (phase !== 'saving') throw new Error('Picture has not been saved.'); phase = 'saved'; },
            cancel() { photo = ''; phase = 'cancelled'; }
        };
    }
    let active = null;
    function open({name = '', save}) {
        if (active) return active;
        const task = new Promise((resolve, reject) => {
            const session = createSession();
            const overlay = document.createElement('div');
            overlay.className = 'passenger-face-overlay';
            overlay.innerHTML = `<section class="passenger-face-card" role="dialog" aria-modal="true" aria-labelledby="bookingFaceTitle">
                <h2 id="bookingFaceTitle">A picture before your first booking</h2>
                <p>Your driver will use this picture to recognise you. Take a clear picture with your front camera. It is saved to your Asiye profile.</p>
                <label>Your name<input data-face-name autocomplete="name" maxlength="100"></label>
                <video data-face-video autoplay muted playsinline hidden></video>
                <img data-face-preview alt="Your captured picture" hidden>
                <p data-face-status role="status" aria-live="polite">Open the camera, then tap Take picture.</p>
                <button type="button" data-face-open>Open front camera</button>
                <button type="button" data-face-shutter hidden disabled>Take picture</button>
                <button type="button" data-face-save disabled>Save picture &amp; continue booking</button>
                <button type="button" data-face-cancel>Cancel booking</button>
            </section>`;
            document.body.appendChild(overlay);
            const el = key => overlay.querySelector(`[data-face-${key}]`);
            const input = el('name'), video = el('video'), preview = el('preview');
            const status = el('status'), shutter = el('shutter'), saveButton = el('save'), openButton = el('open');
            input.value = name;
            let stream = null, closed = false;
            const previousFocus = document.activeElement;
            const stop = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null; video.hidden = true; shutter.hidden = true; shutter.disabled = true; };
            const cleanup = () => { closed = true; stop(); overlay.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('pagehide', cancel); previousFocus?.focus?.(); };
            const cancel = () => {
                session.cancel(); cleanup();
                const error = new Error('Booking cancelled. Your route and quote are still available.');
                error.code = 'booking-face-cancelled'; reject(error);
            };
            const onKey = event => {
                if (event.key === 'Escape') { event.preventDefault(); cancel(); }
                if (event.key === 'Tab') {
                    const buttons = [...overlay.querySelectorAll('button,input')].filter(node => !node.hidden && !node.disabled);
                    const first = buttons[0], last = buttons[buttons.length - 1];
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                }
            };
            document.addEventListener('keydown', onKey); window.addEventListener('pagehide', cancel);
            el('cancel').onclick = cancel;
            const captured = dataUrl => {
                session.captured(dataUrl); stop(); preview.src = dataUrl; preview.hidden = false;
                status.textContent = 'Picture captured. Check it, then save to continue your booking.';
                saveButton.disabled = false; openButton.disabled = false; openButton.textContent = 'Retake picture';
            };
            shutter.onclick = () => {
                if (session.phase !== 'live' || video.videoWidth < 100 || video.videoHeight < 100) return;
                const canvas = document.createElement('canvas');
                const side = Math.min(video.videoWidth, video.videoHeight);
                canvas.width = canvas.height = Math.min(768, side);
                canvas.getContext('2d').drawImage(video, (video.videoWidth-side)/2, (video.videoHeight-side)/2, side, side, 0, 0, canvas.width, canvas.height);
                captured(canvas.toDataURL('image/jpeg', .8));
            };
            openButton.onclick = async () => {
                session.opening(); stop(); preview.hidden = true;
                openButton.disabled = true; saveButton.disabled = true;
                status.textContent = 'Opening front camera…';
                try {
                    if ((window.Asiye || window.Android)?.postMessage) {
                        const result = await window.AsiyeFaceCapture.capture('passenger-profile');
                        if (!closed) captured(result?.dataUrl);
                    } else {
                        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable. Use HTTPS and allow camera access.');
                        const requested = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user', width: {ideal: 720}}, audio: false});
                        if (closed) { requested.getTracks().forEach(track => track.stop()); return; }
                        stream = requested; video.srcObject = stream; video.hidden = false;
                        await video.play();
                        if (closed) return;
                        await new Promise((ready, fail) => {
                            if (video.videoWidth >= 100) return ready();
                            const timer = setTimeout(() => fail(new Error('Camera did not start. Please try again.')), 12000);
                            video.onloadedmetadata = () => { clearTimeout(timer); ready(); };
                            video.onerror = () => { clearTimeout(timer); fail(new Error('Camera did not start.')); };
                        });
                        if (closed) return;
                        session.live(); shutter.hidden = false; shutter.disabled = false;
                        status.textContent = 'Centre your face, then tap Take picture.'; shutter.focus();
                    }
                } catch (error) {
                    stop();
                    if (!closed) { status.textContent = error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera, then try again.' : error.message; openButton.disabled = false; }
                }
            };
            saveButton.onclick = async () => {
                if (!session.canSave) return;
                const fullName = input.value.trim();
                if (fullName.length < 2 || /[<>\u0000-\u001f]/.test(fullName)) { status.textContent = 'Enter your name before saving.'; input.focus(); return; }
                session.saving(); saveButton.disabled = openButton.disabled = input.disabled = true;
                status.textContent = 'Saving your picture…';
                try {
                    const url = await save(session.photo, fullName);
                    if (closed) return; // Cancelling a booking never resumes it after a late upload.
                    session.saved(); cleanup(); resolve(url);
                } catch (error) {
                    if (closed) return;
                    session.retry(); status.textContent = error.message || 'Picture could not be saved. Please retry.';
                    saveButton.disabled = openButton.disabled = input.disabled = false;
                }
            };
            openButton.focus();
        });
        active = task;
        task.then(() => { active = null; }, () => { active = null; });
        return task;
    }
    window.AsiyePassengerOnboarding = {createSession, open};
})();

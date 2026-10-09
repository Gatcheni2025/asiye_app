/* Passenger phone-OTP onboarding: saved face picture is mandatory before booking.
   Uses the same native bridge as member-pages, with camera fallback for web. */
(() => {
  let pending = null;
  let capturedDataUrl = '';
  let busy = false;
  const root = () => document.getElementById('newPassengerStep');
  const status = () => document.getElementById('newPassengerFaceStatus');
  const showError = message => { if (status()) status().textContent = message; };
  const channel = () => (window.Asiye?.postMessage ? window.Asiye : window.Android?.postMessage ? window.Android : null);
  const blobDataUrl = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('Could not read the camera image.'));
    reader.readAsDataURL(blob);
  });
  async function cameraFallback() {
    if (!navigator.mediaDevices?.getUserMedia) throw Error('Camera unavailable. Open the installed Asiye app and allow camera access.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: {ideal: 720} }, audio: false });
    const video = document.createElement('video');
    video.autoplay = true; video.muted = true; video.playsInline = true;
    const wrap = document.getElementById('newPassengerFaceCamera');
    const shutter = document.getElementById('newPassengerFaceShutter');
    video.srcObject = stream;
    wrap.replaceChildren(video);
    wrap.hidden = false;
    shutter.hidden = false;
    try {
      await video.play();
      await new Promise((resolve, reject) => {
        if (video.videoWidth) return resolve();
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(Error('Camera could not start.'));
      });
      await new Promise(resolve => { shutter.onclick = resolve; });
      const canvas = document.createElement('canvas');
      const side = Math.min(video.videoWidth, video.videoHeight);
      canvas.width = canvas.height = Math.min(768, side);
      canvas.getContext('2d').drawImage(video,
        (video.videoWidth - side)/2, (video.videoHeight-side)/2, side, side,
        0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.82);
    } finally {
      stream.getTracks().forEach(track => track.stop());
      video.srcObject = null;
      wrap.hidden = true;
      shutter.hidden = true;
    }
  }
  async function capture() {
    if (busy) return;
    busy = true;
    const button = document.getElementById('scanPassengerFace');
    if (button) button.disabled = true;
    showError('Opening front camera. Centre your face in the guide.');
    try {
      if (channel()) {
        if (pending) throw Error('The face scanner is already open.');
        const photo = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            pending = null; reject(Error('Camera timed out. Try again.'));
          }, 120000);
          pending = {
            resolve: value => { clearTimeout(timeout); pending = null; resolve(value); },
            reject: error => { clearTimeout(timeout); pending = null; reject(error); }
          };
          try { channel().postMessage(JSON.stringify({ action:'captureFacePhoto', purpose:'passenger-profile' })); }
          catch (error) { pending.reject(error); }
        });
        capturedDataUrl = String(photo?.dataUrl || '');
      } else capturedDataUrl = await cameraFallback();
      if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(capturedDataUrl)) throw Error('Camera did not return a valid face image.');
      const preview = document.getElementById('newPassengerFacePreview');
      preview.src = capturedDataUrl;
      preview.hidden = false;
      showError('Face picture captured. Tap Save profile to finish registering.');
    } catch (error) {
      capturedDataUrl = '';
      showError(error?.message || 'Face scan failed. Try again.');
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }
  window.onNativeFaceCaptureSuccess = result => pending?.resolve(result);
  window.onNativeFaceCaptureError = message => pending?.reject(Error(String(message || 'Face scan cancelled.')));
  const valid = profile => Boolean(String(profile?.name || '').trim().length >= 2 &&
    (profile?.profileImageUrl || profile?.profile_picture_url || profile?.passengerProfileImageUrl));
  const photo = () => capturedDataUrl;
  // Native face camera JPEGs can exceed Cloud Functions' 3 MB limit.
  // Resize to an upload-safe square before issuing the authenticated request.
  const photoForUpload = async () => {
    if (!capturedDataUrl) return '';
    const img = new Image();
    await new Promise((resolve,reject) => {
      img.onload = resolve;
      img.onerror = () => reject(Error('Captured face image could not be opened.'));
      img.src = capturedDataUrl;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (side < 100) throw Error('Face picture is too small. Take another picture.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(768,side);
    const x = (img.naturalWidth-side)/2, y = (img.naturalHeight-side)/2;
    canvas.getContext('2d').drawImage(img,x,y,side,side,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',0.78);
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('scanPassengerFace')?.addEventListener('click', capture);
  });
  window.AsiyePassengerOnboarding = { capture, photo, photoForUpload, valid };
})();

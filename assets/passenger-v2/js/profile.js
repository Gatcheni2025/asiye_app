/* ============================================================
   ASIYE PASSENGER V2
   Passenger Profile Photo (PHP upload)
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.profile = {
    uploadEndpoint: 'https://app.asiye.cloud/upload_handler.php',
    uploadApiKey: 'asiye_secure_upload_2025',

    getUrl(user = ASIYE.state?.user || {}) {
        return (
            user.profile_picture_url ||
            user.profileImageUrl ||
            user.photoURL ||
            user.photoUrl ||
            ''
        );
    },

    syncAvatar(user = ASIYE.state?.user || {}) {
        const url = this.getUrl(user);
        const fallback = String(
            user.name ||
            user.firstName ||
            user.displayName ||
            'A'
        ).trim().charAt(0).toUpperCase() || 'A';

        const targets = [
            document.getElementById('profileInitial'),
            document.getElementById('menuProfileAvatar')
        ].filter(Boolean);

        targets.forEach(target => {
            if (url) {
                target.innerHTML = '';
                const img = document.createElement('img');
                img.src = url;
                img.alt = 'Passenger profile picture';
                img.referrerPolicy = 'no-referrer';
                target.appendChild(img);
            } else {
                target.textContent = fallback;
            }
        });

        const nameEl = document.getElementById('menuUserName');
        const phoneEl = document.getElementById('menuUserPhone');

        if (nameEl) {
            nameEl.textContent =
                user.name ||
                user.firstName ||
                user.displayName ||
                'Passenger';
        }

        if (phoneEl) {
            phoneEl.textContent =
                user.phone ||
                user.phoneNumber ||
                user.email ||
                'Asiye';
        }
    },

    compressImage(file) {
        return new Promise((resolve, reject) => {
            if (!file || !String(file.type || '').startsWith('image/')) {
                reject(new Error('Please capture or choose an image.'));
                return;
            }

            if (file.size > 15 * 1024 * 1024) {
                reject(new Error('Image is too large. Please use an image under 15 MB.'));
                return;
            }

            const reader = new FileReader();

            reader.onerror = () =>
                reject(new Error('Could not read the selected image.'));

            reader.onload = event => {
                const img = new Image();

                img.onerror = () =>
                    reject(new Error('The selected image could not be opened.'));

                img.onload = () => {
                    const maxSide = 1000;
                    let width = img.naturalWidth || img.width;
                    let height = img.naturalHeight || img.height;

                    if (!width || !height) {
                        reject(new Error('The captured image is invalid.'));
                        return;
                    }

                    const scale = Math.min(1, maxSide / Math.max(width, height));
                    width = Math.max(1, Math.round(width * scale));
                    height = Math.max(1, Math.round(height * scale));

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;

                    const context = canvas.getContext('2d');
                    context.drawImage(img, 0, 0, width, height);

                    canvas.toBlob(
                        blob => {
                            if (!blob) {
                                reject(new Error('Could not prepare the image for upload.'));
                                return;
                            }
                            resolve(blob);
                        },
                        'image/jpeg',
                        0.78
                    );
                };

                img.src = event.target.result;
            };

            reader.readAsDataURL(file);
        });
    },

    async upload(file, statusEl = null) {
        const passengerId = ASIYE.state?.userId;

        if (!passengerId) {
            throw new Error('Passenger account is not loaded.');
        }

        if (statusEl) statusEl.textContent = 'Preparing photo…';

        const blob = await this.compressImage(file);

        if (statusEl) statusEl.textContent = 'Uploading profile picture…';

        const formData = new FormData();
        formData.append('file', blob, 'passenger-profile.jpg');
        formData.append('api_key', this.uploadApiKey);
        formData.append('userId', passengerId);

        const response = await fetch(this.uploadEndpoint, {
            method: 'POST',
            body: formData
        });

        let data = null;

        try {
            data = await response.json();
        } catch (_) {
            throw new Error('The image server returned an invalid response.');
        }

        const url =
            data?.url ||
            data?.file_url ||
            data?.fileUrl ||
            data?.location ||
            '';

        if (!response.ok || !url) {
            throw new Error(
                data?.message ||
                data?.error ||
                'Profile picture upload failed.'
            );
        }

        if (statusEl) statusEl.textContent = 'Saving profile picture…';

        const updates = {
            profile_picture_url: url,
            profileImageUrl: url,
            profilePhotoUpdatedAt: firebase.database.ServerValue.TIMESTAMP
        };

        await firebase
            .database()
            .ref(`commuters/${passengerId}`)
            .update(updates);

        const authUser = firebase.auth().currentUser;

        if (authUser && typeof authUser.updateProfile === 'function') {
            try {
                await authUser.updateProfile({ photoURL: url });
            } catch (error) {
                console.warn('Firebase Auth photoURL update skipped:', error);
            }
        }

        ASIYE.state.user = {
            ...(ASIYE.state.user || {}),
            ...updates,
            profile_picture_url: url,
            profileImageUrl: url
        };

        this.syncAvatar(ASIYE.state.user);

        if (statusEl) statusEl.textContent = 'Profile picture saved.';

        return url;
    },

    bindAccount(container) {
        if (!container) return;

        const input = container.querySelector('[data-passenger-profile-file]');
        const button = container.querySelector('[data-passenger-profile-camera]');
        const status = container.querySelector('[data-passenger-profile-status]');
        const preview = container.querySelector('[data-passenger-profile-preview]');

        if (!input || !button) return;

        button.onclick = () => input.click();

        input.onchange = async () => {
            const file = input.files?.[0];

            if (!file) return;

            button.disabled = true;
            button.textContent = 'Saving photo…';

            try {
                const url = await this.upload(file, status);

                if (preview && url) {
                    preview.src = url;
                    preview.hidden = false;
                }

                button.textContent = 'Change profile picture';
            } catch (error) {
                console.error('Passenger profile photo failed:', error);
                if (status) {
                    status.textContent =
                        error?.message ||
                        'Could not save the profile picture.';
                }
                button.textContent = 'Take profile picture';
            } finally {
                button.disabled = false;
                input.value = '';
            }
        };
    }
};

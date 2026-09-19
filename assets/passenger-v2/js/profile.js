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
                reject(new Error('Please scan or capture an image.'));
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

        if (statusEl) statusEl.textContent = 'Processing scan…';

        const blob = await this.compressImage(file);

        if (statusEl) statusEl.textContent = 'Saving profile picture…';

        if (!window.AsiyePhpImageUpload) {
            throw new Error(
                'Image upload service is unavailable.'
            );
        }

        const uploaded =
            await AsiyePhpImageUpload.upload(
                blob,
                {
                    userId:
                        passengerId,
                    purpose:
                        'passenger-profile',
                    filename:
                        'passenger-profile.jpg'
                }
            );

        const url =
            uploaded.url;

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

    async _fileFromScan(result) {
        if (!window.AsiyePhpImageUpload) {
            throw new Error(
                'Image upload service is unavailable.'
            );
        }

        return AsiyePhpImageUpload
            .toBlob(
                result
            );
    },

    bindAccount(container) {
        if (!container) return;

        const input =
            container.querySelector(
                '[data-passenger-profile-file]'
            );

        const button =
            container.querySelector(
                '[data-passenger-profile-camera]'
            );

        const status =
            container.querySelector(
                '[data-passenger-profile-status]'
            );

        const preview =
            container.querySelector(
                '[data-passenger-profile-preview]'
            );

        const accountAvatar =
            container.querySelector(
                '.member-avatar'
            );

        if (!button) return;

        const saveFile = async file => {
            if (!file) return;

            button.disabled = true;
            button.textContent =
                'Saving scan…';

            try {
                const url =
                    await this.upload(
                        file,
                        status
                    );

                if (url) {
                    if (preview) {
                        preview.src = url;
                        preview.hidden = false;
                    } else if (accountAvatar) {
                        accountAvatar.classList.add(
                            'member-avatar-photo'
                        );

                        accountAvatar.innerHTML = '';

                        const image =
                            document.createElement('img');

                        image.src = url;
                        image.alt = 'Profile picture';
                        image.setAttribute(
                            'data-passenger-profile-preview',
                            ''
                        );

                        accountAvatar.appendChild(image);
                    }
                }

                button.textContent =
                    'Rescan profile picture';
            } catch (error) {
                console.error(
                    'Passenger profile scan failed:',
                    error
                );

                if (status) {
                    status.textContent =
                        error?.message ||
                        'Could not save the scanned profile picture.';
                }

                button.textContent =
                    'Scan profile picture';
            } finally {
                button.disabled = false;

                if (input) {
                    input.value = '';
                }
            }
        };

        button.onclick = async () => {
            if (window.AsiyeNativeBridge) {
                button.disabled = true;
                button.textContent =
                    'Opening camera…';

                if (status) {
                    status.textContent =
                        'Position your face clearly inside the camera frame.';
                }

                try {
                    const result =
                        await AsiyeNativeBridge.scanImage({
                            purpose:
                                'passenger-profile',
                            facing:
                                'front'
                        });

                    if (!result) {
                        button.disabled = false;
                        button.textContent =
                            this.getUrl()
                                ? 'Rescan profile picture'
                                : 'Scan profile picture';
                        return;
                    }

                    const file =
                        await this._fileFromScan(
                            result
                        );

                    button.disabled = false;
                    await saveFile(file);
                } catch (error) {
                    button.disabled = false;
                    button.textContent =
                        this.getUrl()
                            ? 'Rescan profile picture'
                            : 'Scan profile picture';

                    if (status) {
                        status.textContent =
                            error?.message ||
                            'Unable to open the camera.';
                    }
                }

                return;
            }

            input?.click();
        };

        if (input) {
            input.onchange = async () => {
                await saveFile(
                    input.files?.[0]
                );
            };
        }
    }
};

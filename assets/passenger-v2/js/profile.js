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
                    const maxSide = 720;
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
                        0.72
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

        const saveFace =
            async blob => {
                if (!blob) return;

                button.disabled =
                    true;

                button.textContent =
                    'Saving face…';

                try {
                    const url =
                        await this.upload(
                            blob,
                            status
                        );

                    if (url) {
                        if (preview) {
                            preview.src =
                                url;

                            preview.hidden =
                                false;

                        } else if (
                            accountAvatar
                        ) {
                            accountAvatar
                                .classList
                                .add(
                                    'member-avatar-photo'
                                );

                            accountAvatar
                                .replaceChildren();

                            const image =
                                document.createElement(
                                    'img'
                                );

                            image.src =
                                url;

                            image.alt =
                                'Passenger profile picture';

                            image.setAttribute(
                                'data-passenger-profile-preview',
                                ''
                            );

                            accountAvatar
                                .appendChild(
                                    image
                                );
                        }
                    }

                    button.textContent =
                        'Rescan face';

                } catch (error) {
                    console.error(
                        'Passenger face scan failed:',
                        error
                    );

                    if (status) {
                        status.textContent =
                            error?.message ||
                            'Could not save the face scan.';
                    }

                    button.textContent =
                        this.getUrl()
                            ? 'Rescan face'
                            : 'Scan face';

                } finally {
                    button.disabled =
                        false;
                }
            };


        button.onclick =
            async () => {
                button.disabled =
                    true;

                button.textContent =
                    'Opening camera…';

                if (status) {
                    status.textContent =
                        'Opening live face scan. Centre your face and follow the movement prompts.';
                }

                try {
                    let blob = null;

                    /*
                     * Mobile app: use Flutter's native camera bridge.
                     * This opens the camera directly and never opens
                     * the gallery/file picker.
                     */
                    if (
                        window.AsiyeNativeBridge &&
                        typeof AsiyeNativeBridge.scanFace ===
                            'function'
                    ) {
                        const result =
                            await AsiyeNativeBridge
                                .scanFace({
                                    purpose:
                                        'passenger-profile'
                                });

                        if (!result) {
                            button.textContent =
                                this.getUrl()
                                    ? 'Rescan face'
                                    : 'Scan face';

                            if (status) {
                                status.textContent =
                                    'Camera cancelled. No photo was changed.';
                            }

                            return;
                        }

                        blob =
                            await this
                                ._fileFromScan(
                                    result
                                );

                    } else if (
                        window.AsiyeFaceScanner
                    ) {
                        /*
                         * Browser fallback only. The installed mobile
                         * app should normally use the native bridge above.
                         */
                        const result =
                            await AsiyeFaceScanner
                                .open({
                                    title:
                                        'Passenger face scan',
                                    subtitle:
                                        'Centre your face inside the guide. Move naturally and smile when prompted.'
                                });

                        blob =
                            result?.blob ||
                            null;
                    } else {
                        throw new Error(
                            'Camera service is unavailable in this build.'
                        );
                    }

                    if (!blob) {
                        return;
                    }

                    if (status) {
                        status.textContent =
                            'Photo captured. Saving profile picture…';
                    }

                    await saveFace(
                        blob
                    );

                } catch (error) {
                    console.error(
                        'Passenger profile camera failed:',
                        error
                    );

                    if (status) {
                        status.textContent =
                            error?.message ||
                            'Could not take or save the profile photo.';
                    }

                    button.textContent =
                        this.getUrl()
                            ? 'Rescan face'
                            : 'Scan face';

                } finally {
                    button.disabled =
                        false;
                }
            };
    }
};

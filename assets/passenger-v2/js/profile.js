/* ============================================================
   ASIYE PASSENGER V2
   REQUIRED PROFILE PHOTO / FACE SCAN
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.profile = {

    getUrl(user = ASIYE.state?.user || {}) {
        const raw = String(
            user.profileImageUrl ||
            user.profile_picture_url ||
            user.passengerProfileImageUrl ||
            user.profilePhotoUrl ||
            user.photoURL ||
            ''
        ).trim();

        if (!raw) return '';

        try {
            if (/^https?:\/\//i.test(raw)) {
                return raw.replace(/^http:/i, 'https:');
            }

            if (raw.startsWith('//')) {
                return 'https:' + raw;
            }

            return new URL(
                raw.replace(/^\.\//, '').replace(/^\//, ''),
                'https://app.asiye.cloud/'
            ).href;
        } catch (_) {
            return raw.replace(/^http:/i, 'https:');
        }
    },

    async photoAvailable(user = ASIYE.state?.user || {}) {
        const url = this.getUrl(user);
        if (!/^https:\/\//.test(url)) return false;
        return await new Promise(resolve => {
            const image = new Image();
            let completed = false;
            const done = ok => {
                if (completed) return;
                completed = true;
                clearTimeout(timeout);
                resolve(ok);
            };
            const timeout = setTimeout(() => done(false), 10000);
            image.onload = () => done(image.naturalWidth > 0);
            image.onerror = () => done(false);
            image.src = url;
        });
    },

    refreshUI(user = ASIYE.state?.user || {}) {
        const url =
            this.getUrl(
                user
            );

        const name =
            String(
                user.name ||
                user.firstName ||
                user.fullName ||
                'Asiye'
            )
            .trim();

        const initial =
            (
                name.charAt(0) ||
                'A'
            )
            .toUpperCase();

        const render =
            target => {
                if (!target) {
                    return;
                }

                if (url) {
                    target.replaceChildren();

                    const image =
                        document.createElement(
                            'img'
                        );

                    image.src =
                        url;

                    image.alt =
                        'Passenger profile picture';

                    image.onerror = () => {
                        // A stale Firebase token used to render a broken
                        // avatar and silently block rides. Show the initial
                        // instead; user can replace it from Account.
                        image.remove();
                        target.textContent = initial;
                        target.title = 'Picture could not load. Open Account to scan again.';
                    };

                    image.style.cssText =
                        'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;';

                    target.appendChild(
                        image
                    );
                } else {
                    target.textContent =
                        initial;
                }
            };

        render(
            document.getElementById(
                'profileInitial'
            )
        );

        render(
            document.getElementById(
                'menuProfileAvatar'
            )
        );

        document
            .querySelectorAll(
                '[data-passenger-profile-preview]'
            )
            .forEach(
                image => {
                    if (url) {
                        image.src =
                            url;
                    }
                }
            );

        return url;
    },


    async saveFace(blob, userId = ASIYE.state?.userId) {
        if (!userId) {
            throw new Error('Passenger account is not loaded.');
        }

        if (!window.AsiyePhpImageUpload) {
            throw new Error('Profile image service is unavailable.');
        }

        const uploaded = await AsiyePhpImageUpload.upload(
            blob,
            {
                userId,
                purpose: 'passenger-profile',
                filename: 'passenger-profile.jpg'
            }
        );

        const url = uploaded.url;
        const patch = {
            profileImageUrl: url,
            profile_picture_url: url,
            profilePhotoUrl: url,
            photoURL: url,
            passengerProfileImageUrl: url,
            faceScanCompleted: true,
            faceScanVerifiedAt:
                firebase.database.ServerValue.TIMESTAMP,
            profilePhotoUpdatedAt:
                firebase.database.ServerValue.TIMESTAMP
        };

        /*
         * uploadProfileImageProxy already writes these canonical fields to
         * commuters/{userId} with Admin SDK. Mirror them from the WebView when
         * permitted, but never report a failed scan after the server saved it.
         */
        await firebase.database()
            .ref(`commuters/${userId}`)
            .update(patch)
            .catch(error => {
                console.warn(
                    'Passenger profile image was saved server-side; client mirror update was skipped:',
                    error
                );
            });

        ASIYE.state.user = ASIYE.state.user || {};
        Object.assign(ASIYE.state.user, patch);

        const authUser = firebase.auth().currentUser;
        if (authUser?.updateProfile) {
            try {
                await authUser.updateProfile({ photoURL: url });
            } catch (error) {
                console.warn('Passenger Auth profile image was not updated:', error);
            }
        }

        this.refreshUI(
            ASIYE.state.user
        );

        return url;
    },

    async scanAndSave(statusEl = null) {
        if (!window.AsiyeFaceCapture) {
            throw new Error('Live face scan is unavailable in this build.');
        }

        if (statusEl) {
            statusEl.textContent = 'Opening front camera…';
        }

        const result = await AsiyeFaceCapture.capture('passenger-profile');
        const blob = AsiyePhpImageUpload.toBlob(result);

        if (statusEl) {
            statusEl.textContent = 'Saving profile picture…';
        }

        const url = await this.saveFace(blob);

        if (statusEl) {
            statusEl.textContent = 'Face scan saved. Your profile is ready for bookings.';
        }

        return url;
    },

    async ensureRequired() {
        const user = ASIYE.state?.user || {};
        const existing = this.getUrl(user);
        const faceScanCompleted =
            user.faceScanCompleted === true ||
            user.faceScanVerified === true;

        // Never open a camera or upload an image from within a payment or
        // booking request. Phone signup has a dedicated face capture step.
        // Re-scanning, if needed, is done explicitly in the Account panel.
        if (existing && faceScanCompleted && String(user.name || '').trim().length >= 2) {
            return existing;
        }
        throw new Error(
            'Your passenger profile needs a saved face photo before booking. Open Account, tap Scan face, then retry the ride.'
        );
    },

    bindAccount(container) {
        const button =
            container.querySelector('[data-passenger-profile-camera]');

        const status =
            container.querySelector('[data-passenger-profile-status]');

        if (!button) return;

        button.onclick = async () => {
            const original = button.textContent;
            button.disabled = true;
            button.textContent = 'Opening camera…';

            try {
                const url = await this.scanAndSave(status);
                const preview =
                    container.querySelector('[data-passenger-profile-preview]');

                if (preview) {
                    preview.src = url;
                } else {
                    const avatar = container.querySelector('.member-avatar');
                    if (avatar) {
                        avatar.classList.add('member-avatar-photo');
                        avatar.innerHTML =
                            `<img data-passenger-profile-preview src="${url}" alt="Profile picture">`;
                    }
                }

                button.textContent = 'Rescan face';
            } catch (error) {
                if (status) {
                    status.textContent =
                        error?.message || 'Face scan was not saved.';
                }
                button.textContent = original || 'Scan face';
            } finally {
                button.disabled = false;
            }
        };
    }
};

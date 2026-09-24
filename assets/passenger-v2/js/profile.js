/* ============================================================
   ASIYE PASSENGER V2
   REQUIRED PROFILE PHOTO / FACE SCAN
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.profile = {

    getUrl(user = ASIYE.state?.user || {}) {
        return String(
            user.profileImageUrl ||
            user.profile_picture_url ||
            user.profilePhotoUrl ||
            user.photoURL ||
            ''
        ).trim();
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
            faceScanCompleted: true,
            faceScanVerifiedAt:
                firebase.database.ServerValue.TIMESTAMP,
            profilePhotoUpdatedAt:
                firebase.database.ServerValue.TIMESTAMP
        };

        await firebase.database()
            .ref(`commuters/${userId}`)
            .update(patch);

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

        const avatar = document.getElementById('menuProfileAvatar');
        if (avatar) {
            avatar.innerHTML =
                `<img src="${ASIYE.ui?.escape ? ASIYE.ui.escape(url) : url}" alt="Profile picture" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
        }

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

        // A social-login/avatar image is not enough for the first trip.
        // The first booking requires a fresh camera face scan. Once saved,
        // later trips can reuse the verified profile picture.
        if (existing && faceScanCompleted) {
            return existing;
        }

        ASIYE.ui?.toast?.(
            'Before your first trip, scan your face. The camera photo becomes your Asiye profile picture.'
        );

        try {
            return await this.scanAndSave();
        } catch (error) {
            throw new Error(
                error?.message ||
                'Scan your face to add a profile picture before booking.'
            );
        }
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

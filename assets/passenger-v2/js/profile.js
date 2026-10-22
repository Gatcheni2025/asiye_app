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


    async saveFace(dataUrl, fullName, userId = ASIYE.state?.userId) {
        const user = firebase.auth().currentUser;
        if (!userId || !user) throw new Error('Sign in again before saving your picture.');
        const response = await fetch('https://us-central1-asiye-80386.cloudfunctions.net/uploadProfileImageProxy', {
            method: 'POST', headers: {Authorization: `Bearer ${await user.getIdToken(true)}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({userId, purpose: 'passenger-profile', fullName, completeSignup: true, dataUrl})
        });
        const uploaded = await response.json().catch(() => ({}));
        if (!response.ok || !/^https:\/\//.test(uploaded.url || ''))
            throw new Error(uploaded.error || 'Could not save your picture. Please retry.');
        // Read back server-owned completion, never manufacture it in local state.
        const profile = (await firebase.database().ref(`commuters/${userId}`).once('value')).val();
        if (profile?.bookingFaceAuthUid !== user.uid || !profile.bookingFaceSavedAt || !this.getUrl(profile))
            throw new Error('Your picture was uploaded but profile confirmation is pending. Tap Save again.');
        ASIYE.state.user = profile;
        this.refreshUI(profile);
        return uploaded.url;
    },

    scanAndSave() {
        if (!window.AsiyePassengerOnboarding) throw new Error('Reopen Asiye to load the camera.');
        return window.AsiyePassengerOnboarding.open({name: ASIYE.state?.user?.name || firebase.auth().currentUser?.displayName || '',
            save: (photo, name) => this.saveFace(photo, name)});
    },

    async ensureRequired() {
        const userId = ASIYE.state?.userId;
        const auth = firebase.auth().currentUser;
        if (!userId || !auth) throw new Error('Please sign in before booking.');
        const profile = (await firebase.database().ref(`commuters/${userId}`).once('value')).val() || {};
        ASIYE.state.user = profile;
        if (profile.bookingFaceAuthUid === auth.uid && Number(profile.bookingFaceSavedAt) > 0 &&
            String(profile.name || '').trim().length >= 2 && this.getUrl(profile)) return this.getUrl(profile);
        return await this.scanAndSave();
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

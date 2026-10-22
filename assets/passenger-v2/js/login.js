/* ============================================================
   ASIYE PASSENGER V2
   LOGIN
   ============================================================ */

window.ASIYE_PASSENGER_LOGIN = {

    confirmationResult:
        null,

    recaptchaVerifier:
        null,

    currentPhone:
        null,

    resendInterval:
        null,

    resendSeconds:
        30,

    pendingUser:
        null,

    // True only during Google/Apple -> verified phone linking.
    awaitingPhoneLink: false,
    switchingSignInMethod: false,


    /* ========================================================
       INIT
       ======================================================== */

    async init() {

        if (
            typeof firebase ===
                'undefined' ||
            !firebase.apps ||
            firebase.apps.length === 0
        ) {

            console.error(
                'Passenger Firebase is not initialized.'
            );

            this.toast(
                'Unable to connect to Asiye.'
            );

            return;
        }


        this.bindEvents();


        /*
         * Persist passenger sessions across
         * navigation and browser restarts.
         */

        try {

            await firebase
                .auth()
                .setPersistence(
                    firebase.auth
                        .Auth
                        .Persistence
                        .LOCAL
                );


            console.log(
                '✅ Passenger auth persistence: LOCAL'
            );


        } catch (error) {

            console.error(
                'Could not set auth persistence:',
                error
            );
        }


        this.prepareRecaptcha();


        await this.checkExistingSession();
    },


    /* ========================================================
       EXISTING SESSION

       Waits for Firebase to finish restoring the
       persisted session before deciding whether
       to redirect the passenger.
       ======================================================== */

    async checkExistingSession() {

        try {

            const user =

                await new Promise(
                    (resolve, reject) => {

                        const unsubscribe =

                            firebase
                                .auth()
                                .onAuthStateChanged(

                                    authUser => {

                                        unsubscribe();

                                        resolve(
                                            authUser
                                        );
                                    },

                                    error => {

                                        unsubscribe();

                                        reject(
                                            error
                                        );
                                    }
                                );
                    }
                );


            if (!user) {

                console.log(
                    'ℹ️ No existing passenger session.'
                );

                return;
            }


            console.log(
                '✅ Existing passenger session:',
                user.uid
            );


            // Never trust a cached commuterId without the saved profile.
            // Incomplete profiles must resume the photo/name step.
            await this.afterAuthentication(user);

        } catch (error) {

            console.warn(
                'Existing passenger session check failed:',
                error
            );
        }
    },


    /* ========================================================
       EVENTS
       ======================================================== */

    bindEvents() {

        document
            .getElementById(
                'loginBackButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    window.location.href =
                        './index.html';
                }
            );


        document
            .getElementById(
                'sendOtpButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.sendOtp();
                }
            );


        document
            .getElementById(
                'verifyOtpButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.verifyOtp();
                }
            );


        document
            .getElementById(
                'changePhoneButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.showStep(this.awaitingPhoneLink ? 'verifyPhoneStep' : 'loginStep');
                }
            );


        document
            .getElementById(
                'resendOtpButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.resendOtp();
                }
            );


        // A remembered Google/Apple session must never trap the passenger in
        // one-time phone onboarding. Changing method signs out first.
        document.getElementById('switchPassengerSignInButton')?.addEventListener(
            'click', () => this.useAnotherSignInMethod()
        );
        document.getElementById('switchPassengerOtpMethodButton')?.addEventListener(
            'click', () => this.useAnotherSignInMethod()
        );

        document.getElementById('socialSendOtpButton')?.addEventListener('click', () => this.sendOtp());
        document.getElementById('socialPhoneInput')?.addEventListener('keydown', event => {
            if (event.key === 'Enter') this.sendOtp();
        });

        document
            .getElementById(
                'passengerPhoneInput'
            )
            ?.addEventListener(
                'keydown',
                event => {

                    if (
                        event.key ===
                        'Enter'
                    ) {

                        this.sendOtp();
                    }
                }
            );


        document
            .getElementById(
                'passengerOtpInput'
            )
            ?.addEventListener(
                'keydown',
                event => {

                    if (
                        event.key ===
                        'Enter'
                    ) {

                        this.verifyOtp();
                    }
                }
            );


        document
            .getElementById(
                'newPassengerName'
            )
            ?.addEventListener(
                'keydown',
                event => {

                    if (
                        event.key ===
                        'Enter'
                    ) {

                        this.createPassengerProfile();
                    }
                }
            );


        document
            .getElementById(
                'googleLoginButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.signInWithGoogle();
                }
            );


        document
            .getElementById(
                'appleLoginButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.signInWithApple();
                }
            );


        document
            .getElementById(
                'createPassengerProfile'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.createPassengerProfile();
                }
            );
    },


    /* ========================================================
       PASSENGER SIGN-IN METHOD SWITCH
       ======================================================== */

    async useAnotherSignInMethod() {
        if (this.switchingSignInMethod) return;
        this.switchingSignInMethod = true;
        const ids = ['switchPassengerSignInButton','switchPassengerOtpMethodButton'];
        const buttons = ids.map(id => document.getElementById(id)).filter(Boolean);
        for (const button of buttons) button.disabled = true;

        try {
            // Firebase Auth LOCAL persistence restores the previous Google/
            // Apple session on refresh. Explicit sign-out is required before
            // displaying the chooser, but must not delete that user's account.
            await firebase.auth().signOut();

            this.awaitingPhoneLink = false;
            this.pendingUser = null;
            this.pendingProfileId = null;
            this.pendingProfile = null;
            this.confirmationResult = null;
            this.currentPhone = null;
            clearInterval(this.resendInterval);
            this.resendInterval = null;

            const otpInput = document.getElementById('passengerOtpInput');
            if (otpInput) otpInput.value = '';
            for (const id of ['phoneError','socialPhoneError','otpError']) {
                const notice = document.getElementById(id);
                if (notice) notice.textContent = '';
            }

            // Clear cached passenger identity, not Firebase profile records,
            // bookings, existing provider links, or installed driver state.
            for (const key of ['userId','commuterId','authUid','passengerPhone','userName']) {
                try { localStorage.removeItem(key); } catch (_) {}
            }
            this.showStep('loginStep');
            this.toast('Choose Google, Apple or phone to sign in.');
        } catch (error) {
            console.warn('Passenger sign-out failed:', error?.code || 'UNKNOWN');
            this.toast('Could not switch sign-in methods. Please try again.');
            // Leave the existing verification step in place if sign-out fails.
        } finally {
            this.switchingSignInMethod = false;
            for (const button of buttons) button.disabled = false;
        }
    },

    /* ========================================================
       RECAPTCHA
       ======================================================== */

    // Reuse one Firebase verifier for the entire page lifecycle. Firebase's
    // asynchronous render must finish before signInWithPhoneNumber consumes it.
    prepareRecaptcha() {
        if (this.recaptchaRenderPromise) return this.recaptchaRenderPromise;
        if (this.recaptchaVerifier) return Promise.resolve(this.recaptchaVerifier);
        if (!document.getElementById('recaptcha-container')) return Promise.resolve(null);

        let verifier;
        try {
            verifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
                size: 'invisible',
                callback: () => console.log('✅ Passenger reCAPTCHA passed'),
                'expired-callback': () => this.resetRecaptchaWidget()
            });
            this.recaptchaVerifier = verifier;
            this.recaptchaRenderPromise = verifier.render()
                .then(widgetId => {
                    if (this.recaptchaVerifier === verifier) this.recaptchaWidgetId = widgetId;
                    return verifier;
                })
                .catch(error => {
                    console.warn('Passenger reCAPTCHA render warning:', error);
                    if (this.recaptchaVerifier === verifier) {
                        this.recaptchaVerifier = null;
                        this.recaptchaRenderPromise = null;
                        this.recaptchaWidgetId = null;
                        try { verifier.clear(); } catch (_) {}
                    }
                    return null;
                });
            return this.recaptchaRenderPromise;
        } catch (error) {
            console.error('Passenger reCAPTCHA setup failed:', error);
            this.recaptchaVerifier = null;
            this.recaptchaRenderPromise = null;
            this.recaptchaWidgetId = null;
            return Promise.resolve(null);
        }
    },

    resetRecaptchaWidget() {
        if (Number.isInteger(this.recaptchaWidgetId)) {
            try { window.grecaptcha?.reset(this.recaptchaWidgetId); } catch (_) {}
        }
    },


    /* ========================================================
       PHONE NORMALIZATION
       ======================================================== */

    normalizePhone(raw) {

        let digits =

            String(raw || '')
                .replace(
                    /\D/g,
                    ''
                );


        if (
            digits.startsWith('27') &&
            digits.length === 11
        ) {

            digits =
                digits.substring(2);

        } else if (
            digits.startsWith('0') &&
            digits.length === 10
        ) {

            digits =
                digits.substring(1);
        }


        if (
            digits.length !==
            9
        ) {

            return null;
        }


        return `+27${digits}`;
    },


    buildPhoneVariants(
        raw
    ) {

        const normalized =
            this.normalizePhone(
                raw
            );


        if (!normalized) {

            return [];
        }


        const digits =
            normalized
                .replace(
                    '+27',
                    ''
                );

        const d1 = digits.slice(0, 2);
        const d2 = digits.slice(2, 5);
        const d3 = digits.slice(5);


        return [

            `+27${digits}`,

            `27${digits}`,

            `0${digits}`,

            digits,

            `0${d1} ${d2} ${d3}`,

            `+27 ${d1} ${d2} ${d3}`,

            `27 ${d1} ${d2} ${d3}`,

            `+27${d1} ${d2} ${d3}`,

            `0${d1}-${d2}-${d3}`
        ];
    },


    /* ========================================================
       PHONE OTP
       ======================================================== */

    async sendOtp() {
        const linking = this.awaitingPhoneLink;
        const input = document.getElementById(linking ? 'socialPhoneInput' : 'passengerPhoneInput');
        const errorElement = document.getElementById(linking ? 'socialPhoneError' : 'phoneError');
        const button = document.getElementById(linking ? 'socialSendOtpButton' : 'sendOtpButton');
        const phone = this.normalizePhone(input?.value);
        if (!phone) {
            if (errorElement) errorElement.textContent = 'Enter a valid South African mobile number.';
            return;
        }
        this.currentPhone = phone;
        if (errorElement) errorElement.textContent = '';
        if (button) { button.disabled = true; button.textContent = 'Sending code...'; }
        try {
            const verifier = await this.prepareRecaptcha();
            if (!verifier) throw Error('Security verification is unavailable. Reload the page.');
            if (linking) {
                const current = firebase.auth().currentUser;
                if (!current || !this.pendingUser || current.uid !== this.pendingUser.uid) {
                    throw Error('Your Apple or Google session changed. Please sign in again.');
                }
                // Firebase links the phone credential to the CURRENT social UID.
                // signInWithPhoneNumber here would create/switch user accounts.
                this.confirmationResult = await current.linkWithPhoneNumber(phone, verifier);
            } else {
                this.confirmationResult = await firebase.auth().signInWithPhoneNumber(phone, verifier);
            }
            const display = document.getElementById('otpPhoneDisplay');
            if (display) display.textContent = phone;
            this.showStep('otpStep');
            this.startResendTimer();
            setTimeout(() => document.getElementById('passengerOtpInput')?.focus(), 150);
        } catch (error) {
            console.warn('Passenger OTP send failed:', error?.code || error?.message);
            if (linking && error?.code === 'auth/credential-already-in-use') {
                const notice = 'This phone number belongs to another account. Sign in using that number or contact Asiye Support to link accounts securely.';
                if (errorElement) errorElement.textContent = notice;
                this.toast(notice);
            } else {
                this.handleAuthError(error, linking ? 'socialPhone' : 'phone');
            }
            if (['auth/captcha-check-failed','auth/invalid-app-credential'].includes(error?.code)) {
                this.resetRecaptchaWidget();
            }
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = linking ? 'Send verification code' : 'Continue with phone';
            }
        }
    },

    async verifyOtp() {
        const input = document.getElementById('passengerOtpInput');
        const errorElement = document.getElementById('otpError');
        const button = document.getElementById('verifyOtpButton');
        const linking = this.awaitingPhoneLink;
        if (!this.confirmationResult) {
            if (errorElement) errorElement.textContent = 'Please request a verification code first.';
            this.showStep(linking ? 'verifyPhoneStep' : 'loginStep');
            return;
        }
        const code = String(input?.value || '').replace(/\D/g,'');
        if (code.length !== 6) {
            if (errorElement) errorElement.textContent = 'Enter the 6-digit verification code.';
            return;
        }
        if (errorElement) errorElement.textContent = '';
        if (button) { button.disabled = true; button.textContent = 'Verifying...'; }
        let authUser = null;
        try {
            const originalUid = linking ? this.pendingUser?.uid : null;
            const result = await this.confirmationResult.confirm(code);
            authUser = result.user;
            if (linking) {
                // Never complete onboarding or redirect after a UID switch.
                if (!originalUid || authUser?.uid !== originalUid ||
                    firebase.auth().currentUser?.uid !== originalUid) {
                    throw Error('Verification did not preserve your original account. Contact Asiye Support.');
                }
                await authUser.reload();
                authUser = firebase.auth().currentUser;
                if (!authUser?.phoneNumber) throw Error('Phone verification did not finish. Please try again.');
                this.awaitingPhoneLink = false;
            }
            this.confirmationResult = null;
        } catch (error) {
            console.warn('Passenger OTP confirm failed:', error?.code || error?.message);
            if (linking && error?.code === 'auth/credential-already-in-use') {
                const message = 'This phone is already linked to another Asiye account. Sign in with that number or contact Support to merge accounts safely.';
                if (errorElement) errorElement.textContent = message;
                this.toast(message);
            } else {
                this.handleAuthError(error, 'otp');
            }
            if (button) { button.disabled = false; button.textContent = 'Verify & continue'; }
            return;
        }
        try {
            this.showStep('profileCheckStep');
            await this.afterAuthentication(authUser);
        } catch (error) {
            // No unverified profile fallback — keep the passenger off dashboard.
            console.warn('Post-auth profile check failed:', error?.code || error?.message);
            this.pendingUser = authUser;
            this.toast('Unable to load your Asiye profile. Please try again.');
        } finally {
            if (button) { button.disabled = false; button.textContent = 'Verify & continue'; }
        }
    },


    /* ========================================================
       GOOGLE
       ======================================================== */

    async signInWithGoogle() {

        const button =
            document.getElementById(
                'googleLoginButton'
            );


        try {

            if (button) {

                button.disabled =
                    true;

                button.innerHTML = `

                    <i class="fas fa-circle-notch fa-spin"></i>

                    Connecting...

                `;
            }


            const provider =

                new firebase.auth
                    .GoogleAuthProvider();


            provider.setCustomParameters({

                prompt:
                    'select_account'

            });


            const result =

                await firebase
                    .auth()
                    .signInWithPopup(
                        provider
                    );


            await this.afterAuthentication(
                result.user
            );


        } catch (error) {

            this.handleSocialError(
                error,
                'Google'
            );


        } finally {

            if (button) {

                button.disabled =
                    false;

                button.innerHTML = `

                    <span class="google-letter">
                        G
                    </span>

                    Continue with Google

                `;
            }
        }
    },


    /* ========================================================
       APPLE
       ======================================================== */

    async signInWithApple() {

        const button =
            document.getElementById(
                'appleLoginButton'
            );


        try {

            if (button) {

                button.disabled =
                    true;

                button.innerHTML = `

                    <i class="fas fa-circle-notch fa-spin"></i>

                    Connecting...

                `;
            }


            const provider =

                new firebase.auth
                    .OAuthProvider(
                        'apple.com'
                    );


            provider.addScope(
                'email'
            );


            provider.addScope(
                'name'
            );


            const result =

                await firebase
                    .auth()
                    .signInWithPopup(
                        provider
                    );


            await this.afterAuthentication(
                result.user
            );


        } catch (error) {

            this.handleSocialError(
                error,
                'Apple'
            );


        } finally {

            if (button) {

                button.disabled =
                    false;

                button.innerHTML = `

                    <i class="fab fa-apple"></i>

                    Continue with Apple

                `;
            }
        }
    },


    /* ========================================================
       AUTH SUCCESS
       ======================================================== */

    async storedFaceAvailable(url) {
        const link = String(url || '').trim();
        if (!/^https:\/\//i.test(link)) return false;
        return await new Promise(resolve => {
            const picture = new Image();
            let finished = false;
            const complete = value => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
            const timer = setTimeout(() => complete(false), 12000);
            picture.onload = () => complete(picture.naturalWidth > 0);
            picture.onerror = () => complete(false);
            picture.src = link;
        });
    },

    async afterAuthentication(
        user
    ) {

        if (!user) {

            throw new Error(
                'Authentication failed.'
            );
        }


        this.pendingUser = user;
        this.showStep('profileCheckStep');

        // Firebase phoneNumber is verified by Auth. Ignore editable
        // profile phone fields and localStorage for this security gate.
        if (!user.phoneNumber) {
            const methods = Array.isArray(user.providerData) ?
                user.providerData.map(info => info?.providerId) : [];
            const providerName = methods.includes('apple.com') ? 'Apple' :
                methods.includes('google.com') ? 'Google' : '';
            const explanation = document.getElementById('phoneLinkExplanation');
            if (explanation) explanation.textContent = providerName ?
                'Signed in with ' + providerName +
                '. Verify your mobile once to finish your Asiye passenger account. To use a different account, choose another sign-in method below.' :
                'You are signed in. Verify your mobile once to finish your Asiye passenger account, or choose another sign-in method below.';
            this.awaitingPhoneLink = true;
            this.confirmationResult = null;
            const notice = document.getElementById('socialPhoneError');
            if (notice) notice.textContent = '';
            this.showStep('verifyPhoneStep');
            return;
        }
        this.awaitingPhoneLink = false;


        const profile =
            await this.resolvePassengerProfile(
                user
            );


        this.pendingProfileId = profile?.id || user.uid;
        this.pendingProfile = profile?.data || null;
        const complete = Boolean(
            String(profile?.data?.name || '').trim().length >= 2 &&
            (profile?.data?.profileImageUrl ||
             profile?.data?.profile_picture_url ||
             profile?.data?.passengerProfileImageUrl)
        );
        if (profile && complete) {
            const savedUrl = profile.data.profileImageUrl ||
                profile.data.profile_picture_url || profile.data.passengerProfileImageUrl;
            // Catch genuine HTTP 404 and expired Firebase tokens before
            // logging in. A corrupt URL is not a completed face scan.
            if (await this.storedFaceAvailable(savedUrl)) {
                await this.completeLogin(profile.id, profile.data, user);
                return;
            }
            console.warn('Passenger saved face picture unavailable; prompting rescan.');
        }

        /*
         * New passenger.
         */

        const nameInput =
            document.getElementById(
                'newPassengerName'
            );


        if (nameInput) {
            nameInput.value = String(
                profile?.data?.name || user.displayName || ''
            ).trim();
        }


        this.showStep(
            'newPassengerStep'
        );
    },


    /* ========================================================
       RESOLVE EXISTING COMMUTER
       ======================================================== */

    async resolvePassengerProfile(
        user
    ) {

        /*
         * 1. Normal Firebase UID.
         */

        try {

            const directSnapshot =

                await firebase
                    .database()
                    .ref(
                        `commuters/${user.uid}`
                    )
                    .once(
                        'value'
                    );


            if (
                directSnapshot.exists()
            ) {

                return {

                    id:
                        user.uid,

                    data:
                        directSnapshot.val()
                };
            }


            /*
             * 1b. Linked authUid index
             */

            const authUidSnapshot =

                await firebase
                    .database()
                    .ref(
                        'commuters'
                    )
                    .orderByChild(
                        'authUid'
                    )
                    .equalTo(
                        user.uid
                    )
                    .once(
                        'value'
                    );


            if (
                authUidSnapshot.exists()
            ) {

                let match = null;

                authUidSnapshot.forEach(
                    child => {

                        if (!match) {

                            match = {

                                id:
                                    child.key,

                                data:
                                    child.val()
                            };
                        }
                    }
                );


                if (match) {

                    return match;
                }
            }


            /*
             * 2. Legacy phone lookup.
             */

            const variants =

                this.buildPhoneVariants(

                    user.phoneNumber ||
                    this.currentPhone
                );


            for (
                const phone
                of variants
            ) {

                const phoneSnapshot =

                    await firebase
                        .database()
                        .ref(
                            'commuters'
                        )
                        .orderByChild(
                            'phone'
                        )
                        .equalTo(
                            phone
                        )
                        .once(
                            'value'
                        );


                if (
                    phoneSnapshot.exists()
                ) {

                    let match =
                        null;


                    phoneSnapshot.forEach(
                        child => {

                            if (!match) {

                                match = {

                                    id:
                                        child.key,

                                    data:
                                        child.val()
                                };
                            }
                        }
                    );


                    if (match) {

                        await this.attachAuthIdentity(

                            match.id,

                            user
                        );


                        return match;
                    }
                }
            }


            /*
             * 3. Email lookup.
             */

            if (
                user.email
            ) {

                const emailSnapshot =

                    await firebase
                        .database()
                        .ref(
                            'commuters'
                        )
                        .orderByChild(
                            'email'
                        )
                        .equalTo(
                            user.email
                        )
                        .once(
                            'value'
                        );


                if (
                    emailSnapshot.exists()
                ) {

                    let match =
                        null;


                    emailSnapshot.forEach(
                        child => {

                            if (!match) {

                                match = {

                                    id:
                                        child.key,

                                    data:
                                        child.val()
                                };
                            }
                        }
                    );


                    if (match) {

                        await this.attachAuthIdentity(

                            match.id,

                            user
                        );


                        return match;
                    }
                }
            }

        } catch (error) {

            console.warn(
                'Passenger profile lookup query warning:',
                error
            );
        }


        return null;
    },


    /* ========================================================
       ATTACH NEW AUTH TO OLD PROFILE
       ======================================================== */

    async attachAuthIdentity(
        commuterId,
        user
    ) {

        try {

            await firebase
                .database()
                .ref(
                    `commuters/${commuterId}`
                )
                .update({

                    authUid:
                        user.uid,

                    authPhone:
                        user.phoneNumber ||
                        this.currentPhone ||
                        null,

                    authEmail:
                        user.email ||
                        null,

                    authProvider:

                        user.providerData?.[0]
                            ?.providerId ||
                        'phone',

                    authLinkedAt:

                        firebase
                            .database
                            .ServerValue
                            .TIMESTAMP

                });

        } catch (error) {

            console.warn(
                'Could not attach auth identity to commuter:',
                error
            );
        }
    },


    /* ========================================================
       CREATE NEW PASSENGER
       ======================================================== */

    async createPassengerProfile() {
        const user = this.pendingUser || firebase.auth().currentUser;
        if (!user) { this.toast('Please sign in again.'); return; }
        if (!user.phoneNumber) {
            this.awaitingPhoneLink = true;
            this.showStep('verifyPhoneStep');
            const notice = document.getElementById('socialPhoneError');
            if (notice) notice.textContent = 'Verify a phone number by SMS before saving your profile.';
            return;
        }
        const button = document.getElementById('createPassengerProfile');
        const name = String(document.getElementById('newPassengerName')?.value || '').trim();
        if (name.length < 2) { this.toast('Please add your full name.'); return; }
        let id = this.pendingProfileId || user.uid;
        if (button) { button.disabled = true; button.textContent = 'Saving face picture…'; }
        try {
            const dataUrl = await window.AsiyePassengerOnboarding?.photoForUpload?.() || '';
            if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(dataUrl)) {
                throw Error('Scan your face and take a picture before continuing.');
            }
            const token = await user.getIdToken(true);
            const upload = async profileId => {
                const response = await fetch(
                    'https://us-central1-asiye-80386.cloudfunctions.net/uploadProfileImageProxy',
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            userId: profileId,
                            purpose: 'passenger-profile',
                            filename: 'passenger-face.jpg',
                            fullName: name,
                            completeSignup: true,
                            dataUrl
                        })
                    }
                );
                return { response, uploaded: await response.json().catch(() => ({})) };
            };
            let { response, uploaded } = await upload(id);
            if (response.status === 403 && id !== user.uid) {
                // A legacy commuter record may be linked by phone while
                // belonging to a different Firebase UID. Never overwrite it.
                // Also never abandon stored funds from a legacy wallet.
                if (Number(this.pendingProfile?.walletBalance ||
                           this.pendingProfile?.credits || 0) > 0) {
                    throw Error('This older account has an existing wallet balance. Contact Asiye Support to link it securely before continuing.');
                }
                id = user.uid;
                ({ response, uploaded } = await upload(id));
            }
            if (response.status === 422 && uploaded.code === 'phone-otp-required') {
                this.awaitingPhoneLink = true;
                this.showStep('verifyPhoneStep');
                const phoneError = document.getElementById('socialPhoneError');
                if (phoneError) phoneError.textContent = uploaded.error ||
                    'Verify your number with SMS OTP to complete your profile.';
                return;
            }
            if (!response.ok || !/^https:\/\//.test(String(uploaded.url || ''))) {
                throw Error(response.status === 404
                    ? 'Profile photo service is not deployed (HTTP 404). Ask Asiye Support to publish the Firebase function.'
                    : uploaded.error || 'Could not save your face picture. Please try again.');
            }
            if (!await this.storedFaceAvailable(uploaded.url)) {
                throw Error('Profile image is not downloadable. Ask Asiye Support to check Firebase image storage.');
            }
            // The verified upload function writes the name, OTP phone, face
            // and onboarding status as Admin SDK. Do not do a client write:
            // some legacy commuter IDs are read-only for the WebView.
            await this.completeLogin(id, {
                ...this.pendingProfile,
                name,
                phone: user.phoneNumber || '',
                profileImageUrl: uploaded.url,
                profile_picture_url: uploaded.url,
                passengerProfileImageUrl: uploaded.url,
                faceScanCompleted: true,
                onboardingCompleted: true
            }, user);
        } catch (error) {
            console.warn('Passenger registration incomplete:', error?.code || error?.message);
            const status = document.getElementById('newPassengerFaceStatus');
            if (status) status.textContent = error?.message || 'Unable to save picture. Try again.';
            this.showStep('newPassengerStep');
        } finally {
            if (button) { button.disabled = false; button.textContent = 'Save profile & continue'; }
        }
    },


    /* ========================================================
       COMPLETE LOGIN
       ======================================================== */

    async completeLogin(
        commuterId,
        commuterData,
        user
    ) {
        if (!user?.phoneNumber) {
            this.pendingUser = user;
            this.awaitingPhoneLink = true;
            this.showStep('verifyPhoneStep');
            return;
        }
        if (!(
            String(commuterData?.name || '').trim().length >= 2 &&
            (commuterData?.profileImageUrl || commuterData?.profile_picture_url ||
             commuterData?.passengerProfileImageUrl)
        )) {
            this.pendingUser = user;
            this.pendingProfileId = commuterId || user.uid;
            this.pendingProfile = commuterData;
            document.getElementById('newPassengerName').value = commuterData?.name || user.displayName || '';
            this.showStep('newPassengerStep');
            return;
        }

        const id =
            commuterId ||
            user.uid;


        localStorage.setItem(
            'userId',
            id
        );


        localStorage.setItem(
            'commuterId',
            id
        );


        localStorage.setItem(
            'authUid',
            user.uid
        );


        localStorage.setItem(
            'userType',
            'commuter'
        );


        if (
            user.phoneNumber ||
            this.currentPhone
        ) {

            localStorage.setItem(
                'passengerPhone',
                user.phoneNumber ||
                this.currentPhone
            );
        }


        if (
            commuterData?.name
        ) {

            localStorage.setItem(
                'userName',
                commuterData.name
            );
        }


        const loginPayload =
            JSON.stringify({

                action:
                    'onUserLoggedIn',

                uid:
                    id,

                type:
                    'commuter'
            });


        try {

            if (
                window.Asiye?.postMessage
            ) {

                window.Asiye.postMessage(
                    loginPayload
                );

            } else if (
                window.Android?.postMessage
            ) {

                window.Android.postMessage(
                    loginPayload
                );
            }

        } catch (_) {}


        console.log(
            '✅ Passenger login successful'
        );


        console.log(
            'Commuter ID:',
            id
        );


        console.log(
            'Auth UID:',
            user.uid
        );


        this.toast(
            `Welcome${commuterData?.name ? `, ${commuterData.name}` : ''}.`
        );


        setTimeout(
            () => {

                window.location.replace(
                    './index.html'
                );

            },
            300
        );
    },


    /* ========================================================
       RESEND OTP
       ======================================================== */

    resendOtp() {

        if (
            !this.currentPhone
        ) {

            return;
        }


        clearInterval(
            this.resendInterval
        );


        // Keep the rendered verifier when resending an OTP.



        const input = document.getElementById(
            this.awaitingPhoneLink ? 'socialPhoneInput' : 'passengerPhoneInput'
        );


        if (input) {

            input.value =
                this.currentPhone;
        }


        this.showStep(this.awaitingPhoneLink ? 'verifyPhoneStep' : 'loginStep');


        setTimeout(
            () => {

                this.sendOtp();

            },
            150
        );
    },


    startResendTimer() {

        clearInterval(
            this.resendInterval
        );


        this.resendSeconds =
            30;


        const button =
            document.getElementById(
                'resendOtpButton'
            );


        const timer =
            document.getElementById(
                'resendTimer'
            );


        button.disabled =
            true;


        timer.textContent =
            this.resendSeconds;


        this.resendInterval =

            setInterval(
                () => {

                    this.resendSeconds--;


                    timer.textContent =
                        Math.max(
                            0,
                            this.resendSeconds
                        );


                    if (
                        this.resendSeconds <=
                        0
                    ) {

                        clearInterval(
                            this.resendInterval
                        );


                        button.disabled =
                            false;


                        button.textContent =
                            'Resend code';
                    }

                },
                1000
            );
    },


    /* ========================================================
       UI
       ======================================================== */

    showStep(
        id
    ) {

        document
            .querySelectorAll(
                '.login-step'
            )
            .forEach(
                element => {

                    element.classList
                        .remove(
                            'active'
                        );
                }
            );


        document
            .getElementById(
                id
            )
            ?.classList
            .add(
                'active'
            );
    },


    /* ========================================================
       ERRORS
       ======================================================== */

    handleAuthError(
        error,
        area
    ) {

        let message =
            'Something went wrong. Please try again.';


        switch (
            error?.code
        ) {

            case 'auth/invalid-phone-number':

                message =
                    'Invalid mobile number. Check and try again.';

                break;


            case 'auth/missing-phone-number':

                message =
                    'Enter your mobile number.';

                break;


            case 'auth/quota-exceeded':

                message =
                    'SMS verification is temporarily unavailable. Please try again later.';

                break;


            case 'auth/too-many-requests':

                message =
                    'Too many attempts. Please wait and try again.';

                break;


            case 'auth/invalid-verification-code':

                message =
                    'The verification code is incorrect.';

                break;


            case 'auth/code-expired':

                message =
                    'The verification code expired. Request a new one.';

                break;


            case 'auth/operation-not-allowed':
                message = 'SMS verification is not enabled for this Firebase project or region. Please choose another sign-in method.';
                break;

            case 'auth/captcha-check-failed':

                message =
                    'Security verification failed. Please try again.';

                break;


            case 'auth/network-request-failed':

                message =
                    'Network error. Please check your internet connection.';

                break;
        }


        const target =
            document.getElementById(

                area === 'otp' ? 'otpError' :
                area === 'socialPhone' ? 'socialPhoneError' : 'phoneError'
            );


        if (target) {

            target.textContent =
                message;
        }


        this.toast(
            message
        );
    },


    handleSocialError(
        error,
        provider
    ) {

        console.error(
            `${provider} login failed:`,
            error
        );


        let message =
            `${provider} sign-in failed.`;


        switch (
            error?.code
        ) {

            case 'auth/popup-closed-by-user':

                message =
                    `${provider} sign-in was cancelled.`;

                break;


            case 'auth/popup-blocked':

                message =
                    `Your browser blocked the ${provider} login window.`;

                break;


            case 'auth/operation-not-allowed':

                message =
                    `${provider} login is not enabled in Firebase.`;

                break;


            case 'auth/account-exists-with-different-credential':

                message =
                    'This Asiye account already uses another sign-in method.';

                break;
        }


        this.toast(
            message
        );
    },


    toast(
        message
    ) {

        const element =
            document.getElementById(
                'loginToast'
            );


        if (!element) {

            return;
        }


        element.textContent =
            message;


        element.classList.add(
            'show'
        );


        clearTimeout(
            this.toastTimer
        );


        this.toastTimer =

            setTimeout(
                () => {

                    element.classList
                        .remove(
                            'show'
                        );

                },
                3000
            );
    }

};


/* ============================================================
   START
   ============================================================ */

document.addEventListener(
    'DOMContentLoaded',
    () => {

        ASIYE_PASSENGER_LOGIN
            .init();

    }
);

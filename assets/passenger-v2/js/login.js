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

                    this.showStep(
                        'loginStep'
                    );
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
       RECAPTCHA
       ======================================================== */

    prepareRecaptcha() {

        try {

            if (
                this.recaptchaVerifier
            ) {

                try {
                    this.recaptchaVerifier.clear();
                } catch (_) {}

                this.recaptchaVerifier = null;
            }


            const container =
                document.getElementById('recaptcha-container');

            if (container) {
                container.innerHTML = '';
            }


            this.recaptchaVerifier =

                new firebase.auth
                    .RecaptchaVerifier(

                        'recaptcha-container',

                        {

                            size:
                                'invisible',

                            callback:
                                () => {

                                    console.log(
                                        '✅ Passenger reCAPTCHA passed'
                                    );
                                },

                            'expired-callback':
                                () => {

                                    console.warn(
                                        'Passenger reCAPTCHA expired, resetting verifier.'
                                    );

                                    this.prepareRecaptcha();
                                }
                        }
                    );


            this.recaptchaVerifier
                .render()
                .catch(
                    error => {
                        console.warn(
                            'Passenger reCAPTCHA render warning:',
                            error
                        );
                    }
                );


        } catch (error) {

            console.error(
                'Passenger reCAPTCHA failed:',
                error
            );
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

        const input =
            document.getElementById(
                'passengerPhoneInput'
            );


        const errorElement =
            document.getElementById(
                'phoneError'
            );


        const button =
            document.getElementById(
                'sendOtpButton'
            );


        const phone =
            this.normalizePhone(
                input?.value
            );


        if (!phone) {

            if (errorElement) {

                errorElement.textContent =
                    'Enter a valid South African mobile number.';
            }

            return;
        }


        this.currentPhone =
            phone;


        if (errorElement) {

            errorElement.textContent =
                '';
        }


        if (button) {

            button.disabled =
                true;

            button.innerHTML = `

                <i class="fas fa-circle-notch fa-spin"></i>

                Sending code...

            `;
        }


        try {

            if (!this.recaptchaVerifier) {
                this.prepareRecaptcha();
            }


            this.confirmationResult =

                await firebase
                    .auth()
                    .signInWithPhoneNumber(

                        phone,

                        this.recaptchaVerifier
                    );


            const display =
                document.getElementById(
                    'otpPhoneDisplay'
                );


            if (display) {

                display.textContent =
                    phone;
            }


            this.showStep(
                'otpStep'
            );


            this.startResendTimer();


            setTimeout(() => {
                document.getElementById('passengerOtpInput')?.focus();
            }, 150);


        } catch (error) {

            console.error(
                'Passenger OTP send failed:',
                error
            );


            this.handleAuthError(
                error,
                'phone'
            );


            this.prepareRecaptcha();


        } finally {

            if (button) {

                button.disabled =
                    false;

                button.textContent =
                    'Continue with phone';
            }
        }
    },


    async verifyOtp() {

        const input =
            document.getElementById(
                'passengerOtpInput'
            );


        const errorElement =
            document.getElementById(
                'otpError'
            );


        const button =
            document.getElementById(
                'verifyOtpButton'
            );


        if (!this.confirmationResult) {

            if (errorElement) {
                errorElement.textContent =
                    'Please request a verification code first.';
            }

            this.showStep('loginStep');

            return;
        }


        const code =

            String(
                input?.value ||
                ''
            )
            .replace(
                /\D/g,
                ''
            );


        if (
            code.length !== 6
        ) {

            if (errorElement) {
                errorElement.textContent =
                    'Enter the 6-digit verification code.';
            }

            return;
        }


        if (errorElement) {
            errorElement.textContent = '';
        }


        if (button) {
            button.disabled = true;
            button.innerHTML = `
                <i class="fas fa-circle-notch fa-spin"></i>
                Verifying...
            `;
        }


        let authUser = null;

        try {

            const result =

                await this
                    .confirmationResult
                    .confirm(
                        code
                    );

            authUser = result.user;

        } catch (error) {

            console.error(
                'Passenger OTP confirm failed:',
                error
            );


            this.handleAuthError(
                error,
                'otp'
            );


            if (button) {
                button.disabled = false;
                button.textContent = 'Verify & continue';
            }

            return;
        }


        try {

            this.showStep(
                'profileCheckStep'
            );


            await this.afterAuthentication(
                authUser
            );


        } catch (profileError) {

            console.warn(
                'Post-auth profile setup warning:',
                profileError
            );


            await this.completeLogin(
                authUser.uid,
                {
                    name: authUser.displayName || 'Passenger',
                    phone: authUser.phoneNumber || this.currentPhone || ''
                },
                authUser
            );


        } finally {

            if (button) {
                button.disabled = false;
                button.textContent = 'Verify & continue';
            }
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


        this.pendingUser =
            user;


        this.showStep(
            'profileCheckStep'
        );


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
        const button = document.getElementById('createPassengerProfile');
        const name = String(document.getElementById('newPassengerName')?.value || '').trim();
        if (name.length < 2) { this.toast('Please add your full name.'); return; }
        const dataUrl = window.AsiyePassengerOnboarding?.photo?.() || '';
        if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(dataUrl)) {
            this.toast('Scan your face and take a picture before continuing.');
            return;
        }
        const id = this.pendingProfileId || user.uid;
        if (button) { button.disabled = true; button.textContent = 'Saving face picture…'; }
        try {
            const root = firebase.database().ref(`commuters/${id}`);
            // First save a minimal profile to prove ownership to the
            // authenticated server-side image uploader. Do NOT mark complete.
            await root.update({
                name,
                phone: user.phoneNumber || this.currentPhone || '',
                email: user.email || '',
                authUid: user.uid,
                profileSetupPending: true,
                onboardingCompleted: false
            });
            const token = await user.getIdToken(true);
            const response = await fetch(
                'https://us-central1-asiye-80386.cloudfunctions.net/uploadProfileImageProxy',
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: id,
                        purpose: 'passenger-profile',
                        filename: 'passenger-face.jpg',
                        dataUrl
                    })
                }
            );
            const uploaded = await response.json().catch(() => ({}));
            if (!response.ok || !/^https:\/\//.test(String(uploaded.url || ''))) {
                throw Error(response.status === 404
                    ? 'Profile photo service is unavailable (HTTP 404). The new Firebase function must be deployed.'
                    : uploaded.error || 'Could not save your face picture. Please rescan and try again.');
            }
            if (!await this.storedFaceAvailable(uploaded.url)) {
                throw Error('Image upload returned a broken URL (404). Your profile is not marked complete; retry your face scan.');
            }
            await root.update({
                name,
                profileImageUrl: uploaded.url,
                profile_picture_url: uploaded.url,
                passengerProfileImageUrl: uploaded.url,
                faceScanCompleted: true,
                onboardingCompleted: true,
                profileSetupPending: false,
                profileCompletedAt: firebase.database.ServerValue.TIMESTAMP
            });
            await this.completeLogin(id, { ...this.pendingProfile, name,
                profileImageUrl: uploaded.url,
                profile_picture_url: uploaded.url, onboardingCompleted: true }, user);
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
        if (user?.phoneNumber && !(
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


        this.prepareRecaptcha();


        const input =
            document.getElementById(
                'passengerPhoneInput'
            );


        if (input) {

            input.value =
                this.currentPhone;
        }


        this.showStep(
            'loginStep'
        );


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

                area === 'otp'

                ? 'otpError'

                : 'phoneError'
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

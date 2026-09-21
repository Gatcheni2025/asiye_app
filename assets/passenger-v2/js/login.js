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

    pendingPassengerFaceBlob:
        null,

    pendingPassengerFacePreviewUrl:
        null,

    nativeVerificationId:
        null,

    showAuthProgress(title, message) {
        let overlay = document.getElementById('authProgressOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'authProgressOverlay';
            overlay.className = 'auth-progress-overlay';
            overlay.setAttribute('role', 'status');
            overlay.setAttribute('aria-live', 'polite');
            overlay.innerHTML = `
                <div class="auth-progress-card">
                    <div class="auth-progress-spinner" aria-hidden="true"></div>
                    <h2 id="authProgressTitle"></h2>
                    <p id="authProgressMessage"></p>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        document.getElementById('authProgressTitle').textContent =
            title || 'Signing you in';
        document.getElementById('authProgressMessage').textContent =
            message || 'Please wait while Asiye securely completes authentication.';
        overlay.classList.add('show');
        document.body.classList.add('auth-in-progress');
    },

    hideAuthProgress() {
        document.getElementById('authProgressOverlay')?.classList.remove('show');
        document.body.classList.remove('auth-in-progress');
    },


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


            const profile =

                await this.resolvePassengerProfile(
                    user
                );


            if (profile) {

                await this.completeLogin(

                    profile.id,

                    profile.data,

                    user
                );
            }


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
                'scanPassengerFace'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.scanPassengerFace();
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

                this.recaptchaVerifier
                    .clear();
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
                                }
                        }
                    );


            this.recaptchaVerifier
                .render()
                .catch(
                    console.warn
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
            digits.startsWith(
                '27'
            )
        ) {

            digits =
                digits.substring(2);
        }


        if (
            digits.startsWith(
                '0'
            )
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


        return [

            `+27${digits}`,

            `27${digits}`,

            `0${digits}`,

            digits
        ];
    },


    /* ========================================================
       PHONE OTP
       ======================================================== */

    async sendOtp(forceResend = false) {

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

        this.showAuthProgress(
            'Verifying your number',
            'Please wait while Asiye securely checks this device and sends your code.'
        );


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
            if (window.AsiyeNativeAuth?.post({
                action: 'startPhoneAuth',
                phone,
                forceResend
            })) {
                return;
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


            this.hideAuthProgress();

            this.showStep(
                'otpStep'
            );


            this.startResendTimer();


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

            document
                .getElementById(
                    'otpError'
                )
                .textContent =
                'Enter the 6-digit verification code.';

            return;
        }


        this.showAuthProgress(
            'Signing you in',
            'Checking your verification code and opening your account.'
        );

        try {

            if (
                this.nativeVerificationId &&
                window.AsiyeNativeAuth?.post({
                    action: 'verifyPhoneAuthCode',
                    code
                })
            ) {
                return;
            }

            const result =
                await this.confirmationResult.confirm(
                    code
                );

            this.nativeVerificationId =
                null;

            await this.afterAuthentication(
                result.user
            );


        } catch (error) {

            console.error(
                'Passenger OTP failed:',
                error
            );


            this.handleAuthError(
                error,
                'otp'
            );
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


        this.showAuthProgress(
            'Continue with Google',
            'Complete Google authentication, then Asiye will open your account.'
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
            if (window.AsiyeNativeAuth?.post('triggerGoogleSignIn')) {
                return;
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


        this.showAuthProgress(
            'Continue with Apple',
            'Complete Apple authentication, then Asiye will open your account.'
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
            if (window.AsiyeNativeAuth?.post('triggerAppleSignIn')) {
                return;
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

    async afterAuthentication(
        user
    ) {

        this.hideAuthProgress();


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


        if (profile && profile.data?.liveSelfieVerifiedAt) {

            await this.completeLogin(

                profile.id,

                profile.data,

                user
            );


            return;
        }

        this.pendingProfile = profile || null;


        /*
         * New passenger.
         */

        const nameInput =
            document.getElementById(
                'newPassengerName'
            );


        if (nameInput) {
            nameInput.value =
                profile?.data?.name ||
                user.displayName ||
                '';
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


        return null;
    },


    /* ========================================================
       ATTACH NEW AUTH TO OLD PROFILE
       ======================================================== */

    async attachAuthIdentity(
        commuterId,
        user
    ) {

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
                    null,

                authEmail:
                    user.email ||
                    null,

                authProvider:

                    user.providerData?.[0]
                        ?.providerId ||
                    null,

                authLinkedAt:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP

            });
    },


    /* ========================================================
       NEW PASSENGER LIVE FACE SCAN
       Same native scanner used by the Account page.
       ======================================================== */

    async scanPassengerFace() {

        const button =
            document.getElementById(
                'scanPassengerFace'
            );

        const status =
            document.getElementById(
                'newPassengerFaceStatus'
            );

        const preview =
            document.getElementById(
                'newPassengerFacePreview'
            );

        const placeholder =
            document.getElementById(
                'newPassengerFacePlaceholder'
            );


        if (!button) {
            return;
        }


        button.disabled =
            true;

        button.textContent =
            'Opening face scan…';

        if (status) {
            status.textContent =
                'Centre your face and follow the movement prompts.';
        }


        try {

            if (
                !window.AsiyePhpImageUpload
            ) {
                throw new Error(
                    'Image upload service is unavailable.'
                );
            }


            let blob =
                null;


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

                    if (status) {
                        status.textContent =
                            'Face scan cancelled. No image was saved.';
                    }

                    return;
                }


                blob =
                    AsiyePhpImageUpload
                        .toBlob(
                            result
                        );

            } else if (
                window.AsiyeFaceScanner
            ) {

                const result =
                    await AsiyeFaceScanner
                        .open({
                            title:
                                'Passenger face scan',
                            subtitle:
                                'Centre your face inside the guide. Turn your head and smile when prompted.'
                        });


                blob =
                    result?.blob ||
                    null;

            } else {

                throw new Error(
                    'Live face scan is unavailable in this build.'
                );
            }


            if (!blob) {
                throw new Error(
                    'No verified face image was captured.'
                );
            }


            if (
                typeof AsiyePhpImageUpload
                    .compressProfileImage ===
                    'function'
            ) {
                blob =
                    await AsiyePhpImageUpload
                        .compressProfileImage(
                            blob
                        );
            }


            this.pendingPassengerFaceBlob =
                blob;


            if (
                this.pendingPassengerFacePreviewUrl
            ) {
                URL.revokeObjectURL(
                    this.pendingPassengerFacePreviewUrl
                );
            }


            this.pendingPassengerFacePreviewUrl =
                URL.createObjectURL(
                    blob
                );


            if (preview) {
                preview.src =
                    this.pendingPassengerFacePreviewUrl;

                preview.hidden =
                    false;
            }


            if (placeholder) {
                placeholder.hidden =
                    true;
            }


            if (status) {
                const sizeKb =
                    Math.max(
                        1,
                        Math.round(
                            blob.size /
                            1024
                        )
                    );

                status.textContent =
                    `Face scan complete (${sizeKb} KB). Continue to save your profile.`;
            }


            button.textContent =
                'Rescan face';

        } catch (error) {

            console.error(
                'New passenger face scan failed:',
                error
            );


            if (status) {
                status.textContent =
                    error?.message ||
                    'Could not complete the face scan.';
            }


            button.textContent =
                this.pendingPassengerFaceBlob
                    ? 'Rescan face'
                    : 'Scan face';

        } finally {

            button.disabled =
                false;
        }
    },


    /* ========================================================
       CREATE NEW PASSENGER
       ======================================================== */

    async createPassengerProfile() {

        const user =
            this.pendingUser ||
            firebase.auth()
                .currentUser;


        if (!user) {

            this.toast(
                'Please sign in again.'
            );

            return;
        }


        const name =

            document
                .getElementById(
                    'newPassengerName'
                )
                ?.value
                .trim();


        if (!name) {

            this.toast(
                'Enter your name.'
            );

            return;
        }


        let selfie =
            this.pendingPassengerFaceBlob;

        if (
            !selfie ||
            !String(
                selfie.type ||
                ''
            ).startsWith(
                'image/'
            )
        ) {
            this.toast(
                'Complete the live face scan to continue.'
            );
            return;
        }


        if (
            !window.AsiyePhpImageUpload
        ) {
            this.toast(
                'Image upload service is unavailable.'
            );
            return;
        }


        this.showAuthProgress(
            'Updating your safety profile',
            'Compressing and saving your verified face scan…'
        );


        let photoURL;


        try {

            const uploaded =
                await AsiyePhpImageUpload
                    .upload(
                        selfie,
                        {
                            userId:
                                user.uid,
                            purpose:
                                'passenger-profile',
                            filename:
                                'passenger-profile.jpg'
                        }
                    );


            photoURL =
                uploaded.url;


            try {
                await user
                    .updateProfile({
                        photoURL
                    });
            } catch (profileError) {
                console.warn(
                    'Passenger Auth profile photo update skipped:',
                    profileError
                );
            }

        } catch (error) {

            this.hideAuthProgress();

            console.error(
                'Passenger face scan upload failed:',
                error
            );

            this.toast(
                error?.message ||
                'Could not save your face scan. Check your connection and try again.'
            );

            return;
        }

        const existingProfile = this.pendingProfile?.data || {};

        const profile = {

            ...existingProfile,

            name:
                name,

            phone:
                user.phoneNumber ||
                this.currentPhone ||
                '',

            email:
                user.email ||
                '',

            credits:
                0,

            walletBalance:
                0,

            accountType:
                'passenger',

            authUid:
                user.uid,

            authProvider:

                user.providerData?.[0]
                    ?.providerId ||
                'phone',

            profileImage:
                photoURL,

            profile_picture_url:
                photoURL,

            profileImageUrl:
                photoURL,

            photoURL:
                photoURL,

            profilePhotoUpdatedAt:
                firebase.database.ServerValue.TIMESTAMP,

            liveSelfieVerifiedAt:
                firebase.database.ServerValue.TIMESTAMP,

            createdAt:
                existingProfile.createdAt ||
                firebase.database.ServerValue.TIMESTAMP,

            updatedAt:
                firebase.database.ServerValue.TIMESTAMP
        };


        const profileId = this.pendingProfile?.id || user.uid;

        await firebase
            .database()
            .ref(
                `commuters/${profileId}`
            )
            .update(
                profile
            );


        await this.completeLogin(

            this.pendingProfile?.id || user.uid,

            profile,

            user
        );
    },


    /* ========================================================
       COMPLETE LOGIN
       ======================================================== */

    async completeLogin(
        commuterId,
        commuterData,
        user
    ) {

        localStorage.setItem(
            'userId',
            commuterId
        );


        localStorage.setItem(
            'commuterId',
            commuterId
        );


        localStorage.setItem(
            'authUid',
            user.uid
        );


        localStorage.setItem(
            'userType',
            'passenger'
        );


        console.log(
            '✅ Passenger login successful'
        );


        console.log(
            'Commuter ID:',
            commuterId
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
            400
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

                this.sendOtp(true);

            },
            100
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

        this.hideAuthProgress();

        let message =
            'Something went wrong. Please try again.';


        switch (
            error?.code
        ) {

            case 'auth/invalid-phone-number':

                message =
                    'Invalid mobile number.';

                break;


            case 'auth/too-many-requests':

                message =
                    'Too many attempts. Please wait and try again.';

                break;


            case 'auth/app-not-authorized':

            case 'auth/invalid-app-credential':

                message =
                    'This Asiye app build is not authorized for SMS verification yet. Please update the app or contact Asiye support.';

                break;


            case 'auth/captcha-check-failed':

            case 'auth/missing-client-identifier':

                message =
                    'Phone security verification could not be completed. Please try again.';

                break;


            case 'auth/quota-exceeded':

                message =
                    'SMS verification is temporarily unavailable. Please try again later.';

                break;


            case 'auth/operation-not-allowed':

                message =
                    'Phone sign-in is not enabled for this Asiye build.';

                break;


            case 'auth/invalid-verification-code':

                message =
                    'The verification code is incorrect.';

                break;


            case 'auth/code-expired':

                message =
                    'The verification code expired.';

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
            error?.message || `${provider} sign-in failed.`;


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
   NATIVE FLUTTER AUTH BRIDGE
   ============================================================ */

window.AsiyeNativeAuth = window.AsiyeNativeAuth || {
    post(message) {
        const payload = typeof message === 'string'
            ? message
            : JSON.stringify(message);
        const channel = window.Asiye || window.Android;
        if (!channel || typeof channel.postMessage !== 'function') {
            return false;
        }
        channel.postMessage(payload);
        return true;
    }
};

window.onNativePhoneCodeSent = function (payload) {
    const login = window.ASIYE_PASSENGER_LOGIN;
    login.nativeVerificationId = payload.verificationId;
    login.hideAuthProgress();
    const display = document.getElementById('otpPhoneDisplay');
    if (display) display.textContent = login.currentPhone || '+27';
    login.showStep('otpStep');
    login.startResendTimer();
};

window.onNativePhoneAutoVerified = function (payload) {
    const input = document.getElementById('passengerOtpInput');
    if (input && payload.code) {
        input.value = payload.code;
        window.ASIYE_PASSENGER_LOGIN.verifyOtp();
    }
};

window.onNativePhoneAutoRetrievalTimeout = function (payload) {
    if (!window.ASIYE_PASSENGER_LOGIN.nativeVerificationId) {
        window.ASIYE_PASSENGER_LOGIN.nativeVerificationId = payload.verificationId;
    }
};

window.onNativePhoneAuthError = function (payload) {
    console.error('Native phone auth failed:', payload);
    const login = window.ASIYE_PASSENGER_LOGIN;
    login.nativeVerificationId = null;
    login.handleAuthError(
        { code: 'auth/' + (payload.code || 'native-phone-auth-failed'), message: payload.message },
        'phone'
    );
};

const ASIYE_NATIVE_SESSION_EXCHANGE_URL =
    'https://us-central1-asiye-80386.cloudfunctions.net/exchangeNativeAuthSession';

window.onNativeFirebaseAuthSuccess = async function (payload) {
    const login =
        window.ASIYE_PASSENGER_LOGIN;

    const provider =
        String(
            payload?.provider ||
            'account'
        );

    try {
        if (
            !payload?.firebaseIdToken
        ) {
            throw new Error(
                'The native Firebase session did not return an ID token.'
            );
        }

        login.showAuthProgress(
            'Signing you in',
            'Securing your Asiye session...'
        );

        const response =
            await fetch(
                ASIYE_NATIVE_SESSION_EXCHANGE_URL,
                {
                    method:
                        'POST',

                    headers: {
                        'Authorization':
                            `Bearer ${payload.firebaseIdToken}`,

                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            provider
                        })
                }
            );

        const session =
            await response
                .json()
                .catch(
                    () => ({})
                );

        if (
            !response.ok ||
            !session.customToken
        ) {
            throw new Error(
                session.error ||
                'Unable to create the Asiye Firebase session.'
            );
        }

        const result =
            await firebase
                .auth()
                .signInWithCustomToken(
                    session.customToken
                );

        if (!result.user) {
            throw new Error(
                'Firebase did not return a signed-in user.'
            );
        }

        await login.afterAuthentication(
            result.user
        );

    } catch (error) {
        console.error(
            'Native Firebase session handoff failed:',
            error
        );

        login.hideAuthProgress();

        if (
            provider ===
            'phone'
        ) {
            login.handleAuthError(
                {
                    code:
                        'auth/native-session-failed',

                    message:
                        error?.message ||
                        'Unable to complete phone authentication.'
                },
                'phone'
            );

        } else {
            login.handleSocialError(
                {
                    code:
                        'auth/native-session-failed',

                    message:
                        error?.message ||
                        `${provider} authentication failed.`
                },
                provider === 'apple'
                    ? 'Apple'
                    : 'Google'
            );
        }
    }
};

window.onNativeFirebaseAuthError = function (payload) {
    const login =
        window.ASIYE_PASSENGER_LOGIN;

    const provider =
        String(
            payload?.provider ||
            'account'
        );

    const code =
        String(
            payload?.code ||
            'native-auth-failed'
        );

    const message =
        payload?.message ||
        'Authentication failed.';

    console.error(
        'Native Firebase authentication failed:',
        {
            provider,
            code,
            message
        }
    );

    login.hideAuthProgress();

    if (
        provider ===
        'phone'
    ) {
        login.nativeVerificationId =
            null;

        login.handleAuthError(
            {
                code:
                    `auth/${code}`,

                message
            },
            'phone'
        );

        return;
    }

    login.handleSocialError(
        {
            code:
                `auth/${code}`,

            message:
                `${message} [${code}]`
        },
        provider === 'apple'
            ? 'Apple'
            : 'Google'
    );
};


window.onGoogleNativeLoginSuccess = async function (payload) {
    try {
        if (!payload.idToken) throw new Error('Google did not return an ID token.');
        const credential = firebase.auth.GoogleAuthProvider.credential(payload.idToken);
        const result = await firebase.auth().signInWithCredential(credential);
        await window.ASIYE_PASSENGER_LOGIN.afterAuthentication(result.user);
    } catch (error) {
        window.ASIYE_PASSENGER_LOGIN.handleSocialError(error, 'Google');
    }
};

window.onGoogleNativeLoginError = function (message) {
    window.ASIYE_PASSENGER_LOGIN.handleSocialError(
        { code: 'auth/native-google-failed', message },
        'Google'
    );
};

window.onAppleNativeLoginSuccess = async function (payload) {
    try {
        if (!payload.identityToken || !payload.rawNonce) {
            throw new Error('Apple did not return the required credentials.');
        }
        const provider = new firebase.auth.OAuthProvider('apple.com');
        const credential = provider.credential({
            idToken: payload.identityToken,
            rawNonce: payload.rawNonce
        });
        const result = await firebase.auth().signInWithCredential(credential);
        await window.ASIYE_PASSENGER_LOGIN.afterAuthentication(result.user);
    } catch (error) {
        window.ASIYE_PASSENGER_LOGIN.handleSocialError(error, 'Apple');
    }
};

window.onAppleNativeLoginError = function (message) {
    window.ASIYE_PASSENGER_LOGIN.handleSocialError(
        { code: 'auth/native-apple-failed', message },
        'Apple'
    );
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
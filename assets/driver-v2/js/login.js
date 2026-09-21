/* ============================================================
   ASIYE DRIVER V2
   PHONE LOGIN / OTP
   ============================================================ */

window.ASIYE_DRIVER_LOGIN = {

    confirmationResult:
        null,

    recaptchaVerifier:
        null,

    resendInterval:
        null,

    resendSeconds:
        30,

    currentPhone:
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

    init() {

        if (
            typeof firebase ===
            'undefined'
        ) {

            console.error(
                'Firebase SDK is unavailable.'
            );

            this.toast(
                'Unable to connect to Asiye.'
            );

            return;
        }


        if (
            !firebase.apps ||
            firebase.apps.length === 0
        ) {

            console.error(
                'Firebase has not been initialized.'
            );

            this.toast(
                'Unable to connect to Asiye.'
            );

            return;
        }


        this.bindEvents();

        this.prepareRecaptcha();

        this.checkExistingSession();
    },


    /* ========================================================
       EXISTING SESSION
       ======================================================== */

    async checkExistingSession() {

        const user = firebase.auth().currentUser;

        if (!user) return;

        try {
            const activated = await AsiyeEnrollment.activateApprovedDriver({
                user
            });

            if (activated) return;

            const profile = await AsiyeEnrollment.resolveDriverProfile(user);

            if (profile) {
                window.location.replace('./enrollment.html');
            }
        } catch (error) {
            console.warn(
                'Session check failed:',
                error?.code || error
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
                        'phoneStep'
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
                'tryAnotherNumberButton'
            )
            ?.addEventListener(
                'click',
                async () => {

                    try {

                        await firebase.auth()
                            .signOut();

                    } catch (_) {}


                    localStorage.removeItem(
                        'driverId'
                    );


                    localStorage.removeItem(
                        'userId'
                    );


                    this.showStep(
                        'phoneStep'
                    );
                }
            );


        document
            .getElementById(
                'driverOtpInput'
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
                'driverPhoneInput'
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
    },


    /* ========================================================
       RECAPTCHA
       ======================================================== */

    prepareRecaptcha() {

        try {

            if (
                this.recaptchaVerifier
            ) {

                this.recaptchaVerifier.clear();
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
                                        '✅ reCAPTCHA passed'
                                    );
                                },

                            'expired-callback':
                                () => {

                                    console.warn(
                                        'reCAPTCHA expired'
                                    );
                                }
                        }
                    );


            this.recaptchaVerifier
                .render()
                .catch(
                    error => {

                        console.error(
                            'reCAPTCHA render failed:',
                            error
                        );
                    }
                );


        } catch (error) {

            console.error(
                'Could not create reCAPTCHA:',
                error
            );
        }
    },


    /* ========================================================
       NORMALIZE SOUTH AFRICAN PHONE
       ======================================================== */

    normalizePhone(
        raw
    ) {

        let phone =

            String(raw || '')
            .replace(
                /\D/g,
                ''
            );


        if (
            phone.startsWith('0')
        ) {

            phone =
                phone.substring(1);
        }


        if (
            phone.startsWith('27')
        ) {

            phone =
                phone.substring(2);
        }


        if (
            phone.length !==
            9
        ) {

            return null;
        }


        return `+27${phone}`;
    },


    /* ========================================================
       SEND OTP
       ======================================================== */

    async sendOtp(forceResend = false) {

        const input =
            document.getElementById(
                'driverPhoneInput'
            );


        const error =
            document.getElementById(
                'phoneError'
            );


        const button =
            document.getElementById(
                'sendOtpButton'
            );


        if (!input) return;


        const phone =
            this.normalizePhone(
                input.value
            );


        if (!phone) {

            if (error) {

                error.textContent =
                    'Enter a valid South African mobile number.';
            }


            return;
        }


        if (error) {

            error.textContent =
                '';
        }


        this.currentPhone =
            phone;

        this.showAuthProgress(
            'Verifying your number',
            'Please wait while Asiye securely checks this device and sends your code.'
        );


        if (button) {

            button.disabled =
                true;


            button.innerHTML = `

                <i
                    class="
                        fas
                        fa-circle-notch
                        fa-spin
                    "
                ></i>

                Sending code...

            `;
        }


        try {

            if (
                !this.recaptchaVerifier
            ) {

                this.prepareRecaptcha();
            }
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


            setTimeout(
                () => {

                    document
                        .getElementById(
                            'driverOtpInput'
                        )
                        ?.focus();

                },
                150
            );


        } catch (error) {

            console.error(
                'OTP send failed:',
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
                    'Continue';
            }
        }
    },


    /* ========================================================
       VERIFY OTP
       ======================================================== */

    async verifyOtp() {

        const input =
            document.getElementById(
                'driverOtpInput'
            );


        const errorElement =
            document.getElementById(
                'otpError'
            );


        const button =
            document.getElementById(
                'verifyOtpButton'
            );


        if (!input) {
            return;
        }

        if (!this.nativeVerificationId && !this.confirmationResult) {
            if (errorElement) {
                errorElement.textContent =
                    'Your verification session expired. Please resend the code.';
            }
            this.hideAuthProgress();
            return;
        }


        const code =

            input.value
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

            errorElement.textContent =
                '';
        }


        if (button) {

            button.disabled =
                true;


            button.innerHTML = `

                <i
                    class="
                        fas
                        fa-circle-notch
                        fa-spin
                    "
                ></i>

                Verifying...

            `;
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

            const user =
                result.user;

            if (!user) {
                throw new Error(
                    'Authentication failed.'
                );
            }

            this.showStep(
                'profileCheckStep'
            );

            await this.verifyDriverProfile(
                user
            );


        } catch (error) {

            console.error(
                'OTP verification failed:',
                error
            );


            this.handleAuthError(
                error,
                'otp'
            );


        } finally {

            if (button) {

                button.disabled =
                    false;


                button.textContent =
                    'Verify & Sign in';
            }
        }
    },


    /* ========================================================
       SIGN IN WITH GOOGLE
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

                    <i
                        class="
                            fas
                            fa-circle-notch
                            fa-spin
                        "
                    ></i>

                    Connecting to Google...

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


            if (!result.user) {

                throw new Error(
                    'Google authentication failed.'
                );
            }


            this.showStep(
                'profileCheckStep'
            );


            await this.verifyDriverProfile(
                result.user
            );


        } catch (error) {

            this.hideAuthProgress();

            console.error(
                'Google sign-in failed:',
                error
            );


            if (
                error.code ===
                'auth/popup-closed-by-user'
            ) {

                this.toast(
                    'Google sign-in was cancelled.'
                );

            } else {

                this.handleSocialError(
                    error,
                    'Google'
                );
            }


        } finally {

            if (button) {

                button.disabled =
                    false;


                button.innerHTML = `

                    <span class="social-provider-icon google-icon">
                        G
                    </span>

                    <span>
                        Continue with Google
                    </span>

                `;
            }
        }
    },


    /* ========================================================
       SIGN IN WITH APPLE
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

                    <i
                        class="
                            fas
                            fa-circle-notch
                            fa-spin
                        "
                    ></i>

                    Connecting to Apple...

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


            if (!result.user) {

                throw new Error(
                    'Apple authentication failed.'
                );
            }


            this.showStep(
                'profileCheckStep'
            );


            await this.verifyDriverProfile(
                result.user
            );


        } catch (error) {

            this.hideAuthProgress();

            console.error(
                'Apple sign-in failed:',
                error
            );


            if (
                error.code ===
                'auth/popup-closed-by-user'
            ) {

                this.toast(
                    'Apple sign-in was cancelled.'
                );

            } else {

                this.handleSocialError(
                    error,
                    'Apple'
                );
            }


        } finally {

            if (button) {

                button.disabled =
                    false;


                button.innerHTML = `

                    <i class="fab fa-apple"></i>

                    <span>
                        Continue with Apple
                    </span>

                `;
            }
        }
    },


    /* ========================================================
       VERIFY / RESOLVE DRIVER PROFILE

       Supports:
       1. New profiles keyed by Firebase UID
       2. Legacy profiles keyed by an older UID
       3. Phone-number matching
       4. Email matching for Google / Apple
       ======================================================== */

    async verifyDriverProfile(user) {

        this.hideAuthProgress();

        try {
            this.showStep('profileCheckStep');

            const profile =
                await AsiyeEnrollment.resolveDriverProfile(user);

            if (profile) {
                console.log(
                    '✅ Existing driver profile found:',
                    profile.id
                );

                await this.completeDriverLogin(
                    profile.id,
                    profile.data,
                    user
                );

                return;
            }

            console.warn(
                'Authenticated account is not registered as driver:',
                user.uid
            );

            window.location.replace('./enrollment.html');

        } catch (error) {
            console.error(
                'Driver profile check failed:',
                error
            );

            this.toast(
                'Unable to verify your driver account.'
            );

            this.showStep('phoneStep');
        }
    },


    /* ========================================================
       PHONE VARIANTS
       ======================================================== */

    buildPhoneVariants(rawPhone) {

        if (!rawPhone) {

            return [];
        }


        let digits =

            String(rawPhone)
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
        }


        if (
            digits.startsWith('0')
        ) {

            digits =
                digits.substring(1);
        }


        if (
            digits.length !== 9
        ) {

            return [];
        }


        return [

            `+27${digits}`,

            `27${digits}`,

            `0${digits}`,

            digits

        ];
    },


    /* ========================================================
       COMPLETE DRIVER LOGIN
       ======================================================== */

    async completeDriverLogin(
        driverProfileId,
        driverData,
        authUser
    ) {

        this.hideAuthProgress();


        if (!await AsiyeEnrollment.requireApproval(driverData)) return;

        await AsiyeEnrollment.persistDriverSession(
            {
                id: driverProfileId,
                data: driverData
            },
            authUser
        );

        localStorage.setItem(
            'driverId',
            driverProfileId
        );


        localStorage.setItem(
            'userId',
            driverProfileId
        );


        localStorage.setItem(
            'authUid',
            authUser.uid
        );


        localStorage.setItem(
            'userType',
            'driver'
        );


        if (
            authUser.phoneNumber
        ) {

            localStorage.setItem(
                'driverPhone',
                authUser.phoneNumber
            );
        }


        console.log(
            '✅ Driver authenticated'
        );


        console.log(
            'Profile ID:',
            driverProfileId
        );


        console.log(
            'Firebase Auth UID:',
            authUser.uid
        );


        this.toast(
            `Welcome back${driverData?.name ? `, ${driverData.name}` : ''}.`
        );


        setTimeout(
            () => {

                window.location.replace(
                    './index.html'
                );

            },
            450
        );
    },


    /* ========================================================
       RESEND OTP
       ======================================================== */

    async resendOtp() {

        if (
            !this.currentPhone
        ) {

            return;
        }


        const input =
            document.getElementById(
                'driverPhoneInput'
            );


        if (input) {

            input.value =
                this.currentPhone;
        }


        this.showStep(
            'phoneStep'
        );


        setTimeout(
            () => {

                this.sendOtp(true);

            },
            100
        );
    },


    /* ========================================================
       TIMER
       ======================================================== */

    startResendTimer() {

        if (
            this.resendInterval
        ) {

            clearInterval(
                this.resendInterval
            );
        }


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


        if (button) {

            button.disabled =
                true;
        }


        if (timer) {

            timer.textContent =
                this.resendSeconds;
        }


        this.resendInterval =

            setInterval(
                () => {

                    this.resendSeconds--;


                    if (timer) {

                        timer.textContent =
                            Math.max(
                                0,
                                this.resendSeconds
                            );
                    }


                    if (
                        this.resendSeconds <=
                        0
                    ) {

                        clearInterval(
                            this.resendInterval
                        );


                        this.resendInterval =
                            null;


                        if (button) {

                            button.disabled =
                                false;


                            button.innerHTML =
                                'Resend code';
                        }
                    }

                },
                1000
            );
    },


    /* ========================================================
       SHOW STEP
       ======================================================== */

    showStep(
        stepId
    ) {

        document
            .querySelectorAll(
                '.login-step'
            )
            .forEach(
                step => {

                    step.classList
                        .remove(
                            'active'
                        );
                }
            );


        document
            .getElementById(
                stepId
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
                    'The phone number is invalid.';

                break;


            case 'auth/missing-phone-number':

                message =
                    'Enter your mobile number.';

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


            case 'auth/quota-exceeded':

                message =
                    'SMS verification is temporarily unavailable.';

                break;


            case 'auth/invalid-verification-code':

                message =
                    'The verification code is incorrect.';

                break;


            case 'auth/code-expired':

                message =
                    'The verification code has expired. Request a new one.';

                break;


            case 'auth/captcha-check-failed':

                message =
                    'Security verification failed. Please try again.';

                break;
        }


        const element =

            document.getElementById(

                area === 'otp'

                ? 'otpError'

                : 'phoneError'
            );


        if (element) {

            element.textContent =
                message;
        }


        this.toast(
            message
        );
    },


    /* ========================================================
       SOCIAL LOGIN ERRORS
       ======================================================== */

    handleSocialError(
        error,
        providerName
    ) {

        this.hideAuthProgress();

        console.error(
            `${providerName} authentication error:`,
            error
        );


        let message =

            error?.message || `${providerName} sign-in failed. Please try again.`;


        switch (
            error?.code
        ) {

            case 'auth/popup-blocked':

                message =
                    `Your browser blocked the ${providerName} sign-in window.`;

                break;


            case 'auth/cancelled-popup-request':

            case 'auth/popup-closed-by-user':

                message =
                    `${providerName} sign-in was cancelled.`;

                break;


            case 'auth/account-exists-with-different-credential':

                message =
                    'An Asiye account already exists using another sign-in method. Sign in using your original method first.';

                break;


            case 'auth/operation-not-allowed':

                message =
                    `${providerName} sign-in has not been enabled in Firebase yet.`;

                break;
        }


        this.toast(
            message
        );
    },


    /* ========================================================
       TOAST
       ======================================================== */

    toast(
        message
    ) {

        const toast =
            document.getElementById(
                'loginToast'
            );


        if (!toast) return;


        toast.textContent =
            message;


        toast.classList.add(
            'show'
        );


        clearTimeout(
            this.toastTimeout
        );


        this.toastTimeout =

            setTimeout(
                () => {

                    toast.classList
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
    const login = window.ASIYE_DRIVER_LOGIN;
    login.nativeVerificationId = payload.verificationId;
    login.hideAuthProgress();
    const display = document.getElementById('otpPhoneDisplay');
    if (display) display.textContent = login.currentPhone || '+27';
    login.showStep('otpStep');
    login.startResendTimer();
};

window.onNativePhoneAutoVerified = function (payload) {
    const input = document.getElementById('driverOtpInput');
    if (input && payload.code) {
        input.value = payload.code;
        window.ASIYE_DRIVER_LOGIN.verifyOtp();
    }
};

window.onNativePhoneAutoRetrievalTimeout = function (payload) {
    if (!window.ASIYE_DRIVER_LOGIN.nativeVerificationId) {
        window.ASIYE_DRIVER_LOGIN.nativeVerificationId = payload.verificationId;
    }
};

window.onNativePhoneAuthError = function (payload) {
    console.error('Native phone auth failed:', payload);
    const login = window.ASIYE_DRIVER_LOGIN;
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
        window.ASIYE_DRIVER_LOGIN;

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

        login.showStep(
            'profileCheckStep'
        );

        await login.verifyDriverProfile(
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
        window.ASIYE_DRIVER_LOGIN;

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
        await window.ASIYE_DRIVER_LOGIN.verifyDriverProfile(result.user);
    } catch (error) {
        window.ASIYE_DRIVER_LOGIN.handleSocialError(error, 'Google');
    }
};

window.onGoogleNativeLoginError = function (message) {
    window.ASIYE_DRIVER_LOGIN.handleSocialError(
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
        await window.ASIYE_DRIVER_LOGIN.verifyDriverProfile(result.user);
    } catch (error) {
        window.ASIYE_DRIVER_LOGIN.handleSocialError(error, 'Apple');
    }
};

window.onAppleNativeLoginError = function (message) {
    window.ASIYE_DRIVER_LOGIN.handleSocialError(
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

        ASIYE_DRIVER_LOGIN.init();

    }
);

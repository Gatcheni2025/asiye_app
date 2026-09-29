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


    /* ========================================================
       INIT
       ======================================================== */

    async init() {

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

        try {
            await firebase.auth().setPersistence(
                firebase.auth.Auth.Persistence.LOCAL
            );
        } catch (_) {}

        this.prepareRecaptcha();

        await this.checkExistingSession();
    },


    /* ========================================================
       EXISTING SESSION
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
                    'ℹ️ No existing driver session.'
                );

                return;
            }


            console.log(
                '✅ Existing driver session detected:',
                user.uid
            );


            await this.verifyDriverProfile(
                user
            );


        } catch (error) {

            console.warn(
                'Existing driver session check failed:',
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
                                        '✅ Driver reCAPTCHA passed'
                                    );
                                },

                            'expired-callback':
                                () => {

                                    console.warn(
                                        'Driver reCAPTCHA expired, resetting verifier.'
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
                            'reCAPTCHA render warning:',
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
            phone.startsWith('27') &&
            phone.length === 11
        ) {

            phone =
                phone.substring(2);

        } else if (
            phone.startsWith('0') &&
            phone.length === 10
        ) {

            phone =
                phone.substring(1);
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

    async sendOtp() {

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


        if (
            !this.confirmationResult ||
            !input
        ) {

            if (errorElement) {
                errorElement.textContent =
                    'Please request a verification code first.';
            }

            this.showStep('phoneStep');

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


        let authUser = null;

        try {

            const result =

                await this.confirmationResult
                    .confirm(
                        code
                    );

            authUser = result.user;

        } catch (error) {

            console.error(
                'OTP confirmation failed:',
                error
            );


            this.handleAuthError(
                error,
                'otp'
            );


            if (button) {
                button.disabled = false;
                button.textContent = 'Verify & Sign in';
            }

            return;
        }


        try {

            this.showStep(
                'profileCheckStep'
            );


            await this.verifyDriverProfile(
                authUser
            );


        } catch (profileError) {

            console.warn(
                'Driver profile verification error:',
                profileError
            );


            this.toast(
                'Unable to verify your driver account.'
            );


            this.showStep(
                'phoneStep'
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
       2. Profiles indexed by authUid / userUid
       3. Phone-number matching (local, intl, spaced)
       4. Email matching for Google / Apple
       ======================================================== */

    async verifyDriverProfile(user) {

        try {

            this.showStep(
                'profileCheckStep'
            );


            /* ====================================================
               1. NORMAL UID LOOKUP: taxis/{uid}
            ==================================================== */

            const snapshot =

                await firebase
                    .database()
                    .ref(
                        `taxis/${user.uid}`
                    )
                    .once(
                        'value'
                    );


            if (
                snapshot.exists()
            ) {

                await this.completeDriverLogin(

                    user.uid,

                    snapshot.val(),

                    user
                );

                return;
            }


            console.log(
                'ℹ️ No taxi profile under Auth UID directly. Checking indexed queries and legacy profile...'
            );


            /* ====================================================
               1b. SEARCH BY authUid / userUid
            ==================================================== */

            let legacyMatch = null;

            try {

                const authUidSnap =

                    await firebase
                        .database()
                        .ref('taxis')
                        .orderByChild('authUid')
                        .equalTo(user.uid)
                        .once('value');


                if (authUidSnap.exists()) {

                    authUidSnap.forEach(child => {

                        if (!legacyMatch) {

                            legacyMatch = {
                                id: child.key,
                                data: child.val()
                            };
                        }
                    });
                }

            } catch (_) {}


            if (!legacyMatch) {

                try {

                    const userUidSnap =

                        await firebase
                            .database()
                            .ref('taxis')
                            .orderByChild('userUid')
                            .equalTo(user.uid)
                            .once('value');


                    if (userUidSnap.exists()) {

                        userUidSnap.forEach(child => {

                            if (!legacyMatch) {

                                legacyMatch = {
                                    id: child.key,
                                    data: child.val()
                                };
                            }
                        });
                    }

                } catch (_) {}
            }


            /* ====================================================
               2. SEARCH BY VERIFIED PHONE
            ==================================================== */

            if (!legacyMatch) {

                const phoneVariants =
                    this.buildPhoneVariants(
                        user.phoneNumber ||
                        this.currentPhone
                    );


                for (
                    const phone
                    of phoneVariants
                ) {

                    try {

                        const phoneSnapshot =

                            await firebase
                                .database()
                                .ref('taxis')
                                .orderByChild('phone')
                                .equalTo(phone)
                                .once(
                                    'value'
                                );


                        if (
                            phoneSnapshot.exists()
                        ) {

                            phoneSnapshot.forEach(
                                child => {

                                    if (!legacyMatch) {

                                        legacyMatch = {

                                            id:
                                                child.key,

                                            data:
                                                child.val()
                                        };
                                    }
                                }
                            );


                            if (legacyMatch) {

                                break;
                            }
                        }

                    } catch (_) {}
                }
            }


            /* ====================================================
               3. SEARCH BY EMAIL
               Useful for Google / Apple
            ==================================================== */

            if (
                !legacyMatch &&
                user.email
            ) {

                try {

                    const emailSnapshot =

                        await firebase
                            .database()
                            .ref('taxis')
                            .orderByChild('email')
                            .equalTo(
                                user.email
                            )
                            .once(
                                'value'
                            );


                    if (
                        emailSnapshot.exists()
                    ) {

                        emailSnapshot.forEach(
                            child => {

                                if (!legacyMatch) {

                                    legacyMatch = {

                                        id:
                                            child.key,

                                        data:
                                            child.val()
                                    };
                                }
                            }
                        );
                    }

                } catch (_) {}
            }


            /* ====================================================
               LEGACY PROFILE FOUND
            ==================================================== */

            if (
                legacyMatch
            ) {

                console.log(
                    '✅ Existing driver profile found:',
                    legacyMatch.id
                );


                try {

                    await firebase
                        .database()
                        .ref(
                            `taxis/${legacyMatch.id}`
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

                            authLinkedAt:

                                firebase
                                    .database
                                    .ServerValue
                                    .TIMESTAMP
                        });

                } catch (linkError) {

                    console.warn(
                        'Could not link authUid to taxi profile:',
                        linkError
                    );
                }


                await this.completeDriverLogin(

                    legacyMatch.id,

                    legacyMatch.data,

                    user
                );


                return;
            }


            /* ====================================================
               NO DRIVER FOUND
            ==================================================== */

            console.warn(
                'Authenticated account is not registered as driver:',
                user.uid
            );


            this.showStep(
                'notDriverStep'
            );


        } catch (error) {

            console.error(
                'Driver profile check failed:',
                error
            );


            this.toast(
                'Unable to verify your driver account.'
            );


            this.showStep(
                'phoneStep'
            );
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

        } else if (
            digits.startsWith('0') &&
            digits.length === 10
        ) {

            digits =
                digits.substring(1);
        }


        if (
            digits.length !== 9
        ) {

            return [];
        }


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
       COMPLETE DRIVER LOGIN
       ======================================================== */

    async completeDriverLogin(
        driverProfileId,
        driverData,
        authUser
    ) {

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
            authUser.phoneNumber ||
            this.currentPhone
        ) {

            localStorage.setItem(
                'driverPhone',
                authUser.phoneNumber ||
                this.currentPhone
            );
        }


        if (
            driverData?.name
        ) {

            localStorage.setItem(
                'driverName',
                driverData.name
            );
        }


        const loginPayload =
            JSON.stringify({

                action:
                    'onUserLoggedIn',

                uid:
                    driverProfileId,

                type:
                    'driver'
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
            350
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


        if (
            this.resendInterval
        ) {

            clearInterval(
                this.resendInterval
            );

            this.resendInterval = null;
        }


        this.prepareRecaptcha();


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

                this.sendOtp();

            },
            150
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

        console.error(
            `${providerName} authentication error:`,
            error
        );


        let message =

            `${providerName} sign-in failed. Please try again.`;


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
   START
   ============================================================ */

document.addEventListener(
    'DOMContentLoaded',
    () => {

        ASIYE_DRIVER_LOGIN.init();

    }
);

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

        const user =
            firebase.auth()
                .currentUser;


        if (!user) {

            return;
        }


        try {

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

                localStorage.setItem(
                    'driverId',
                    user.uid
                );


                localStorage.setItem(
                    'userId',
                    user.uid
                );


                localStorage.setItem(
                    'userType',
                    'driver'
                );


                window.location.replace(
                    './index.html'
                );
            }


        } catch (error) {

            console.warn(
                'Session check failed:',
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


        /*
         * 0821234567
         */

        if (
            phone.startsWith('0')
        ) {

            phone =
                phone.substring(1);
        }


        /*
         * 27821234567
         */

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

            /*
             * Recreate verifier if necessary.
             */

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


            /*
             * Reset reCAPTCHA after failure.
             */

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


        try {

            const result =

                await this.confirmationResult
                    .confirm(
                        code
                    );


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
       VERIFY TAXI PROFILE
       ======================================================== */

    async verifyDriverProfile(
        user
    ) {

        try {

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
                !snapshot.exists()
            ) {

                console.warn(
                    'Authenticated account is not registered as driver:',
                    user.uid
                );


                this.showStep(
                    'notDriverStep'
                );


                return;
            }


            const driver =
                snapshot.val();


            /*
             * Save compatibility session values.
             */

            localStorage.setItem(
                'driverId',
                user.uid
            );


            localStorage.setItem(
                'userId',
                user.uid
            );


            localStorage.setItem(
                'userType',
                'driver'
            );


            if (
                driver.phone
            ) {

                localStorage.setItem(
                    'driverPhone',
                    driver.phone
                );
            }


            console.log(
                '✅ Driver login successful:',
                user.uid
            );


            this.toast(
                'Welcome back.'
            );


            setTimeout(
                () => {

                    window.location.replace(
                        './index.html'
                    );

                },
                450
            );


        } catch (error) {

            console.error(
                'Driver profile check failed:',
                error
            );


            this.showStep(
                'phoneStep'
            );


            this.toast(
                'Unable to verify your driver account.'
            );
        }
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

                this.sendOtp();

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
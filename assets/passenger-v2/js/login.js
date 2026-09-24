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


        try {

            const result =

                await this
                    .confirmationResult
                    .confirm(
                        code
                    );


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


        if (profile) {

            await this.completeLogin(

                profile.id,

                profile.data,

                user
            );


            return;
        }


        /*
         * New passenger.
         */

        const nameInput =
            document.getElementById(
                'newPassengerName'
            );


        if (
            nameInput &&
            user.displayName
        ) {

            nameInput.value =
                user.displayName;
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


        const profile = {

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

            createdAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        };


        await firebase
            .database()
            .ref(
                `commuters/${user.uid}`
            )
            .set(
                profile
            );


        await this.completeLogin(

            user.uid,

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

                this.sendOtp();

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

/* ASIYE_NATIVE_AUTH_BRIDGE_V1
   Prefer Flutter native Google/Apple auth inside the Android WebView.
   Browser Firebase popup remains the fallback for normal web usage. */
(() => {
    const login = window.ASIYE_PASSENGER_LOGIN;
    if (!login) return;

    const nativeChannel = () => window.Asiye || window.Android || null;
    const postNative = (message) => {
        const channel = nativeChannel();
        if (!channel || typeof channel.postMessage !== 'function') return false;
        channel.postMessage(message);
        return true;
    };

    const webGoogle = login.signInWithGoogle.bind(login);
    const webApple = login.signInWithApple.bind(login);

    login.signInWithGoogle = async function () {
        if (!postNative('triggerGoogleSignIn')) return webGoogle();
        const button = document.getElementById('googleLoginButton');
        if (button) { button.disabled = true; button.textContent = 'Connecting to Google...'; }
    };

    login.signInWithApple = async function () {
        if (!postNative('triggerAppleSignIn')) return webApple();
        const button = document.getElementById('appleLoginButton');
        if (button) { button.disabled = true; button.textContent = 'Connecting to Apple...'; }
    };

    window.onGoogleNativeLoginSuccess = async (data) => {
        try {
            if (!data?.idToken) throw new Error('Google did not return an ID token.');
            const credential = firebase.auth.GoogleAuthProvider.credential(data.idToken);
            const result = await firebase.auth().signInWithCredential(credential);
            if (!result.user) throw new Error('Google authentication failed.');
            await login.afterAuthentication(result.user);
        } catch (error) {
            console.error('Native Google Firebase sign-in failed:', error);
            login.handleSocialError(error, 'Google');
        } finally {
            const button = document.getElementById('googleLoginButton');
            if (button) { button.disabled = false; button.innerHTML = '<span class="social-provider-icon google-icon">G</span><span>Continue with Google</span>'; }
        }
    };

    window.onGoogleNativeLoginError = (message) => {
        const button = document.getElementById('googleLoginButton');
        if (button) button.disabled = false;
        if (String(message || '').toLowerCase() !== 'cancelled') login.toast('Google sign-in failed. Please try again.');
    };

    window.onAppleNativeLoginSuccess = async (data) => {
        try {
            if (!data?.identityToken) throw new Error('Apple did not return an identity token.');
            const provider = new firebase.auth.OAuthProvider('apple.com');
            const credential = provider.credential({ idToken: data.identityToken });
            const result = await firebase.auth().signInWithCredential(credential);
            if (!result.user) throw new Error('Apple authentication failed.');
            await login.afterAuthentication(result.user);
        } catch (error) {
            console.error('Native Apple Firebase sign-in failed:', error);
            login.handleSocialError(error, 'Apple');
        } finally {
            const button = document.getElementById('appleLoginButton');
            if (button) { button.disabled = false; button.innerHTML = '<i class="fab fa-apple"></i><span>Continue with Apple</span>'; }
        }
    };

    window.onAppleNativeLoginError = (message) => {
        const button = document.getElementById('appleLoginButton');
        if (button) button.disabled = false;
        if (String(message || '').toLowerCase() !== 'cancelled') login.toast('Apple sign-in failed. Please try again.');
    };
})();

/* ASIYE_NATIVE_PHONE_AUTH_V2
   Android uses Firebase's native PhoneAuthProvider so Play Integrity /
   reCAPTCHA app verification happens outside the WebView. Web keeps the
   existing Firebase JS phone flow. */
(() => {
    const login = window.ASIYE_PASSENGER_LOGIN;
    if (!login) return;
    const nativeChannel = () => window.Asiye || window.Android || null;
    const post = payload => {
        const channel = nativeChannel();
        if (!channel || typeof channel.postMessage !== 'function') return false;
        channel.postMessage(JSON.stringify(payload));
        return true;
    };
    const webSendOtp = login.sendOtp.bind(login);
    const webVerifyOtp = login.verifyOtp.bind(login);

    login.sendOtp = async function () {
        const input = document.getElementById('passengerPhoneInput');
        const phone = this.normalizePhone(input?.value);
        if (!phone || !post({ action: 'startPhoneSignIn', phone })) return webSendOtp();
        this.currentPhone = phone;
        const button = document.getElementById('sendOtpButton');
        if (button) { button.disabled = true; button.textContent = 'Sending code...'; }
        const error = document.getElementById('phoneError');
        if (error) error.textContent = '';
    };

    login.verifyOtp = async function () {
        if (!this.nativeVerificationId) return webVerifyOtp();
        const code = String(document.getElementById('passengerOtpInput')?.value || '').replace(/\D/g,'');
        if (code.length !== 6) {
            const el = document.getElementById('otpError');
            if (el) el.textContent = 'Enter the 6-digit verification code.';
            return;
        }
        post({ action: 'verifyPhoneOtp', verificationId: this.nativeVerificationId, code });
    };

    window.onNativePhoneCodeSent = verificationId => {
        login.nativeVerificationId = verificationId;
        const display = document.getElementById('otpPhoneDisplay');
        if (display) display.textContent = login.currentPhone || '+27';
        login.showStep('otpStep');
        login.startResendTimer();
        const button = document.getElementById('sendOtpButton');
        if (button) { button.disabled = false; button.textContent = 'Continue with phone'; }
    };

    window.onNativePhoneCodeTimeout = verificationId => {
        login.nativeVerificationId = verificationId || login.nativeVerificationId;
    };

    window.onNativePhoneAuthSuccess = async idToken => {
        try {
            const result = await firebase.auth().signInWithCustomToken ? null : null;
            // Native and WebView Firebase SDKs do not automatically share Auth state.
            // Exchange the native Firebase ID token through the existing backend session bridge.
            const response = await fetch('https://us-central1-asiye-80386.cloudfunctions.net/exchangeNativeAuthSession', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const payload = await response.json();
            if (!response.ok || !payload.customToken) throw new Error(payload.error || 'Unable to verify the native session.');
            const signedIn = await firebase.auth().signInWithCustomToken(payload.customToken);
            if (!signedIn.user) throw new Error('Phone authentication failed.');
            await login.afterAuthentication(result.user);
        } catch (error) {
            console.error('Native phone session exchange failed:', error);
            login.toast(error.message || 'Phone authentication failed.');
        }
    };

    window.onNativePhoneAuthError = message => {
        const error = document.getElementById(login.nativeVerificationId ? 'otpError' : 'phoneError');
        if (error) error.textContent = String(message || 'Phone authentication failed.');
        const button = document.getElementById('sendOtpButton');
        if (button) { button.disabled = false; button.textContent = 'Continue with phone'; }
        login.toast(String(message || 'Phone authentication failed.'));
    };
})();

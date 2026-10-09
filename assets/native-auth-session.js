/* ============================================================
   ASIYE NATIVE AUTH SESSION BRIDGE — BUILD 316
   ------------------------------------------------------------
   Installed app:
     Native Firebase -> native exchange -> custom token -> WebView
   Hosted website:
     Existing Firebase JS authentication remains unchanged.

   This file deliberately owns every installed-app auth callback so
   driver and passenger cannot drift into different implementations.
   ============================================================ */
(() => {
    'use strict';

    const driverLogin =
        window.ASIYE_DRIVER_LOGIN || null;
    const passengerLogin =
        window.ASIYE_PASSENGER_LOGIN || null;
    const login =
        driverLogin || passengerLogin;

    if (!login || typeof firebase === 'undefined') {
        return;
    }

    const role =
        driverLogin ? 'driver' : 'passenger';

    const ids =
        role === 'driver'
            ? {
                phone: 'driverPhoneInput',
                otp: 'driverOtpInput',
                send: 'sendOtpButton',
                verify: 'verifyOtpButton',
                resend: 'resendOtpButton'
            }
            : {
                phone: 'passengerPhoneInput',
                otp: 'passengerOtpInput',
                send: 'sendOtpButton',
                verify: 'verifyOtpButton',
                resend: 'resendOtpButton'
            };

    const nativeChannel = () =>
        window.Asiye ||
        window.Android ||
        null;

    const postNative = payload => {
        const channel =
            nativeChannel();

        if (
            !channel ||
            typeof channel.postMessage !==
                'function'
        ) {
            return false;
        }

        channel.postMessage(
            typeof payload === 'string'
                ? payload
                : JSON.stringify(payload)
        );

        return true;
    };

    const isInstalledApp = () =>
        Boolean(nativeChannel());

    const pendingPhoneKey =
        'asiyePendingPhoneAuthNumber';
    const pendingVerificationKey =
        'asiyePendingPhoneAuthVerificationId';
    const pendingStartedAtKey =
        'asiyePendingPhoneAuthStartedAt';
    const pendingTtlMs =
        5 * 60 * 1000;

    let sessionPromise = null;

    const original = {
        prepareRecaptcha:
            typeof login.prepareRecaptcha === 'function'
                ? login.prepareRecaptcha.bind(login)
                : null,
        sendOtp:
            typeof login.sendOtp === 'function'
                ? login.sendOtp.bind(login)
                : null,
        resendOtp:
            typeof login.resendOtp === 'function'
                ? login.resendOtp.bind(login)
                : null,
        verifyOtp:
            typeof login.verifyOtp === 'function'
                ? login.verifyOtp.bind(login)
                : null,
        google:
            typeof login.signInWithGoogle === 'function'
                ? login.signInWithGoogle.bind(login)
                : null,
        apple:
            typeof login.signInWithApple === 'function'
                ? login.signInWithApple.bind(login)
                : null
    };

    const setButton = (
        id,
        disabled,
        text
    ) => {
        const button =
            document.getElementById(id);

        if (!button) return;

        button.disabled =
            Boolean(disabled);

        if (text) {
            button.textContent =
                text;
        }
    };

    const savePendingPhoneState = (
        phone,
        verificationId = ''
    ) => {
        if (phone) {
            localStorage.setItem(
                pendingPhoneKey,
                phone
            );
            localStorage.setItem(
                pendingStartedAtKey,
                String(Date.now())
            );
        }

        if (verificationId) {
            localStorage.setItem(
                pendingVerificationKey,
                verificationId
            );
        } else {
            localStorage.removeItem(
                pendingVerificationKey
            );
        }
    };

    const clearPendingPhoneState = () => {
        localStorage.removeItem(
            pendingPhoneKey
        );
        localStorage.removeItem(
            pendingVerificationKey
        );
        localStorage.removeItem(
            pendingStartedAtKey
        );

        login.nativeVerificationId =
            null;
        login.confirmationResult =
            null;
    };

    const showOtpStep = (
        phone,
        verificationId
    ) => {
        if (phone) {
            login.currentPhone =
                phone;

            const phoneInput =
                document.getElementById(
                    ids.phone
                );

            if (phoneInput) {
                phoneInput.value =
                    phone.replace(
                        /^\+27/,
                        '0'
                    );
            }
        }

        if (verificationId) {
            login.nativeVerificationId =
                verificationId;
        }

        if (
            login.currentPhone ||
            login.nativeVerificationId
        ) {
            savePendingPhoneState(
                login.currentPhone,
                login.nativeVerificationId
            );
        }

        const display =
            document.getElementById(
                'otpPhoneDisplay'
            );

        if (display) {
            display.textContent =
                login.currentPhone ||
                '+27';
        }

        if (
            login.nativeVerificationId &&
            typeof login.showStep ===
                'function'
        ) {
            login.showStep(
                'otpStep'
            );
        }

        const otpStep =
            document.getElementById(
                'otpStep'
            );
        const otpInput =
            document.getElementById(
                ids.otp
            );

        if (
            otpStep &&
            login.nativeVerificationId
        ) {
            otpStep.classList?.add?.(
                'active'
            );
            otpStep.style.display =
                'block';
            otpStep.removeAttribute?.(
                'hidden'
            );
        }

        if (
            otpInput &&
            login.nativeVerificationId
        ) {
            otpInput.style.display =
                'block';
            otpInput.style.visibility =
                'visible';
            otpInput.style.opacity =
                '1';
            otpInput.disabled =
                false;
        }

        if (
            login.nativeVerificationId &&
            typeof login.startResendTimer ===
                'function'
        ) {
            login.startResendTimer();
        }

        setButton(
            ids.send,
            false,
            role === 'driver'
                ? 'Continue'
                : 'Continue with phone'
        );
    };

    const restorePendingPhoneState =
        state => {

            const phone =
                String(
                    state?.phone ||
                    localStorage.getItem(
                        pendingPhoneKey
                    ) ||
                    ''
                ).trim();

            const verificationId =
                String(
                    state?.verificationId ||
                    localStorage.getItem(
                        pendingVerificationKey
                    ) ||
                    ''
                ).trim();

            const startedAt =
                Number(
                    localStorage.getItem(
                        pendingStartedAtKey
                    ) || 0
                );
            const fresh =
                startedAt > 0 &&
                Date.now() - startedAt <
                    pendingTtlMs;

            // Never let stale OTP state take over the landing screen.
            // Native callbacks with a current verificationId are authoritative;
            // localStorage is only a short-lived recovery aid.
            if (
                !state?.verificationId &&
                (!fresh || !verificationId)
            ) {
                clearPendingPhoneState();
                return;
            }

            if (phone) {
                login.currentPhone =
                    phone;
            }

            if (verificationId) {
                login.nativeVerificationId =
                    verificationId;
            }

            showOtpStep(
                phone,
                verificationId
            );
        };

    const setSocialButtonReady =
        provider => {

            if (
                provider ===
                'google'
            ) {
                const button =
                    document.getElementById(
                        'googleLoginButton'
                    );

                if (button) {
                    button.disabled =
                        false;
                    button.innerHTML =
                        '<span class="social-provider-icon google-icon">G</span><span>Continue with Google</span>';
                }
            }

            if (
                provider ===
                'apple'
            ) {
                const button =
                    document.getElementById(
                        'appleLoginButton'
                    );

                if (button) {
                    button.disabled =
                        false;
                    button.innerHTML =
                        '<i class="fab fa-apple"></i><span>Continue with Apple</span>';
                }
            }
        };

    const showError = payload => {
        const provider =
            String(
                payload?.provider ||
                'authentication'
            ).toLowerCase();

        const rawMessage =
            String(
                payload?.message ||
                'Authentication failed. Please try again.'
            );

        const cancelled =
            /cancelled|canceled/i.test(
                rawMessage
            );

        if (cancelled) {
            setSocialButtonReady(
                provider
            );
            return;
        }

        let message =
            rawMessage
                .replace(
                    /^Exception:\s*/i,
                    ''
                )
                .replace(
                    /^FirebaseAuthException:\s*/i,
                    ''
                );

        if (/invalid-verification-code/i.test(message)) {
            message = 'That verification code is incorrect. Check the SMS and try again.';
        } else if (/session-expired|invalid-verification-id/i.test(message)) {
            message = 'This verification code has expired. Tap Resend code to request a new one.';
        } else if (/invalid-phone-number/i.test(message)) {
            message = 'Enter a valid South African mobile number, for example 082 123 4567.';
        } else if (/too-many-requests|quota-exceeded/i.test(message)) {
            message = 'Too many verification attempts. Please wait before trying again.';
        } else if (/invalid-app-credential|app-not-authorized|valid app identifier|play integrity/i.test(message)) {
            message = 'We could not verify this app installation. Please update Asiye or contact support.';
        } else if (
            /network|socket|timed out|timeout/i
                .test(message)
        ) {
            message =
                'Unable to reach the authentication service. Check your internet connection and try again.';
        } else if (
            /native firebase authentication is required/i
                .test(message) ||
            /unable to verify the native firebase session/i
                .test(message)
        ) {
            message =
                'Your secure login session could not be completed. Please try signing in again.';
        }

        if (
            provider ===
            'phone'
        ) {
            const error =
                document.getElementById(
                    login.nativeVerificationId
                        ? 'otpError'
                        : 'phoneError'
                );

            if (error) {
                error.textContent =
                    message;
            }

            setButton(
                ids.send,
                false,
                role === 'driver'
                    ? 'Continue'
                    : 'Continue with phone'
            );

            const resend =
                document.getElementById(
                    ids.resend
                );

            if (
                resend &&
                (!login.resendSeconds ||
                    login.resendSeconds <= 0)
            ) {
                resend.disabled =
                    false;
            }
        }

        setSocialButtonReady(
            provider
        );

        if (
            typeof login.toast ===
            'function'
        ) {
            login.toast(
                message
            );
        }

        console.error(
            'Native authentication failed:',
            provider,
            rawMessage
        );
    };

    const completeRoleLogin =
        async user => {

            if (
                role ===
                'driver'
            ) {
                await driverLogin
                    .verifyDriverProfile(
                        user
                    );
                return;
            }

            await passengerLogin
                .afterAuthentication(
                    user
                );
        };

    const acceptNativeSession =
        async payload => {

            if (
                !payload ||
                !payload.customToken
            ) {
                throw new Error(
                    'The native login did not return a secure Asiye session.'
                );
            }

            if (
                !firebase.apps ||
                firebase.apps.length === 0
            ) {
                throw new Error(
                    'Firebase is not ready. Please reopen Asiye and try again.'
                );
            }

            try {
                await firebase
                    .auth()
                    .setPersistence(
                        firebase.auth.Auth
                            .Persistence
                            .LOCAL
                    );
            } catch (_) {}

            const result =
                await firebase
                    .auth()
                    .signInWithCustomToken(
                        payload.customToken
                    );

            const user =
                result?.user;

            if (!user) {
                throw new Error(
                    'Firebase did not return an authenticated user.'
                );
            }

            if (
                payload.uid &&
                String(payload.uid) !==
                    String(user.uid)
            ) {
                await firebase
                    .auth()
                    .signOut()
                    .catch(
                        () => {}
                    );

                throw new Error(
                    'Authentication session mismatch. Please sign in again.'
                );
            }

            clearPendingPhoneState();

            if (
                payload.provider ===
                    'phone' &&
                typeof login.toast ===
                    'function'
            ) {
                login.toast(
                    'OTP verified successfully. Signing you in...'
                );
            }

            await completeRoleLogin(
                user
            );

            return user;
        };

    /* ---------------------------------------------------------
       Installed-app provider triggers
       --------------------------------------------------------- */

    login.prepareRecaptcha =
        function () {

            if (
                !isInstalledApp()
            ) {
                return original
                    .prepareRecaptcha?.();
            }

            try {
                this.recaptchaVerifier
                    ?.clear?.();
            } catch (_) {}

            this.recaptchaVerifier =
                null;

            const container =
                document.getElementById(
                    'recaptcha-container'
                );

            if (container) {
                container.innerHTML =
                    '';
            }
        };

    login.sendOtp =
        async function () {

            if (
                !isInstalledApp()
            ) {
                return original
                    .sendOtp?.();
            }

            const input =
                document.getElementById(
                    ids.phone
                );
            const phone =
                this.normalizePhone?.(
                    input?.value
                );

            if (!phone) {
                const error =
                    document.getElementById(
                        'phoneError'
                    );

                if (error) {
                    error.textContent =
                        'Enter a valid South African mobile number.';
                }

                return;
            }

            this.currentPhone =
                phone;
            this.nativeVerificationId =
                null;

            savePendingPhoneState(
                phone
            );

            setButton(
                ids.send,
                true,
                'Sending code...'
            );

            const error =
                document.getElementById(
                    'phoneError'
                );

            if (error) {
                error.textContent =
                    '';
            }

            if (
                !postNative({
                    action:
                        'startPhoneSignIn',
                    phone
                })
            ) {
                setButton(
                    ids.send,
                    false,
                    role === 'driver'
                        ? 'Continue'
                        : 'Continue with phone'
                );

                showError({
                    provider:
                        'phone',
                    message:
                        'Native phone authentication is unavailable. Please reopen Asiye.'
                });
            }
        };

    login.resendOtp =
        async function () {

            if (
                !isInstalledApp()
            ) {
                return original
                    .resendOtp?.();
            }

            const phone =
                this.currentPhone ||
                localStorage.getItem(
                    pendingPhoneKey
                );

            if (!phone) {
                showError({
                    provider:
                        'phone',
                    message:
                        'Enter your mobile number before requesting another code.'
                });
                return;
            }

            setButton(
                ids.resend,
                true,
                'Sending new code...'
            );

            postNative({
                action:
                    'resendPhoneOtp',
                phone
            });
        };

    login.verifyOtp =
        async function () {

            if (
                !isInstalledApp()
            ) {
                return original
                    .verifyOtp?.();
            }

            const code =
                String(
                    document.getElementById(
                        ids.otp
                    )?.value ||
                    ''
                )
                .replace(
                    /\D/g,
                    ''
                );

            if (
                code.length !==
                6
            ) {
                const error =
                    document.getElementById(
                        'otpError'
                    );

                if (error) {
                    error.textContent =
                        'Enter the 6-digit verification code.';
                }
                return;
            }

            postNative({
                action:
                    'verifyPhoneOtp',
                verificationId:
                    this.nativeVerificationId ||
                    '',
                code
            });
        };

    login.signInWithGoogle =
        async function () {

            if (
                !isInstalledApp()
            ) {
                return original
                    .google?.();
            }

            const button =
                document.getElementById(
                    'googleLoginButton'
                );

            if (button) {
                button.disabled =
                    true;
                button.textContent =
                    'Connecting to Google...';
            }

            postNative(
                'triggerGoogleSignIn'
            );
        };

    login.signInWithApple =
        async function () {

            if (
                !isInstalledApp()
            ) {
                return original
                    .apple?.();
            }

            const button =
                document.getElementById(
                    'appleLoginButton'
                );

            if (button) {
                button.disabled =
                    true;
                button.textContent =
                    'Connecting to Apple...';
            }

            postNative(
                'triggerAppleSignIn'
            );
        };

    const wireProviderButtons = () => {
        const send = document.getElementById(ids.send);
        const google = document.getElementById('googleLoginButton');
        const apple = document.getElementById('appleLoginButton');

        // Bind directly as well as overriding the login methods. This removes
        // dependency on whichever listener an older role login script attached
        // during DOMContentLoaded.
        if (send && !send.dataset.asiyeNativeBound) {
            send.dataset.asiyeNativeBound = '1';
            send.addEventListener('click', event => {
                if (!isInstalledApp()) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                login.sendOtp();
            }, true);
        }
        if (google && !google.dataset.asiyeNativeBound) {
            google.dataset.asiyeNativeBound = '1';
            google.addEventListener('click', event => {
                if (!isInstalledApp()) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                login.signInWithGoogle();
            }, true);
        }
        if (apple && !apple.dataset.asiyeNativeBound) {
            apple.dataset.asiyeNativeBound = '1';
            apple.addEventListener('click', event => {
                if (!isInstalledApp()) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                login.signInWithApple();
            }, true);
        }
    };

    /* ---------------------------------------------------------
       Native callbacks
       --------------------------------------------------------- */

    window.onNativePhoneCodeSent =
        (
            verificationId,
            phone
        ) => {
            showOtpStep(
                phone ||
                    login.currentPhone,
                verificationId
            );
        };

    window.onNativePhoneCodeTimeout =
        (
            verificationId,
            phone
        ) => {
            showOtpStep(
                phone ||
                    login.currentPhone,
                verificationId ||
                    login.nativeVerificationId
            );
        };

    window.onNativePhoneAuthRestored =
        state => {
            restorePendingPhoneState(
                state || {}
            );
        };

    window.onNativePhoneAuthError =
        message => {
            showError({
                provider:
                    'phone',
                message
            });
        };

    window.onNativeAuthSession =
        payload => {

            if (sessionPromise) {
                return sessionPromise;
            }

            sessionPromise =
                acceptNativeSession(
                    payload
                )
                .catch(error => {
                    showError({
                        provider:
                            payload?.provider,
                        message:
                            error?.message ||
                            String(error)
                    });

                    throw error;
                })
                .finally(() => {
                    sessionPromise =
                        null;
                });

            return sessionPromise;
        };

    window.onNativeAuthSessionError =
        payload => {
            showError(
                payload || {}
            );
        };

    wireProviderButtons();

    // Compatibility aliases for a partially upgraded WebView/native pair.
    window.onNativePhoneAuthSuccess =
        payload => {

            if (
                payload &&
                typeof payload ===
                    'object' &&
                payload.customToken
            ) {
                return window
                    .onNativeAuthSession({
                        ...payload,
                        provider:
                            'phone'
                    });
            }

            showError({
                provider:
                    'phone',
                message:
                    'This login attempt was started by an older authentication flow. Please request a new code.'
            });
        };

    window.onGoogleNativeLoginSuccess =
        payload => {

            if (
                payload?.customToken
            ) {
                return window
                    .onNativeAuthSession({
                        ...payload,
                        provider:
                            'google'
                    });
            }

            showError({
                provider:
                    'google',
                message:
                    'Please retry Google sign-in using the updated Asiye authentication.'
            });
        };

    window.onAppleNativeLoginSuccess =
        payload => {

            if (
                payload?.customToken
            ) {
                return window
                    .onNativeAuthSession({
                        ...payload,
                        provider:
                            'apple'
                    });
            }

            showError({
                provider:
                    'apple',
                message:
                    'Please retry Apple sign-in using the updated Asiye authentication.'
            });
        };

    window.onGoogleNativeLoginError =
        message => {
            showError({
                provider:
                    'google',
                message
            });
        };

    window.onAppleNativeLoginError =
        message => {
            showError({
                provider:
                    'apple',
                message
            });
        };

    window.onNativeFirebaseAuthError =
        payload => {
            showError(
                payload || {}
            );
        };

    queueMicrotask(() => {
        if (
            isInstalledApp()
        ) {
            restorePendingPhoneState(
                {}
            );
        }
    });
})();

/* ============================================================
   ASIYE NATIVE AUTH SESSION BRIDGE
   One native Firebase authentication path for Android/iOS.
   Flutter exchanges the native Firebase ID token server-side and
   gives this WebView only a Firebase custom token.
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

    let sessionPromise = null;

    const pendingPhoneKeys = [
        'asiyePendingPhoneAuthNumber',
        'asiyePendingPhoneAuthVerificationId'
    ];

    const clearPendingPhoneState = () => {
        pendingPhoneKeys.forEach(
            key => localStorage.removeItem(key)
        );

        login.nativeVerificationId = null;
        login.confirmationResult = null;
    };

    const setSocialButtonReady = provider => {
        if (provider === 'google') {
            const button =
                document.getElementById(
                    'googleLoginButton'
                );

            if (button) {
                button.disabled = false;
                button.innerHTML =
                    '<span class="social-provider-icon google-icon">G</span><span>Continue with Google</span>';
            }
        }

        if (provider === 'apple') {
            const button =
                document.getElementById(
                    'appleLoginButton'
                );

            if (button) {
                button.disabled = false;
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
            setSocialButtonReady(provider);
            return;
        }

        let message =
            rawMessage
                .replace(/^Exception:\s*/i, '')
                .replace(/^FirebaseAuthException:\s*/i, '');

        if (
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

        if (provider === 'phone') {
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

            const sendButton =
                document.getElementById(
                    'sendOtpButton'
                );

            if (sendButton) {
                sendButton.disabled = false;
                sendButton.textContent =
                    role === 'driver'
                        ? 'Continue'
                        : 'Continue with phone';
            }
        }

        setSocialButtonReady(provider);

        if (
            typeof login.toast ===
            'function'
        ) {
            login.toast(message);
        }

        console.error(
            'Native authentication failed:',
            provider,
            rawMessage
        );
    };

    const completeRoleLogin =
        async user => {

            if (role === 'driver') {
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
                    .catch(() => {});

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

    window.onNativeAuthSession =
        payload => {

            // Prevent duplicate provider callbacks from creating competing
            // redirects/profile queries. The active attempt is reused.
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

    // Compatibility aliases for any native callback that reaches the
    // WebView during an app upgrade. New build 316 uses onNativeAuthSession.
    window.onNativePhoneAuthSuccess =
        payload => {

            if (
                payload &&
                typeof payload ===
                    'object' &&
                payload.customToken
            ) {
                return window
                    .onNativeAuthSession(
                        {
                            ...payload,
                            provider:
                                'phone'
                        }
                    );
            }

            showError({
                provider:
                    'phone',
                message:
                    'This login attempt was started by an older authentication flow. Please request a new code.'
            });
        };

    window.onNativeFirebaseAuthError =
        payload => {
            showError(
                payload || {}
            );
        };
})();

/* Passenger sign-in: Google / Apple. Live face capture is deferred to booking. */
window.ASIYE_PASSENGER_LOGIN = {
    pendingUser: null,
    awaitingPhoneLink: false,
    confirmationResult: null,
    async init() {
        this.bindEvents();
        try {
            await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            const user = await new Promise((resolve, reject) => {
                let unsubscribe;
                unsubscribe = firebase.auth().onAuthStateChanged(user => {
                    queueMicrotask(() => unsubscribe?.());
                    resolve(user);
                }, reject);
            });
            if (user) await this.afterAuthentication(user);
        } catch (error) {
            this.showStep('loginStep');
            this.toast(error.message || 'Unable to sign in. Please try again.');
        }
    },
    bindEvents() {
        document.getElementById('googleLoginButton')?.addEventListener('click', () => this.signInWithGoogle());
        document.getElementById('appleLoginButton')?.addEventListener('click', () => this.signInWithApple());
        document.getElementById('loginBackButton')?.addEventListener('click', () => window.location.replace('./index.html'));
    },
    async socialSignIn(provider, buttonId) {
        const button = document.getElementById(buttonId);
        if (button?.disabled) return;
        if (button) button.disabled = true;
        try {
            const result = await firebase.auth().signInWithPopup(provider);
            await this.afterAuthentication(result.user);
        } catch (error) {
            this.showStep('loginStep');
            this.toast(error.code === 'auth/popup-closed-by-user' ? 'Sign-in cancelled. Choose Google or Apple to continue.' :
                error.code === 'auth/account-exists-with-different-credential' ? 'Use the sign-in provider already linked to your Asiye account.' :
                error.message || 'Sign-in failed. Please try again.');
        } finally { if (button) button.disabled = false; }
    },
    signInWithGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({prompt: 'select_account'});
        return this.socialSignIn(provider, 'googleLoginButton');
    },
    signInWithApple() {
        const provider = new firebase.auth.OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        return this.socialSignIn(provider, 'appleLoginButton');
    },
    async afterAuthentication(user) {
        if (!user) throw new Error('Please sign in again.');
        if (!user.providerData?.some(p => ['google.com', 'apple.com'].includes(p.providerId))) {
            this.showStep('loginStep');
            this.toast('Continue with Google or Apple to use your passenger account.');
            return;
        }
        if (this.finishingLogin) return this.finishingLogin;
        this.pendingUser = user;
        this.showStep('profileCheckStep');
        this.finishingLogin = (async () => {
            let profile = await this.resolvePassengerProfile(user);
            if (!profile) {
                // No photo, phone or wallet fields are needed to enter the app.
                const data = {authUid: user.uid, name: String(user.displayName || '').trim(),
                    email: user.email || '', createdAt: firebase.database.ServerValue.TIMESTAMP};
                // Transaction preserves a profile created concurrently in another tab.
                const result = await firebase.database().ref(`commuters/${user.uid}`)
                    .transaction(current => current || data);
                profile = {id: user.uid, data: result.snapshot.val()};
            }
            await this.completeLogin(profile.id, profile.data, user);
        })();
        try { return await this.finishingLogin; }
        catch (error) { this.showStep('loginStep'); throw error; }
        finally { this.finishingLogin = null; }
    },
    async resolvePassengerProfile(user) {
        const direct = await firebase.database().ref(`commuters/${user.uid}`).once('value');
        if (direct.exists()) return {id: user.uid, data: direct.val()};
        const linked = await firebase.database().ref('commuters').orderByChild('authUid').equalTo(user.uid).once('value');
        let profile = null;
        linked.forEach(child => { if (!profile) profile = {id: child.key, data: child.val()}; });
        // Never claim a different user's profile by an editable email/phone field.
        return profile;
    },
    async completeLogin(id, data, user) {
        if (!user?.providerData?.some(p => ['google.com', 'apple.com'].includes(p.providerId))) {
            this.showStep('loginStep'); return;
        }
        if (id !== user.uid && data?.authUid !== user.uid) throw new Error('Passenger account ownership could not be confirmed.');
        for (const [key, value] of Object.entries({userId: id, commuterId: id, authUid: user.uid,
            userType: 'commuter', userName: data?.name || ''})) localStorage.setItem(key, value);
        localStorage.removeItem('passengerPhone');
        const message = JSON.stringify({action: 'onUserLoggedIn', uid: id, type: 'commuter'});
        (window.Asiye || window.Android)?.postMessage?.(message);
        window.location.replace('./index.html');
    },
    async useAnotherSignInMethod() {
        await firebase.auth().signOut();
        this.pendingUser = null;
        this.showStep('loginStep');
    },
    // Old installed-app OTP recovery must never reopen passenger phone signup.
    sendOtp() { this.showStep('loginStep'); },
    verifyOtp() { this.showStep('loginStep'); },
    resendOtp() { this.showStep('loginStep'); },
    prepareRecaptcha() {},
    showStep(id) {
        document.querySelectorAll('.login-step').forEach(step => step.classList.remove('active'));
        document.getElementById(id)?.classList.add('active');
    },
    toast(message) {
        const element = document.getElementById('loginToast');
        if (element) { element.textContent = message; element.classList.add('show'); }
    }
};
document.addEventListener('DOMContentLoaded', () => window.ASIYE_PASSENGER_LOGIN.init());

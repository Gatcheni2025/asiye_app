// One enrollment state machine shared by login, the driver dashboard and the
// registration page. Never infer "new registration" from a failed database read.
(() => {
    const db = () => firebase.database();
    const clean = user => user && typeof user.uid === 'string' && user.uid;

    async function resolveDriverProfile(user = firebase.auth().currentUser) {
        if (!clean(user)) return null;
        const direct = await db().ref(`taxis/${user.uid}`).once('value');
        if (direct.exists()) return { id: user.uid, data: direct.val() };
        for (const field of ['authUid', 'userUid']) {
            const snap = await db().ref('taxis').orderByChild(field)
                .equalTo(user.uid).limitToFirst(2).once('value');
            let result = null;
            snap.forEach(child => {
                if (!result) result = { id: child.key, data: child.val() };
            });
            if (result) return result;
        }
        return null;
    }

    function stateFromRecords({ enrollment, approval, driver }) {
        const reviewStatus = String(approval?.status || '').toLowerCase();
        const applicationStatus = String(enrollment?.status || '').toLowerCase();
        const verified = driver?.verificationStatus === 'verified' ||
            driver?.provisionalActivation === true;
        const disabled = driver?.verificationStatus === 'suspended';
        if (disabled) return { state: 'rejected', reason: 'Driver account is suspended. Contact Asiye Support.' };
        if (reviewStatus === 'rejected' || applicationStatus === 'rejected') {
            return { state: 'rejected', reason: approval?.reason || enrollment?.rejectionReason || 'Contact Asiye Support about your application.' };
        }
        // Admin function writes version 2 and the account profile together.
        // Existing drivers without a new enrollment also keep their verified account.
        if (verified && (reviewStatus === 'approved' || applicationStatus === 'approved' || !enrollment)) {
            return { state: 'approved' };
        }
        if (enrollment || reviewStatus === 'approved' || reviewStatus === 'pending') {
            return { state: 'pending' };
        }
        if (driver && (driver.verificationStatus === 'pending' ||
            driver.vehicleApprovalStatus === 'pending' || driver.enrollmentVersion)) {
            return { state: 'pending' };
        }
        return { state: 'new' };
    }

    async function getStatus(user = firebase.auth().currentUser) {
        if (!clean(user)) return { state: 'signed_out' };
        // Do not silently handle permission-denied as a fresh registration.
        const [enrollmentSnap, approvalSnap, linked] = await Promise.all([
            db().ref(`driverEnrollments/${user.uid}`).once('value'),
            db().ref(`driverApprovals/${user.uid}`).once('value'),
            resolveDriverProfile(user)
        ]);
        return {
            ...stateFromRecords({
                enrollment: enrollmentSnap.val(),
                approval: approvalSnap.val(),
                driver: linked?.data
            }),
            linked,
            enrollment: enrollmentSnap.val(),
            approval: approvalSnap.val()
        };
    }

    async function requireApproval() {
        const user = firebase.auth().currentUser;
        if (!clean(user) || !user.phoneNumber ||
            !user.providerData?.some(p => ['google.com', 'apple.com'].includes(p.providerId))) {
            window.location.replace('./login.html');
            return false;
        }
        try {
            const state = await getStatus(user);
            if (state.state === 'approved') return true;
        } catch (error) {
            console.warn('Driver verification check failed:', error.code || error.message);
            // Keep the account gated; the status page can show a retry message.
        }
        if (!window.location.pathname.endsWith('/enrollment.html')) {
            window.location.replace('./enrollment.html');
        }
        return false;
    }

    window.AsiyeEnrollment = { getStatus, stateFromRecords, resolveDriverProfile, requireApproval };
})();

// Banking is separate from enrollment approval: an approved driver must be
// able to set up banking and complete an existing trip while new jobs pause.
(() => {
    let accepted = null, attempt = 0;
    const app = () => window.ASIYE_DRIVER;
    window.AsiyeDriverBanking = {
        isReady() {
            const user = firebase.auth().currentUser;
            return !!user && accepted?.uid === user.uid &&
                accepted.driverId === app()?.state?.driverId && accepted.ready === true;
        },
        invalidate() {
            attempt++;
            accepted = null;
            app()?.requests?.stop?.();
            app()?.ui?.closeIncomingRequest?.();
        },
        open() { window.location.assign('./payout.html'); },
        async pause() {
            const current = app();
            this.invalidate();
            if (!current?.state?.driverId || current.state.availability?.currentRequest) return;
            await firebase.database().ref(`taxis/${current.state.driverId}`).update({isOnline:false,isBroadcasting:false});
            Object.assign(current.state.driver || {}, {isOnline:false,isBroadcasting:false});
            Object.assign(current.state.availability || {}, {isOnline:false,isBroadcasting:false});
            current.ui?.renderDashboard?.();
        },
        async require({redirect = true} = {}) {
            const current = app(), user = firebase.auth().currentUser;
            const driverId = current?.state?.driverId, epoch = ++attempt;
            accepted = null;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(),15000);
            try {
                if (!user || !driverId) throw Error('Sign in with your driver account to check banking.');
                const token = await user.getIdToken();
                const response = await fetch('https://us-central1-asiye-80386.cloudfunctions.net/configureDriverCardPayout?driverId=' + encodeURIComponent(driverId), {
                    headers:{Authorization:'Bearer ' + token}, cache:'no-store', signal:controller.signal
                });
                const info = await response.json();
                if (epoch !== attempt || firebase.auth().currentUser?.uid !== user.uid || app()?.state?.driverId !== driverId) return false;
                if (!response.ok || info.ok !== true) throw Error(info.error || 'Bank status could not be confirmed. Please retry.');
                accepted = {uid:user.uid,driverId,ready:info.bookingReady === true && info.status === 'verified'};
                if (accepted.ready) return true;
                await this.pause();
                current.ui?.toast?.('Verify your banking details to receive bookings.','warning');
                if (redirect && !current.state.availability?.currentRequest) this.open();
                return false;
            } catch (error) {
                if (epoch !== attempt || firebase.auth().currentUser?.uid !== user?.uid || app()?.state?.driverId !== driverId) return false;
                await this.pause().catch(() => {});
                current?.ui?.toast?.(error.name === 'AbortError'
                    ? 'Bank check timed out. Check your connection and try again.'
                    : error.message || 'Bank status could not be confirmed. Please retry.','warning');
                return false;
            } finally { clearTimeout(timeout); }
        }
    };
})();

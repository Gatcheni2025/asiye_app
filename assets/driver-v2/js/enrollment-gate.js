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
        if (!clean(user)) {
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

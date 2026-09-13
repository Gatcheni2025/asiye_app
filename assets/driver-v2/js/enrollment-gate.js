window.AsiyeEnrollment = {
    async requireApproval() {
        const user = firebase.auth().currentUser;
        if (!user) { window.location.replace('./login.html'); return false; }
        try {
            const approval = (await firebase.database().ref(`driverApprovals/${user.uid}`).once('value')).val();
            if (approval?.status === 'approved' && approval.version === 1) return true;
        } catch (error) { console.warn('Enrollment approval could not be checked', error.code); }
        window.location.replace('./enrollment.html');
        return false;
    }
};

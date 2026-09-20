window.AsiyeEnrollment = {
    _phoneVariants(rawPhone) {
        if (!rawPhone) return [];

        let digits = String(rawPhone).replace(/\D/g, '');

        if (digits.startsWith('27') && digits.length === 11) {
            digits = digits.substring(2);
        }

        if (digits.startsWith('0')) {
            digits = digits.substring(1);
        }

        if (digits.length !== 9) return [];

        return [
            `+27${digits}`,
            `27${digits}`,
            `0${digits}`,
            digits
        ];
    },

    _isLegacyVerified(driver) {
        if (!driver) return false;

        const verificationStatus = String(driver.verificationStatus || '').toLowerCase();
        const status = String(driver.status || '').toLowerCase();

        if (
            ['unverified', 'rejected', 'suspended', 'blocked', 'disabled']
                .includes(verificationStatus) ||
            ['rejected', 'suspended', 'blocked', 'disabled']
                .includes(status)
        ) {
            return false;
        }

        return (
            verificationStatus === 'verified' ||
            status === 'verified' ||
            status === 'active' ||
            driver.provisionalActivation === true
        );
    },

    async isApproved(user, driverData = null) {
        if (!user) return false;

        try {
            const approval = (
                await firebase
                    .database()
                    .ref(`driverApprovals/${user.uid}`)
                    .once('value')
            ).val();

            if (approval?.status === 'rejected') return false;

            if (
                approval?.status === 'approved' &&
                Number(approval.version) === 1
            ) {
                return true;
            }
        } catch (error) {
            console.warn(
                'Enrollment approval could not be checked:',
                error?.code || error
            );
        }

        // Compatibility for verified drivers created by the older admin flow.
        // A verified taxi profile is accepted only after Firebase Auth has
        // resolved the signed-in user to that exact profile.
        return this._isLegacyVerified(driverData);
    },

    async resolveDriverProfile(user = firebase.auth().currentUser) {
        if (!user?.uid) return null;

        const taxisRef = firebase.database().ref('taxis');
        const matches = new Map();

        const rememberDirect = snapshot => {
            if (!snapshot?.exists?.() || !snapshot.key) return;

            matches.set(snapshot.key, {
                id: snapshot.key,
                data: snapshot.val()
            });
        };

        const rememberChildren = snapshot => {
            if (!snapshot?.exists?.()) return;

            snapshot.forEach?.(child => {
                if (!matches.has(child.key)) {
                    matches.set(child.key, {
                        id: child.key,
                        data: child.val()
                    });
                }
            });
        };

        try {
            rememberDirect(
                await firebase
                    .database()
                    .ref(`taxis/${user.uid}`)
                    .once('value')
            );
        } catch (error) {
            console.warn('Direct driver profile lookup failed:', error?.code || error);
        }

        for (const field of ['authUid', 'userUid']) {
            try {
                rememberChildren(
                    await taxisRef
                        .orderByChild(field)
                        .equalTo(user.uid)
                        .once('value')
                );
            } catch (error) {
                console.warn(
                    `Driver ${field} lookup failed:`,
                    error?.code || error
                );
            }
        }

        const email = String(user.email || '').trim();
        if (email) {
            for (const value of [...new Set([email, email.toLowerCase()])]) {
                try {
                    rememberChildren(
                        await taxisRef
                            .orderByChild('email')
                            .equalTo(value)
                            .once('value')
                    );
                } catch (error) {
                    console.warn('Driver email lookup failed:', error?.code || error);
                }
            }
        }

        for (const phone of this._phoneVariants(user.phoneNumber)) {
            try {
                rememberChildren(
                    await taxisRef
                        .orderByChild('phone')
                        .equalTo(phone)
                        .once('value')
                );
            } catch (error) {
                console.warn('Driver phone lookup failed:', error?.code || error);
            }
        }

        const ranked = [...matches.values()].sort((left, right) => {
            const score = candidate => {
                const data = candidate.data || {};
                let value = 0;

                if (this._isLegacyVerified(data)) value += 100;
                if (candidate.id === user.uid) value += 30;
                if (data.authUid === user.uid || data.userUid === user.uid) value += 25;
                if (data.name || data.fullName) value += 5;
                if (
                    data.vehicleMake ||
                    data.vehicleModel ||
                    data.taxiRegistrationNumber
                ) {
                    value += 5;
                }

                return value;
            };

            return score(right) - score(left);
        });

        return ranked[0] || null;
    },

    async persistDriverSession(profile, user = firebase.auth().currentUser) {
        if (!profile?.id || !user?.uid) return false;

        const driver = profile.data || {};

        try {
            await firebase
                .database()
                .ref(`taxis/${profile.id}`)
                .update({
                    authUid: user.uid,
                    userUid: user.uid,
                    authPhone: user.phoneNumber || null,
                    authEmail: user.email || null,
                    hasLogin: true,
                    authLinkedAt: firebase.database.ServerValue.TIMESTAMP
                });
        } catch (error) {
            // Session can still continue if an older ruleset prevents the
            // compatibility fields from being written.
            console.warn(
                'Driver profile link could not be refreshed:',
                error?.code || error
            );
        }

        localStorage.setItem('driverId', profile.id);
        localStorage.setItem('userId', profile.id);
        localStorage.setItem('authUid', user.uid);
        localStorage.setItem('userType', 'driver');

        if (user.phoneNumber || driver.phone) {
            localStorage.setItem(
                'driverPhone',
                user.phoneNumber || driver.phone
            );
        }

        return true;
    },

    async activateApprovedDriver({
        redirect = true,
        user = firebase.auth().currentUser
    } = {}) {
        if (!user?.uid) return false;

        const profile = await this.resolveDriverProfile(user);
        if (!profile) return false;

        if (!await this.isApproved(user, profile.data)) {
            return false;
        }

        await this.persistDriverSession(profile, user);

        if (redirect) {
            window.location.replace('./index.html');
        }

        return true;
    },

    async requireApproval(driverData = null) {
        const user = firebase.auth().currentUser;

        if (!user) {
            window.location.replace('./login.html');
            return false;
        }

        let resolvedDriver = driverData;

        if (!resolvedDriver) {
            try {
                resolvedDriver = (await this.resolveDriverProfile(user))?.data || null;
            } catch (_) {}
        }

        if (await this.isApproved(user, resolvedDriver)) {
            return true;
        }

        window.location.replace('./enrollment.html');
        return false;
    }
};

/* Shared account pages. Opening a page does not replace the active trip UI. */
window.AsiyePages = {
    escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
    money(value) { return Number.isFinite(Number(value)) && value != null ? `R${Number(value).toFixed(2)}` : 'Not available'; },
    row(label, value) { return `<div class="member-row"><span>${this.escape(label)}</span><strong>${this.escape(value ?? 'Not provided')}</strong></div>`; },

    async saveDriverFace(blob, statusEl = null) {
        const driverId =
            window.ASIYE_DRIVER
                ?.state
                ?.driverId;

        if (!driverId) {
            throw new Error(
                'Driver account is not loaded.'
            );
        }

        if (
            !window.AsiyePhpImageUpload
        ) {
            throw new Error(
                'Profile image service is unavailable.'
            );
        }

        if (statusEl) {
            statusEl.textContent =
                'Saving face scan…';
        }

        const uploaded =
            await AsiyePhpImageUpload
                .upload(
                    blob,
                    {
                        userId:
                            driverId,
                        purpose:
                            'driver-profile',
                        filename:
                            'driver-profile.jpg'
                    }
                );

        const url =
            uploaded.url;

        const updates = {
            profile_picture_url:
                url,
            profileImageUrl:
                url,
            profilePhotoUpdatedAt:
                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        };

        await firebase
            .database()
            .ref(
                `taxis/${driverId}`
            )
            .update(
                updates
            );

        if (
            ASIYE_DRIVER.state.driver
        ) {
            Object.assign(
                ASIYE_DRIVER.state.driver,
                updates
            );
        }

        const authUser =
            firebase.auth()
                .currentUser;

        if (
            authUser &&
            typeof authUser
                .updateProfile ===
                'function'
        ) {
            try {
                await authUser
                    .updateProfile({
                        photoURL:
                            url
                    });
            } catch (error) {
                console.warn(
                    'Driver Auth profile photo update skipped:',
                    error
                );
            }
        }

        ASIYE_DRIVER.ui
            ?.updateDriverProfileUI?.();

        if (statusEl) {
            statusEl.textContent =
                'Face scan saved as your driver profile picture.';
        }

        return url;
    },

    bindDriverFaceScan(container) {
        const button =
            container.querySelector(
                '[data-driver-profile-face]'
            );

        const status =
            container.querySelector(
                '[data-driver-profile-status]'
            );

        if (!button) return;

        button.onclick =
            async () => {
                button.disabled =
                    true;

                button.textContent =
                    'Opening camera…';

                if (status) {
                    status.textContent =
                        'Opening the front camera. Take a clear face photo.';
                }

                try {
                    let blob = null;

                    /*
                     * Installed mobile app: use Flutter's native camera
                     * bridge. This opens Camera directly and does not offer
                     * a gallery/file picker for the profile photo.
                     */
                    if (
                        window.AsiyeNativeBridge &&
                        typeof AsiyeNativeBridge.scanImage ===
                            'function'
                    ) {
                        const result =
                            await AsiyeNativeBridge
                                .scanImage({
                                    purpose:
                                        'driver-profile',
                                    facing:
                                        'front'
                                });

                        if (!result) {
                            if (status) {
                                status.textContent =
                                    'Camera cancelled. No photo was changed.';
                            }

                            button.textContent =
                                'Scan face';

                            return;
                        }

                        if (!window.AsiyePhpImageUpload) {
                            throw new Error(
                                'Profile image service is unavailable.'
                            );
                        }

                        blob =
                            AsiyePhpImageUpload
                                .toBlob(
                                    result
                                );

                    } else if (
                        window.AsiyeFaceScanner
                    ) {
                        const result =
                            await AsiyeFaceScanner
                                .open({
                                    title:
                                        'Driver face scan',
                                    subtitle:
                                        'Centre your face inside the guide and capture a clear profile photo.'
                                });

                        blob =
                            result?.blob ||
                            null;
                    } else {
                        throw new Error(
                            'Camera service is unavailable in this build.'
                        );
                    }

                    if (!blob) {
                        return;
                    }

                    button.textContent =
                        'Saving photo…';

                    if (status) {
                        status.textContent =
                            'Photo captured. Saving profile picture…';
                    }

                    const url =
                        await this.saveDriverFace(
                            blob,
                            status
                        );

                    const avatar =
                        container.querySelector(
                            '.member-avatar'
                        );

                    if (avatar && url) {
                        avatar.classList.add(
                            'member-avatar-photo'
                        );

                        avatar.replaceChildren();

                        const image =
                            document.createElement(
                                'img'
                            );

                        image.src =
                            url;

                        image.alt =
                            'Driver profile picture';

                        avatar.appendChild(
                            image
                        );
                    }

                    button.textContent =
                        'Rescan face';

                } catch (error) {
                    console.error(
                        'Driver profile camera failed:',
                        error
                    );

                    if (status) {
                        status.textContent =
                            error?.message ||
                            'Could not take or save the profile photo.';
                    }

                    button.textContent =
                        'Scan face';
                } finally {
                    button.disabled =
                        false;
                }
            };
    },

    async open(page) {
        this.dialog?.close(); this.dialog?.remove();
        const driver = !!window.ASIYE_DRIVER;
        const app = driver ? ASIYE_DRIVER : ASIYE;
        const user = (driver ? app.state.driver : app.state.user) || {};
        const id = driver ? app.state.driverId : app.state.userId;
        const titles = { trips: driver ? 'Trip history' : 'My trips', wallet:'Wallet', parcels:'Parcels', safety:'Safety', support:'Support', account:'Account', earnings:'Earnings', club:'Work rides', vehicle:'Vehicle' };
        if (!titles[page]) return;
        const dialog = document.createElement('dialog');
        this.dialog = dialog;
        dialog.className = 'member-page';
        dialog.setAttribute('aria-label', titles[page]);
        dialog.innerHTML = `<header><div><small>ASIYE · ${driver ? 'DRIVER' : 'PASSENGER'}</small><h1>${titles[page]}</h1></div><button aria-label="Close page">×</button></header><main><p class="member-note">Loading…</p></main>`;
        document.body.append(dialog);
        dialog.querySelector('header button').onclick = () => { dialog.close(); dialog.remove(); };
        dialog.addEventListener('cancel', () => dialog.remove());
        dialog.showModal();
        const body = dialog.querySelector('main');
        const esc = value => this.escape(value);
        const note = text => `<p class="member-note">${esc(text)}</p>`;
        if (page === 'account') {
            const initial = esc((user.name || user.firstName || 'A').charAt(0));
            const photoUrl = !driver && window.ASIYE?.profile
                ? ASIYE.profile.getUrl(user)
                : (user.profile_picture_url || user.profileImageUrl || '');
            const avatar = photoUrl
                ? `<div class="member-avatar member-avatar-photo"><img data-passenger-profile-preview src="${esc(photoUrl)}" alt="Profile picture"></div>`
                : `<div class="member-avatar">${initial}</div>`;

            body.innerHTML =
                avatar +
                `<h2>${esc(user.name || user.firstName || 'Your account')}</h2>` +
                this.row('Phone', user.phone || user.phoneNumber) +
                this.row('Email', user.email) +
                this.row('Account type', driver ? 'Driver' : 'Passenger');

            body.innerHTML += `
                <div class="member-profile-photo-actions">
                    <button
                        type="button"
                        class="member-primary"
                        ${driver
                            ? 'data-driver-profile-face'
                            : 'data-passenger-profile-camera'}
                    >
                        ${photoUrl
                            ? 'Rescan face'
                            : 'Scan face'}
                    </button>

                    <p
                        class="member-note"
                        ${driver
                            ? 'data-driver-profile-status'
                            : 'data-passenger-profile-status'}
                    >
                        Asiye opens your front camera directly. Take a clear face photo and it becomes your profile picture after it is saved.
                    </p>
                </div>
            `;

            if (driver) {
                this.bindDriverFaceScan(
                    body
                );
            } else if (
                window.ASIYE?.profile &&
                typeof ASIYE.profile.bindAccount ===
                    'function'
            ) {
                ASIYE.profile.bindAccount(
                    body
                );
            }
        } else if (page === 'wallet') {
            const returnStatus = new URLSearchParams(location.search).get('wallet');
            body.innerHTML =
                `<div class="member-balance"><small>Available wallet balance</small><strong>${this.money(user.credits ?? user.walletBalance)}</strong></div>` +
                (returnStatus === 'success'
                    ? note('Payment returned successfully. Your balance will update after PayFast confirms it.')
                    : returnStatus === 'cancelled'
                        ? note('The payment was cancelled and no funds were added.')
                        : note('Add funds securely using PayFast Sandbox.')) +
                `<form class="wallet-topup" data-wallet-topup>
                    <label>Amount to add</label>
                    <div class="wallet-amounts">
                        <button type="button" data-amount="50">R50</button>
                        <button type="button" data-amount="100">R100</button>
                        <button type="button" data-amount="200">R200</button>
                        <button type="button" data-amount="500">R500</button>
                    </div>
                    <div class="wallet-custom">
                        <span>R</span>
                        <input name="amount" type="number" inputmode="decimal" min="10" max="5000" step="0.01" placeholder="Enter amount" required>
                    </div>
                    <button class="member-primary" type="submit">Add funds with PayFast</button>
                    <p class="member-note">Sandbox payments use test money. Funds are credited only after secure PayFast confirmation.</p>
                </form>` +
                this.row('Currency', 'South African rand · ZAR');
            const form = body.querySelector('[data-wallet-topup]');
            const input = form.querySelector('input[name="amount"]');
            form.querySelectorAll('[data-amount]').forEach(button => {
                button.onclick = () => {
                    input.value = button.dataset.amount;
                    form.querySelectorAll('[data-amount]').forEach(item => item.classList.remove('selected'));
                    button.classList.add('selected');
                };
            });
            form.onsubmit = async event => {
                event.preventDefault();
                const submit = form.querySelector('[type="submit"]');
                submit.disabled = true;
                submit.textContent = 'Opening PayFast…';
                try {
                    await ASIYE.wallet.startTopup(Number(input.value));
                } catch (error) {
                    submit.disabled = false;
                    submit.textContent = 'Add funds with PayFast';
                    app.ui?.toast?.(error.message || 'Unable to start payment.');
                }
            };
        } else if (page === 'vehicle') {
            if (!driver || !id) {
                body.innerHTML =
                    note(
                        'Vehicle details are available on driver accounts.'
                    );
                return;
            }

            const approvedVehicle =
                user.vehicle || {};

            const pendingVehicle =
                user.vehiclePending || {};

            const pick =
                (pendingValue, approvedValue, legacyValue) =>
                    pendingValue ||
                    approvedValue ||
                    legacyValue ||
                    '';

            const current = {
                type:
                    pick(
                        pendingVehicle.type,
                        approvedVehicle.type,
                        user.vehicleType ||
                        user.carCategory
                    ),
                make:
                    pick(
                        pendingVehicle.make,
                        approvedVehicle.make,
                        user.vehicleMake ||
                        user.make
                    ),
                model:
                    pick(
                        pendingVehicle.model,
                        approvedVehicle.model,
                        user.vehicleModel ||
                        user.model
                    ),
                colour:
                    pick(
                        pendingVehicle.colour ||
                        pendingVehicle.color,
                        approvedVehicle.colour ||
                        approvedVehicle.color,
                        user.vehicleColor ||
                        user.color
                    ),
                seats:
                    pick(
                        pendingVehicle.seats,
                        approvedVehicle.seats,
                        user.vehicleSeats ||
                        user.seats ||
                        user.capacity
                    ),
                registration:
                    pick(
                        pendingVehicle.registration,
                        approvedVehicle.registration,
                        user.vehicleReg ||
                        user.registration ||
                        user.taxiRegistrationNumber
                    )
            };

            const approvalStatus =
                String(
                    user.vehicleApprovalStatus ||
                    (
                        user.vehicleApproved === true
                            ? 'approved'
                            : 'not submitted'
                    )
                ).toLowerCase();

            const hasPending =
                approvalStatus ===
                    'pending' ||
                Boolean(
                    user.vehiclePending
                );

            body.innerHTML = `
                <div class="member-balance">
                    <small>Vehicle approval</small>
                    <strong>${
                        approvalStatus === 'approved'
                            ? 'Approved'
                            : hasPending
                                ? 'Pending review'
                                : 'Action required'
                    }</strong>
                </div>

                <p class="member-note">
                    Add or edit the vehicle you drive on Asiye. Any change
                    must be reviewed by an administrator before you can go
                    online again.
                </p>

                <form
                    class="member-vehicle-form"
                    data-driver-vehicle-form
                >
                    <label>
                        Vehicle type
                        <input
                            name="type"
                            maxlength="40"
                            value="${esc(current.type)}"
                            placeholder="e.g. Sedan, SUV, 7-seater"
                            required
                        >
                    </label>

                    <label>
                        Make
                        <input
                            name="make"
                            maxlength="40"
                            value="${esc(current.make)}"
                            placeholder="e.g. Toyota"
                            required
                        >
                    </label>

                    <label>
                        Model
                        <input
                            name="model"
                            maxlength="50"
                            value="${esc(current.model)}"
                            placeholder="e.g. Corolla"
                            required
                        >
                    </label>

                    <label>
                        Colour
                        <input
                            name="colour"
                            maxlength="30"
                            value="${esc(current.colour)}"
                            placeholder="e.g. White"
                            required
                        >
                    </label>

                    <label>
                        Passenger seats
                        <input
                            name="seats"
                            type="number"
                            inputmode="numeric"
                            min="1"
                            max="15"
                            step="1"
                            value="${esc(current.seats)}"
                            required
                        >
                    </label>

                    <label>
                        Registration
                        <input
                            name="registration"
                            maxlength="20"
                            value="${esc(current.registration)}"
                            placeholder="Vehicle registration"
                            required
                        >
                    </label>

                    <button
                        class="member-primary"
                        type="submit"
                    >
                        Submit vehicle for approval
                    </button>

                    <p
                        class="member-note"
                        data-vehicle-status
                    >
                        ${
                            approvalStatus === 'approved'
                                ? 'This vehicle is approved. Editing and submitting it will start a new admin review.'
                                : hasPending
                                    ? 'Your latest vehicle details are waiting for admin approval.'
                                    : 'Complete all vehicle details and submit them for admin approval.'
                        }
                    </p>
                </form>
            `;

            const form =
                body.querySelector(
                    '[data-driver-vehicle-form]'
                );

            const vehicleStatus =
                body.querySelector(
                    '[data-vehicle-status]'
                );

            form.onsubmit =
                async event => {
                    event.preventDefault();

                    const data =
                        new FormData(
                            form
                        );

                    const vehiclePending = {
                        type:
                            String(
                                data.get(
                                    'type'
                                ) ||
                                ''
                            ).trim(),
                        make:
                            String(
                                data.get(
                                    'make'
                                ) ||
                                ''
                            ).trim(),
                        model:
                            String(
                                data.get(
                                    'model'
                                ) ||
                                ''
                            ).trim(),
                        colour:
                            String(
                                data.get(
                                    'colour'
                                ) ||
                                ''
                            ).trim(),
                        registration:
                            String(
                                data.get(
                                    'registration'
                                ) ||
                                ''
                            ).trim(),
                        seats:
                            Number(
                                data.get(
                                    'seats'
                                )
                            )
                    };

                    if (
                        [
                            vehiclePending.type,
                            vehiclePending.make,
                            vehiclePending.model,
                            vehiclePending.colour,
                            vehiclePending.registration
                        ].some(
                            value =>
                                value.length <
                                2
                        )
                    ) {
                        vehicleStatus.textContent =
                            'Complete type, make, model, colour and registration before submitting.';
                        return;
                    }

                    if (
                        !Number.isInteger(
                            vehiclePending.seats
                        ) ||
                        vehiclePending.seats <
                            1 ||
                        vehiclePending.seats >
                            15
                    ) {
                        vehicleStatus.textContent =
                            'Passenger seats must be a whole number between 1 and 15.';
                        return;
                    }

                    const submit =
                        form.querySelector(
                            '[type="submit"]'
                        );

                    submit.disabled =
                        true;

                    submit.textContent =
                        'Submitting…';

                    try {
                        vehiclePending.submittedAt =
                            firebase
                                .database
                                .ServerValue
                                .TIMESTAMP;

                        await firebase
                            .database()
                            .ref(
                                `taxis/${id}`
                            )
                            .update({
                                vehiclePending,
                                vehicleApproved:
                                    false,
                                vehicleApprovalStatus:
                                    'pending',
                                vehicleSubmittedAt:
                                    firebase
                                        .database
                                        .ServerValue
                                        .TIMESTAMP,
                                isOnline:
                                    false,
                                isBroadcasting:
                                    false
                            });

                        Object.assign(
                            user,
                            {
                                vehiclePending,
                                vehicleApproved:
                                    false,
                                vehicleApprovalStatus:
                                    'pending',
                                isOnline:
                                    false,
                                isBroadcasting:
                                    false
                            }
                        );

                        vehicleStatus.textContent =
                            'Vehicle submitted. An administrator must approve it before you can go online.';

                        submit.textContent =
                            'Update pending vehicle';

                        app.ui?.toast?.(
                            'Vehicle submitted for admin approval.',
                            'success'
                        );

                    } catch (error) {
                        console.error(
                            'Vehicle submission failed:',
                            error
                        );

                        vehicleStatus.textContent =
                            error?.message ||
                            'Could not submit vehicle details. Try again.';

                        submit.textContent =
                            'Submit vehicle for approval';
                    } finally {
                        submit.disabled =
                            false;
                    }
                };
        } else if (page === 'safety') {
            if (!id) {
                body.innerHTML = note('Sign in to manage loved ones.');
                return;
            }

            const context = {
                app,
                id,
                role: driver ? 'driver' : 'passenger',
                root: driver ? 'taxis' : 'commuters'
            };

            const members = window.AsiyeSafetyContact
                ? await AsiyeSafetyContact.getMembers(context)
                : [];

            body.innerHTML = `
                <h2>Trusted family & live location</h2>

                <p class="member-note">
                    Your primary safety contact is saved once and stays
                    connected to your Asiye account. You can add more trusted
                    people here at any time.
                </p>

                <div data-family-list>
                    ${
                        members.length
                            ? members.map((member, index) => `
                                <div class="member-row member-family-row">
                                    <span>
                                        ${esc(member.relationship || 'Loved one')}
                                        ${
                                            member.isPrimary === true || index === 0
                                                ? '<em class="member-safety-badge">Primary safety contact</em>'
                                                : ''
                                        }
                                    </span>
                                    <strong>
                                        ${esc(member.name)}
                                        <small>${esc(member.phone)}</small>
                                    </strong>
                                </div>
                            `).join('')
                            : note('No trusted family member has been added yet.')
                    }
                </div>

                <form data-family-form class="member-family-form">
                    <h3>Add another trusted person</h3>

                    <button
                        type="button"
                        class="asiye-safety-secondary asiye-contact-picker"
                        data-family-pick-contact
                    >
                        <i class="fas fa-address-book"></i>
                        Choose from phone contacts
                    </button>

                    <label>
                        Full name
                        <input name="name" required maxlength="80">
                    </label>

                    <label>
                        Relationship
                        <select name="relationship" required>
                            <option value="">Choose relationship</option>
                            <option>Spouse / Partner</option>
                            <option>Parent</option>
                            <option>Sibling</option>
                            <option>Child</option>
                            <option>Relative</option>
                            <option>Friend</option>
                            <option>Other</option>
                        </select>
                    </label>

                    <label>
                        Mobile number
                        <input
                            name="phone"
                            type="tel"
                            inputmode="tel"
                            required
                            maxlength="24"
                        >
                    </label>

                    <p class="member-note">
                        Only add someone who has agreed to be your safety contact.
                    </p>

                    <button class="member-primary" type="submit">
                        Save trusted person
                    </button>
                </form>

                <button class="member-primary" data-share-live>
                    Share active trip location
                </button>

                <button class="member-primary" data-support>
                    Contact support
                </button>
            `;

            const familyForm =
                body.querySelector('[data-family-form]');

            body.querySelector(
                '[data-family-pick-contact]'
            ).onclick = async event => {
                const button = event.currentTarget;
                const original = button.innerHTML;
                button.disabled = true;
                button.innerHTML =
                    '<i class="fas fa-circle-notch fa-spin"></i> Opening contacts…';

                try {
                    await AsiyeSafetyContact.pickIntoForm(
                        familyForm
                    );
                } catch (error) {
                    app.ui?.toast?.(
                        error?.message ||
                        'Unable to open phone contacts.'
                    );
                } finally {
                    button.disabled = false;
                    button.innerHTML = original;
                }
            };

            body.querySelector('[data-family-form]').onsubmit = async event => {
                event.preventDefault();

                const form = event.currentTarget;
                const button = form.querySelector('[type="submit"]');

                button.disabled = true;
                button.textContent = 'Saving…';

                try {
                    if (!window.AsiyeSafetyContact) {
                        throw new Error('Safety setup is unavailable.');
                    }

                    await AsiyeSafetyContact.saveMember({
                        context,
                        name: form.elements.name.value,
                        relationship: form.elements.relationship.value,
                        phone: form.elements.phone.value
                    });

                    this.open('safety');
                } catch (error) {
                    button.disabled = false;
                    button.textContent = 'Save trusted person';

                    app.ui?.toast?.(
                        error?.message ||
                        'Unable to save this person.'
                    );
                }
            };

            body.querySelector('[data-share-live]').onclick = async () => {
                const requestId =
                    app.state?.activeRequest?.requestId ||
                    app.state?.activeRequest?.key ||
                    app.state?.booking?.requestId ||
                    app.state?.trip?.requestId ||
                    localStorage.getItem('currentRequestId');

                if (!requestId) {
                    return app.ui?.toast?.(
                        'There is no active trip to share.'
                    );
                }

                if (window.AsiyeSafetyContact) {
                    await AsiyeSafetyContact.offerTripShare(
                        requestId,
                        {
                            role: driver ? 'driver' : 'passenger'
                        }
                    );
                }
            };

            body.querySelector('[data-support]').onclick =
                () => this.open('support');
        } else if (page === 'support') {
            const config = driver ? window.ASIYE_DRIVER_CONFIG : window.ASIYE_CONFIG;
            body.innerHTML = `<h2>How can we help?</h2><details class="member-info"><summary>My driver or passenger cannot find me</summary><p>Use Message on your trip to share a nearby landmark and agree on a safe meeting point.</p></details><details class="member-info"><summary>My payment or fare looks incorrect</summary><p>Keep your trip reference and the amount shown on the completed-trip receipt.</p></details><details class="member-info"><summary>Map or location is unavailable</summary><p>Allow location access in your browser or device settings, check your connection, then recenter the map.</p></details>`;
            const email = config?.supportEmail;
            if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.innerHTML += `<a class="member-primary" href="mailto:${encodeURIComponent(email)}">Email support</a>`;
            else body.innerHTML += note('Direct support contact has not been configured for this app yet.');
        } else {
            try {
                if (!id) throw new Error('Sign in to view your records.');
                const root = page === 'parcels' ? 'delivery_requests' : 'requests';
                const field = driver ? 'taxiId' : 'commuterId';
                const queries = [firebase.database().ref(root).orderByChild(field).equalTo(id).limitToLast(100).once('value')];
                if (!driver && root === 'requests') queries.push(firebase.database().ref(root).orderByChild(`passengers/${id}/status`).startAt('').limitToLast(100).once('value'));
                const results = await Promise.all(queries);
                if (this.dialog !== dialog) return;
                const records = new Map();
                results.forEach(snapshot => snapshot.forEach(child => records.set(child.key, { ...child.val(), key: child.key })));
                let rides = [...records.values()].sort((a,b) => Number(b.timestamp || b.createdAt || 0) - Number(a.timestamp || a.createdAt || 0));
                if (page === 'club') rides = rides.filter(ride => ride.type === 'club');
                let html = '';
                if (page === 'earnings') {
                    rides =
                        rides.filter(
                            ride =>
                                ride.status ===
                                'completed'
                        );

                    const grossFare =
                        ride => {
                            if (
                                driver &&
                                window.ASIYE_DRIVER
                                    ?.metrics
                                    ?.grossFare
                            ) {
                                return ASIYE_DRIVER
                                    .metrics
                                    .grossFare(
                                        ride
                                    );
                            }

                            if (
                                ride.type ===
                                'club'
                            ) {
                                const total =
                                    Number(
                                        ride.totalPoolFare ||
                                        0
                                    );

                                if (
                                    Number.isFinite(
                                        total
                                    ) &&
                                    total > 0
                                ) {
                                    return total;
                                }

                                const active =
                                    Object.values(
                                        ride.passengers ||
                                        {}
                                    ).filter(
                                        passenger =>
                                            !String(
                                                passenger?.status ||
                                                ''
                                            ).includes(
                                                'cancelled'
                                            )
                                    ).length;

                                return Number(
                                    ride.pricePerPassenger ||
                                    0
                                ) * active;
                            }

                            return Number(
                                ride.finalAmount ??
                                ride.agreedFare ??
                                ride.calculatedPrice ??
                                ride.price ??
                                0
                            ) || 0;
                        };

                    const sum =
                        rides.reduce(
                            (
                                total,
                                ride
                            ) =>
                                total +
                                grossFare(
                                    ride
                                ),
                            0
                        );

                    html +=
                        `<div class="member-balance"><small>Completed fares</small><strong>${this.money(sum)}</strong></div>` +
                        note(
                            'Gross completed Asiye Go, Work and Delivery fares shown before platform fees or other deductions.'
                        );
                }
                html += note('Showing up to 100 recent records per booking type.');
                if (!rides.length) html += `<div class="member-empty"><h2>No ${page === 'parcels' ? 'parcels' : 'trips'} yet</h2><p>Your records will appear here once available.</p></div>`;
                rides.forEach(ride => {
                    const passenger = ride.passengers?.[id] || {};
                    const amount = driver ? (ride.finalAmount ?? ride.calculatedPrice ?? ride.price) : (passenger.finalAmount ?? passenger.price ?? ride.finalAmount ?? ride.calculatedPrice ?? ride.pricePerPassenger ?? ride.price);
                    const stamp = Number(ride.timestamp || ride.createdAt);
                    html += `<details class="member-trip"><summary><span><small>${esc(String(ride.status || 'Booked').replace(/_/g,' '))}</small><strong>${esc(ride.destination || ride.destinationName || ride.dropoffAddress || 'Trip')}</strong></span><b>${this.money(amount)}</b></summary><div>${this.row('Date', stamp && Number.isFinite(stamp) ? new Date(stamp).toLocaleString() : 'Not recorded')}${this.row('Reference',ride.key)}${this.row('Service',ride.type || 'Ride')}${this.row('Payment',passenger.paymentMethod || ride.paymentMethod)}</div></details>`;
                });
                body.innerHTML = html;
            } catch (error) {
                body.innerHTML = note('Records could not load. Check your connection and account access.') + '<button class="member-primary">Retry</button>';
                body.querySelector('button').onclick = () => this.open(page);
            }
        }
    }
};

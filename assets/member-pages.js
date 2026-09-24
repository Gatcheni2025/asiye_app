/* ASIYE_PROFILE_MEDIA_BRIDGE_V1
   Shared camera, image compression/upload and required-share helpers. */
(() => {
    let pendingFaceCapture = null;
    let pendingTripShare = null;

    const nativeChannel = () => window.Asiye || window.Android || null;

    const dataUrlToBlob = dataUrl => {
        const [head, body] = String(dataUrl || '').split(',');
        if (!head || !body) throw new Error('Camera image is unavailable.');
        const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
        const bytes = atob(body);
        const buffer = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
        return new Blob([buffer], { type: mime });
    };

    const compressImage = async blob => {
        const bitmap = await createImageBitmap(blob);
        const maxSide = 1000;
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        return await new Promise((resolve, reject) => {
            canvas.toBlob(
                result => result ? resolve(result) : reject(new Error('Could not prepare profile photo.')),
                'image/jpeg',
                0.78
            );
        });
    };

    window.AsiyePhpImageUpload = window.AsiyePhpImageUpload || {
        toBlob(value) {
            if (value instanceof Blob) return value;
            if (value?.dataUrl) return dataUrlToBlob(value.dataUrl);
            if (typeof value === 'string' && value.startsWith('data:')) return dataUrlToBlob(value);
            throw new Error('Unsupported profile image.');
        },

        async upload(value, options = {}) {
            const source = this.toBlob(value);
            const compressed = await compressImage(source);
            const form = new FormData();
            form.append('file', compressed, options.filename || 'profile.jpg');
            form.append('api_key', 'asiye_secure_upload_2025');
            form.append('userId', String(options.userId || 'asiye-user'));
            if (options.purpose) form.append('purpose', String(options.purpose));

            const response = await fetch('https://app.asiye.cloud/upload_handler.php', {
                method: 'POST',
                body: form
            });

            const payload = await response.json().catch(() => ({}));
            const url = payload.url || payload.fileUrl || payload.file_url || '';
            if (!response.ok || !url || /error/i.test(String(url))) {
                throw new Error(payload.message || payload.error || 'Profile image upload failed.');
            }
            return { ...payload, url };
        }
    };

    window.AsiyeFaceCapture = window.AsiyeFaceCapture || {
        async capture(purpose = 'profile') {
            if (pendingFaceCapture) throw new Error('Camera is already open.');
            const channel = nativeChannel();
            if (!channel || typeof channel.postMessage !== 'function') {
                throw new Error('Live camera is available in the installed Asiye app.');
            }

            return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    pendingFaceCapture = null;
                    reject(new Error('Camera timed out. Please try again.'));
                }, 120000);

                pendingFaceCapture = {
                    resolve: value => { clearTimeout(timeout); pendingFaceCapture = null; resolve(value); },
                    reject: error => { clearTimeout(timeout); pendingFaceCapture = null; reject(error); }
                };

                channel.postMessage(JSON.stringify({
                    action: 'captureFacePhoto',
                    purpose
                }));
            });
        }
    };

    window.onNativeFaceCaptureSuccess = payload => {
        pendingFaceCapture?.resolve(payload);
    };

    window.onNativeFaceCaptureError = message => {
        const text = String(message || 'Camera failed.');
        pendingFaceCapture?.reject(
            new Error(text.toLowerCase() === 'cancelled' ? 'Face scan cancelled.' : text)
        );
    };

    window.AsiyeTripShare = window.AsiyeTripShare || {
        async require(text) {
            const channel = nativeChannel();

            if (channel && typeof channel.postMessage === 'function') {
                if (pendingTripShare) throw new Error('Share sheet is already open.');
                return await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        pendingTripShare = null;
                        reject(new Error('Share was not completed. Please share the trip to continue.'));
                    }, 120000);

                    pendingTripShare = {
                        resolve: value => { clearTimeout(timeout); pendingTripShare = null; resolve(value); },
                        reject: error => { clearTimeout(timeout); pendingTripShare = null; reject(error); }
                    };

                    channel.postMessage(JSON.stringify({
                        action: 'shareTrip',
                        text
                    }));
                });
            }

            if (navigator.share) {
                await navigator.share({ title: 'My Asiye trip', text });
                return true;
            }

            throw new Error('Trip sharing is required. Please use the installed Asiye app.');
        }
    };

    window.onNativeTripShareResult = result => {
        if (!pendingTripShare) return;
        if (result?.shared) pendingTripShare.resolve(true);
        else pendingTripShare.reject(new Error('Share your trip with a loved one to continue.'));
    };
})();

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
                        'Opening live face scan. Centre your face and follow the movement prompts.';
                }

                try {
                    let blob = null;

                    /*
                     * Installed mobile app: use Flutter's native camera
                     * bridge. This opens Camera directly and does not offer
                     * a gallery/file picker for the profile photo.
                     */
                    if (
                        window.AsiyeFaceCapture &&
                        typeof AsiyeFaceCapture.capture ===
                            'function'
                    ) {
                        const result =
                            await AsiyeFaceCapture
                                .capture(
                                    'driver-profile'
                                );

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
                                        'Centre your face inside the guide. Move naturally and smile when prompted.'
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

    async startEftTopup(amount, phone, passengerId, user) {
        const authUser = firebase.auth().currentUser;
        if (!authUser) throw new Error('Please sign in again before adding funds.');

        const cleanPhone = String(phone || user?.phone || user?.phoneNumber || '').trim();
        if (!cleanPhone) throw new Error('Enter the mobile number that should receive your EFT banking details.');

        // Google/Apple users may not have a Firebase Auth phone number. Store the
        // supplied wallet/SMS number on their commuter profile before requesting
        // the protected Twilio instruction endpoint.
        if (passengerId) {
            await firebase.database().ref(`commuters/${passengerId}`).update({
                phone: cleanPhone,
                phoneNumber: cleanPhone,
                walletSmsPhoneUpdatedAt: firebase.database.ServerValue.TIMESTAMP
            });
            if (user) {
                user.phone = cleanPhone;
                user.phoneNumber = cleanPhone;
            }
        }

        const token = await authUser.getIdToken(true);
        const endpoint = 'https://us-central1-asiye-80386.cloudfunctions.net/createEftSmsTopup';
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ amount: Number(amount) })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Unable to prepare the EFT top-up.');
        return payload;
    },

    async open(page) {
        this.dialog?.close(); this.dialog?.remove();
        const driver = !!window.ASIYE_DRIVER;
        const app = driver ? ASIYE_DRIVER : ASIYE;
        const user = (driver ? app.state.driver : app.state.user) || {};
        const id = driver ? app.state.driverId : app.state.userId;
        const titles = { trips: driver ? 'Trip history' : 'My trips', wallet:'Wallet', parcels: driver ? 'Parcel deliveries' : 'Parcels', safety:'Safety', support:'Support', account:'Account', earnings:'Earnings', club:'Work rides', vehicle:'Vehicle' };
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
                        Asiye opens a live front-camera scan. Centre your face, move when prompted and smile; the verified final frame becomes your profile picture.
                    </p>
                </div>
            `;

            body.innerHTML += `
                <div class="member-info">
                    <h3 style="margin-top:0;">Privacy & data</h3>

                    <p>
                        Review how Asiye handles your personal information or
                        request deletion of your account and associated data.
                    </p>

                    <a
                        class="member-primary"
                        href="https://asiye.cloud/privacy-policy/"
                    >
                        Privacy Policy
                    </a>

                    <a
                        class="member-primary member-data-delete"
                        href="https://asiye.cloud/delete/"
                    >
                        Delete my account
                    </a>
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
            body.innerHTML =
                `<div class="member-balance"><small>Available wallet balance</small><strong>${this.money(user.credits ?? user.walletBalance)}</strong></div>` +
                note(
                    'Choose an amount to add. Your FNB EFT details will appear here and Asiye will also send them by SMS. After payment, you will receive an SMS update when the EFT is confirmed and your wallet is credited.'
                ) +
                `
                <form class="wallet-topup" data-wallet-topup>
                    <label>Mobile number for EFT SMS</label>
                    <div class="wallet-phone">
                        <span>+27</span>
                        <input
                            name="phone"
                            type="tel"
                            inputmode="tel"
                            autocomplete="tel"
                            value="${esc(user.phone || user.phoneNumber || '')}"
                            placeholder="e.g. 082 123 4567"
                            required
                        >
                    </div>
                    <p class="member-note">If you signed in with Google or Apple, add your mobile number here. Asiye will save it to your account and send the FNB banking details to this number via SMS.</p>

                    <label>Amount to add</label>

                    <div class="wallet-amounts">
                        <button type="button" data-amount="50">R50</button>
                        <button type="button" data-amount="100">R100</button>
                        <button type="button" data-amount="200">R200</button>
                        <button type="button" data-amount="500">R500</button>
                    </div>

                    <div class="wallet-custom">
                        <span>R</span>
                        <input
                            name="amount"
                            type="number"
                            inputmode="decimal"
                            min="10"
                            max="5000"
                            step="0.01"
                            placeholder="Enter amount"
                            required
                        >
                    </div>

                    <button class="member-primary" type="submit">
                        Add funds with EFT
                    </button>

                    <div class="member-info" data-eft-result hidden></div>

                    <p class="member-note">
                        Use the payment reference exactly. Asiye will notify you by SMS when your EFT is matched and the wallet credit is complete.
                    </p>
                </form>` +
                this.row(
                    'Currency',
                    'South African rand · ZAR'
                );

            const form =
                body.querySelector(
                    '[data-wallet-topup]'
                );

            const input =
                form.querySelector(
                    'input[name="amount"]'
                );

            const resultBox =
                form.querySelector(
                    '[data-eft-result]'
                );

            (form.querySelectorAll?.(
                '[data-amount]'
            ) || [])
                .forEach(
                    button => {
                        button.onclick =
                            () => {
                                input.value =
                                    button.dataset.amount;

                                (form.querySelectorAll?.(
                                    '[data-amount]'
                                ) || [])
                                    .forEach(
                                        item =>
                                            item.classList
                                                .remove(
                                                    'selected'
                                                )
                                    );

                                button.classList
                                    .add(
                                        'selected'
                                    );
                            };
                    }
                );

            form.onsubmit =
                async event => {
                    event.preventDefault();

                    const submit =
                        form.querySelector(
                            '[type="submit"]'
                        );

                    submit.disabled =
                        true;

                    submit.textContent =
                        'Sending banking details…';

                    if (resultBox) {
                        resultBox.hidden =
                            false;

                        resultBox.innerHTML =
                            `
                            <strong>Preparing your EFT payment</strong>
                            <p class="member-note">
                                We are generating your banking details and requesting the SMS now…
                            </p>
                            `;
                    }

                    try {
                        const phoneInput = form.querySelector('input[name="phone"]');
                        const payment =
                            await this.startEftTopup(
                                Number(input.value),
                                phoneInput?.value || '',
                                id,
                                user
                            );

                        if (resultBox) {
                            const smsQueued =
                                payment.smsStatus ===
                                    'sent';

                            resultBox.hidden =
                                false;

                            resultBox.innerHTML =
                                `
                                <strong>
                                    ${smsQueued
                                        ? 'EFT details ready · SMS requested'
                                        : 'EFT details ready'}
                                </strong>

                                <p>
                                    <b>Bank:</b> ${esc(payment.bank || 'FNB')}<br>
                                    <b>Account:</b> ${esc(payment.accountNumber || '')}<br>
                                    <b>Amount:</b> ${esc(this.money(payment.amount))}<br>
                                    <b>Reference:</b> ${esc(payment.reference || '')}
                                </p>

                                <p class="member-note">
                                    ${smsQueued
                                        ? `Banking details have been accepted for SMS delivery to ${esc(payment.smsTo || 'your registered mobile number')}.`
                                        : 'The instruction SMS could not be sent right now. You can still use the banking details shown above.'}
                                </p>

                                <p class="member-note">
                                    After making the EFT, keep this reference exactly as shown. Asiye will send you an SMS update when the payment is confirmed and your wallet has been credited.
                                </p>
                                `;
                        }

                        app.ui?.toast?.(
                            payment.smsStatus === 'sent'
                                ? 'EFT details ready. SMS delivery requested.'
                                : 'EFT details ready. Use the details shown on screen.'
                        );

                    } catch (error) {
                        if (resultBox) {
                            resultBox.hidden =
                                false;

                            resultBox.innerHTML =
                                `
                                <strong>Unable to prepare EFT payment</strong>
                                <p class="member-note">
                                    ${esc(
                                        error.message ||
                                        'Please try again.'
                                    )}
                                </p>
                                `;
                        }

                        app.ui?.toast?.(
                            error.message ||
                            'Unable to prepare the EFT banking details.'
                        );

                    } finally {
                        submit.disabled =
                            false;

                        submit.textContent =
                            'Add funds with EFT';
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
                year:
                    pick(
                        pendingVehicle.year,
                        approvedVehicle.year,
                        user.vehicleYear ||
                        user.year
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
                        Vehicle year
                        <input
                            name="year"
                            type="number"
                            inputmode="numeric"
                            min="1990"
                            max="2027"
                            step="1"
                            value="${esc(current.year)}"
                            placeholder="e.g. 2023"
                            required
                        >
                    </label>

                    <div class="member-info">
                        <strong>Vehicle photo</strong>
                        <p class="member-note">
                            Capture the actual car showing its colour and registration plate.
                        </p>
                        ${user.vehiclePhoto
                            ? `<img data-driver-car-preview src="${esc(user.vehiclePhoto)}" alt="Driver vehicle" style="display:block;width:100%;max-height:190px;object-fit:cover;border-radius:14px;margin:10px 0;">`
                            : `<img data-driver-car-preview alt="Driver vehicle" hidden style="display:block;width:100%;max-height:190px;object-fit:cover;border-radius:14px;margin:10px 0;">`}
                        <button
                            type="button"
                            class="member-primary"
                            data-driver-car-camera
                        >
                            ${user.vehiclePhoto ? 'Retake car photo' : 'Take car photo'}
                        </button>
                        <p class="member-note" data-driver-car-status>
                            A car photo is required before you can go online.
                        </p>
                    </div>

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

            const carButton =
                body.querySelector(
                    '[data-driver-car-camera]'
                );

            const carStatus =
                body.querySelector(
                    '[data-driver-car-status]'
                );

            const carPreview =
                body.querySelector(
                    '[data-driver-car-preview]'
                );

            if (carButton) {
                carButton.onclick =
                    async () => {
                        carButton.disabled =
                            true;
                        carButton.textContent =
                            'Opening camera…';

                        try {
                            const capture =
                                await AsiyeFaceCapture
                                    .capture(
                                        'driver-vehicle'
                                    );

                            if (carStatus) {
                                carStatus.textContent =
                                    'Uploading vehicle photo…';
                            }

                            const uploaded =
                                await AsiyePhpImageUpload
                                    .upload(
                                        capture,
                                        {
                                            userId:
                                                id,
                                            purpose:
                                                'driver-vehicle',
                                            filename:
                                                'driver-vehicle.jpg'
                                        }
                                    );

                            await firebase
                                .database()
                                .ref(
                                    `taxis/${id}`
                                )
                                .update({
                                    vehiclePhoto:
                                        uploaded.url,
                                    vehiclePhotoUpdatedAt:
                                        firebase
                                            .database
                                            .ServerValue
                                            .TIMESTAMP
                                });

                            user.vehiclePhoto =
                                uploaded.url;

                            if (carPreview) {
                                carPreview.src =
                                    uploaded.url;
                                carPreview.hidden =
                                    false;
                            }

                            if (carStatus) {
                                carStatus.textContent =
                                    'Vehicle photo saved. Submit the vehicle details below for approval.';
                            }

                            carButton.textContent =
                                'Retake car photo';

                        } catch (error) {
                            if (carStatus) {
                                carStatus.textContent =
                                    error?.message ||
                                    'Vehicle photo was not saved.';
                            }

                            carButton.textContent =
                                user.vehiclePhoto
                                    ? 'Retake car photo'
                                    : 'Take car photo';

                        } finally {
                            carButton.disabled =
                                false;
                        }
                    };
            }


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
                        year:
                            Number(
                                data.get(
                                    'year'
                                )
                            ),
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
                            vehiclePending.year
                        ) ||
                        vehiclePending.year <
                            1990 ||
                        vehiclePending.year >
                            2027
                    ) {
                        vehicleStatus.textContent =
                            'Enter a valid four-digit vehicle year.';
                        return;
                    }

                    if (
                        !user.vehiclePhoto
                    ) {
                        vehicleStatus.textContent =
                            'Take and save a clear photo of your car before submitting.';
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

            body.innerHTML = `
                <h2>How can we help?</h2>

                <details class="member-info">
                    <summary>My driver or passenger cannot find me</summary>
                    <p>Use Message on your trip to share a nearby landmark and agree on a safe meeting point.</p>
                </details>

                <details class="member-info">
                    <summary>My payment or fare looks incorrect</summary>
                    <p>Keep your trip reference and the amount shown on the completed-trip receipt.</p>
                </details>

                <details class="member-info">
                    <summary>Map or location is unavailable</summary>
                    <p>Allow location access in your browser or device settings, check your connection, then recenter the map.</p>
                </details>

                <form class="member-support-form" data-support-form>
                    <h3>Send a support ticket</h3>

                    <label>
                        Topic
                        <select data-support-topic>
                            <option value="trip">Trip or booking</option>
                            <option value="payment">Payment or wallet</option>
                            <option value="account">Account or profile</option>
                            <option value="driver">Driver / passenger issue</option>
                            <option value="delivery">Delivery</option>
                            <option value="other">Other</option>
                        </select>
                    </label>

                    <label>
                        Tell us what happened
                        <textarea
                            data-support-message
                            rows="5"
                            maxlength="1500"
                            placeholder="Include your trip reference, amount or other useful details."
                            required
                        ></textarea>
                    </label>

                    <button class="member-primary" type="submit">
                        Send to Asiye Support
                    </button>

                    <p class="member-note" data-support-status>
                        Your ticket will be available to the Asiye support team.
                    </p>
                </form>
            `;

            const supportForm =
                body.querySelector(
                    '[data-support-form]'
                );

            supportForm
                ?.addEventListener(
                    'submit',
                    async event => {
                        event.preventDefault();

                        const authUser =
                            firebase.auth()
                                .currentUser;

                        const statusElement =
                            supportForm
                                .querySelector(
                                    '[data-support-status]'
                                );

                        const button =
                            supportForm
                                .querySelector(
                                    '[type="submit"]'
                                );

                        const topic =
                            supportForm
                                .querySelector(
                                    '[data-support-topic]'
                                )
                                ?.value ||
                            'other';

                        const message =
                            supportForm
                                .querySelector(
                                    '[data-support-message]'
                                )
                                ?.value
                                .trim() ||
                            '';

                        if (
                            !authUser ||
                            !id
                        ) {
                            if (statusElement) {
                                statusElement.textContent =
                                    'Sign in again before contacting support.';
                            }

                            return;
                        }

                        if (
                            message.length < 5
                        ) {
                            if (statusElement) {
                                statusElement.textContent =
                                    'Add a little more detail so support can help.';
                            }

                            return;
                        }

                        if (button) {
                            button.disabled =
                                true;

                            button.textContent =
                                'Sending…';
                        }

                        if (statusElement) {
                            statusElement.textContent =
                                'Sending your ticket…';
                        }

                        try {
                            const ticketRef =
                                firebase
                                    .database()
                                    .ref(
                                        'support_chats'
                                    )
                                    .push();

                            await ticketRef
                                .set({
                                    ticketId:
                                        ticketRef.key,

                                    userId:
                                        id,

                                    authUid:
                                        authUser.uid,

                                    role:
                                        driver
                                            ? 'driver'
                                            : 'passenger',

                                    name:
                                        user.name ||
                                        user.fullName ||
                                        user.firstName ||
                                        (
                                            driver
                                                ? 'Driver'
                                                : 'Passenger'
                                        ),

                                    phone:
                                        user.phone ||
                                        user.phoneNumber ||
                                        authUser.phoneNumber ||
                                        '',

                                    email:
                                        user.email ||
                                        authUser.email ||
                                        '',

                                    subject:
                                        topic,

                                    message:
                                        message,

                                    status:
                                        'open',

                                    createdAt:
                                        firebase
                                            .database
                                            .ServerValue
                                            .TIMESTAMP,

                                    updatedAt:
                                        firebase
                                            .database
                                            .ServerValue
                                            .TIMESTAMP
                                });

                            supportForm
                                .reset();

                            if (statusElement) {
                                statusElement.textContent =
                                    `Ticket ${ticketRef.key.slice(-6)} sent. Asiye Support can now review it.`;
                            }

                        } catch (error) {
                            console.error(
                                'Support ticket could not be sent:',
                                error
                            );

                            if (statusElement) {
                                statusElement.textContent =
                                    'Could not send the ticket. Check your connection and try again.';
                            }

                        } finally {
                            if (button) {
                                button.disabled =
                                    false;

                                button.textContent =
                                    'Send to Asiye Support';
                            }
                        }
                    }
                );

            const email = config?.supportEmail;

            if (
                email &&
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                    .test(
                        email
                    )
            ) {
                body.innerHTML +=
                    `<a class="member-primary member-secondary-support" href="mailto:${encodeURIComponent(email)}">Email support instead</a>`;
            }
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

                    const totals =
                        rides.reduce(
                            (
                                result,
                                ride
                            ) => {
                                const gross =
                                    Number(
                                        ride.driverGrossFare ??
                                        grossFare(ride) ??
                                        0
                                    ) || 0;

                                const commission =
                                    Number(
                                        ride.platformCommission ??
                                        (
                                            gross *
                                            0.20
                                        )
                                    ) || 0;

                                const net =
                                    Number(
                                        ride.driverNetFare ??
                                        (
                                            gross -
                                            commission
                                        )
                                    ) || 0;

                                result.gross +=
                                    gross;

                                result.commission +=
                                    commission;

                                result.net +=
                                    net;

                                return result;
                            },
                            {
                                gross: 0,
                                commission: 0,
                                net: 0
                            }
                        );

                    const commissionDebt =
                        Number(
                            user.commissionDebt ||
                            0
                        ) || 0;

                    html +=
                        `<div class="member-balance"><small>Net completed earnings</small><strong>${this.money(totals.net)}</strong></div>` +
                        `<div class="member-row"><span>Gross fares</span><strong>${this.money(totals.gross)}</strong></div>` +
                        `<div class="member-row"><span>Asiye commission · 20%</span><strong>${this.money(totals.commission)}</strong></div>` +
                        `<div class="member-row"><span>Commission balance due</span><strong>${this.money(commissionDebt)}</strong></div>` +
                        note(
                            'Asiye deducts 20% from every completed Go, Work and Parcel trip. Cash-collected commission is recorded as commission due.'
                        );
                }
                html += note('Showing up to 100 recent records per booking type.');
                if (!rides.length) html += `<div class="member-empty"><h2>No ${page === 'parcels' ? 'parcels' : 'trips'} yet</h2><p>Your records will appear here once available.</p></div>`;
                rides.forEach(ride => {
                    const passenger = ride.passengers?.[id] || {};

                    const fallbackAmount =
                        driver
                            ? (
                                ride.finalAmount ??
                                ride.calculatedPrice ??
                                ride.price
                            )
                            : (
                                passenger.finalAmount ??
                                passenger.price ??
                                ride.finalAmount ??
                                ride.calculatedPrice ??
                                ride.pricePerPassenger ??
                                ride.price
                            );

                    const amount =
                        page === 'earnings' &&
                        driver
                            ? (
                                ride.driverNetFare ??
                                (
                                    Number(
                                        ride.driverGrossFare ??
                                        fallbackAmount ??
                                        0
                                    ) *
                                    0.80
                                )
                            )
                            : fallbackAmount;

                    const stamp =
                        Number(
                            ride.completedAt ||
                            ride.timestamp ||
                            ride.createdAt
                        );

                    const earningsDetails =
                        page === 'earnings' &&
                        driver
                            ? (
                                this.row(
                                    'Gross fare',
                                    this.money(
                                        Number(
                                            ride.driverGrossFare ??
                                            fallbackAmount ??
                                            0
                                        )
                                    )
                                ) +
                                this.row(
                                    'Asiye commission · 20%',
                                    this.money(
                                        Number(
                                            ride.platformCommission ??
                                            (
                                                Number(
                                                    ride.driverGrossFare ??
                                                    fallbackAmount ??
                                                    0
                                                ) *
                                                0.20
                                            )
                                        )
                                    )
                                ) +
                                this.row(
                                    'Driver net',
                                    this.money(
                                        Number(
                                            ride.driverNetFare ??
                                            amount ??
                                            0
                                        )
                                    )
                                )
                            )
                            : '';

                    html += `<details class="member-trip"><summary><span><small>${esc(String(ride.status || 'Booked').replace(/_/g,' '))}</small><strong>${esc(ride.destination || ride.destinationName || ride.dropoffAddress || 'Trip')}</strong></span><b>${this.money(amount)}</b></summary><div>${this.row('Date', stamp && Number.isFinite(stamp) ? new Date(stamp).toLocaleString() : 'Not recorded')}${this.row('Reference',ride.key)}${this.row('Service',ride.type || 'Ride')}${this.row('Payment',passenger.paymentMethod || ride.paymentMethod)}${earningsDetails}</div></details>`;
                });
                body.innerHTML = html;
            } catch (error) {
                body.innerHTML = note('Records could not load. Check your connection and account access.') + '<button class="member-primary">Retry</button>';
                body.querySelector('button').onclick = () => this.open(page);
            }
        }
    }
};


/* ASIYE_MEMBER_PREMIUM_STYLES_V1 */
(() => {
    if (document.getElementById('asiye-member-premium-styles')) return;
    const style = document.createElement('style');
    style.id = 'asiye-member-premium-styles';
    style.textContent = `
    dialog.member-page{width:min(100% - 20px,520px);max-height:92vh;border:0;border-radius:28px;padding:0;background:#f6f7f9;color:#111;box-shadow:0 28px 80px rgba(0,0,0,.28);overflow:hidden}
    dialog.member-page::backdrop{background:rgba(9,13,20,.58);backdrop-filter:blur(5px)}
    .member-page>header{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:20px 22px 16px;background:rgba(255,255,255,.94);backdrop-filter:blur(16px);border-bottom:1px solid #e9ebef}
    .member-page>header small{display:block;font-size:10px;font-weight:900;letter-spacing:.14em;color:#777}
    .member-page>header h1{margin:4px 0 0;font-size:25px;line-height:1.1;letter-spacing:-.03em}
    .member-page>header button{width:40px;height:40px;border:0;border-radius:50%;background:#eef0f3;font-size:25px;line-height:1;cursor:pointer}
    .member-page>main{padding:20px 20px 30px;overflow:auto;max-height:calc(92vh - 78px)}
    .member-page h2{margin:10px 0 18px;font-size:22px;letter-spacing:-.025em}
    .member-page h3{font-size:16px}
    .member-avatar{width:76px;height:76px;border-radius:24px;display:grid;place-items:center;background:#111;color:#fff;font-size:30px;font-weight:900;box-shadow:0 10px 24px rgba(0,0,0,.16);overflow:hidden}
    .member-avatar img{width:100%;height:100%;object-fit:cover}
    .member-row,.member-info,.member-balance,.wallet-topup{background:#fff;border:1px solid #e7e9ed;border-radius:18px;padding:16px;margin:10px 0;box-shadow:0 6px 22px rgba(17,24,39,.045)}
    .member-row{display:flex;justify-content:space-between;gap:20px;align-items:center}
    .member-row span,.member-note{color:#69707d;font-size:12px;line-height:1.55}
    .member-row strong{font-size:13px;text-align:right}
    .member-balance{padding:22px;background:linear-gradient(145deg,#111827,#0b0d11);color:#fff}
    .member-balance small{display:block;color:#b8bec8;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
    .member-balance strong{display:block;margin-top:8px;font-size:32px;letter-spacing:-.04em}
    .member-primary{display:flex;align-items:center;justify-content:center;width:100%;box-sizing:border-box;border:0;border-radius:15px;padding:14px 16px;margin:10px 0;background:#111;color:#fff;text-decoration:none;font-weight:850;font-size:13px;cursor:pointer}
    .member-primary:disabled{opacity:.55}
    .member-data-delete{background:#fff;color:#b42318;border:1px solid #f1d1ce}
    .wallet-topup label{display:block;margin:14px 0 8px;font-size:11px;font-weight:850;color:#343a46}
    .wallet-amounts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
    .wallet-amounts button{border:1px solid #e1e4e9;background:#f7f8fa;border-radius:12px;padding:11px 5px;font-weight:800}
    .wallet-amounts button.selected{background:#111;color:#fff;border-color:#111}
    .wallet-custom,.wallet-phone{display:flex;align-items:center;gap:8px;border:1px solid #dfe3e8;background:#fff;border-radius:14px;padding:0 14px}
    .wallet-custom span,.wallet-phone span{font-weight:850;color:#555}
    .wallet-custom input,.wallet-phone input{min-width:0;flex:1;border:0;outline:0;background:transparent;padding:14px 0;font-size:15px}
    .member-profile-photo-actions{margin-top:16px}
    @media(max-width:420px){dialog.member-page{width:calc(100% - 12px);border-radius:24px}.member-page>main{padding:16px}.wallet-amounts{grid-template-columns:repeat(2,1fr)}}
    `;
    document.head.appendChild(style);
})();

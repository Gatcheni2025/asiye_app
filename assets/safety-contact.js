/* Shared one-time safety contact setup for passenger and driver apps. */
window.AsiyeSafetyContact = {
    _pendingEnsure: null,

    _escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    },

    _context(role = null) {
        const isDriver =
            role === 'driver' ||
            (
                role !== 'passenger' &&
                !!window.ASIYE_DRIVER?.state?.driverId
            );

        const app = isDriver
            ? window.ASIYE_DRIVER
            : window.ASIYE;

        const id = isDriver
            ? app?.state?.driverId
            : app?.state?.userId;

        if (!app || !id || !window.firebase?.apps?.length) {
            return null;
        }

        return {
            app,
            id,
            role: isDriver ? 'driver' : 'passenger',
            root: isDriver ? 'taxis' : 'commuters'
        };
    },

    normalizePhone(rawPhone) {
        let digits = String(rawPhone || '').replace(/\D/g, '');

        if (!digits) return null;

        if (digits.startsWith('0') && digits.length === 10) {
            digits = '27' + digits.slice(1);
        }

        if (digits.startsWith('27') && digits.length === 11) {
            return '+' + digits;
        }

        if (digits.length >= 7 && digits.length <= 15) {
            return '+' + digits;
        }

        return null;
    },

    async getMembers(context = null) {
        const ctx = context || this._context();
        if (!ctx) return [];

        const snapshot = await firebase
            .database()
            .ref(`${ctx.root}/${ctx.id}/familyMembers`)
            .once('value');

        const members = [];

        snapshot.forEach(child => {
            members.push({
                id: child.key,
                ...(child.val() || {})
            });
        });

        return members;
    },

    async getPrimary(context = null) {
        const members = await this.getMembers(context);

        return (
            members.find(member => member.isPrimary === true) ||
            members[0] ||
            null
        );
    },

    async _markCompleted(ctx) {
        try {
            await firebase
                .database()
                .ref(`${ctx.root}/${ctx.id}`)
                .update({
                    safetyContactSetupCompleted: true,
                    safetyContactCompletedAt:
                        firebase.database.ServerValue.TIMESTAMP
                });
        } catch (error) {
            console.warn(
                'Could not update safety setup marker:',
                error?.code || error
            );
        }
    },

    async saveMember({
        name,
        relationship,
        phone,
        context = null,
        primary = false
    }) {
        const ctx = context || this._context();

        if (!ctx) {
            throw new Error(
                'Your account is still loading. Please try again.'
            );
        }

        const cleanName = String(name || '').trim();
        const cleanRelationship =
            String(relationship || '').trim();
        const cleanPhone = this.normalizePhone(phone);

        if (cleanName.length < 2) {
            throw new Error(
                'Enter your family member’s full name.'
            );
        }

        if (cleanRelationship.length < 2) {
            throw new Error(
                'Choose your relationship to this person.'
            );
        }

        if (!cleanPhone) {
            throw new Error(
                'Enter a valid mobile number.'
            );
        }

        const members = await this.getMembers(ctx);

        const duplicate = members.find(
            member =>
                this.normalizePhone(member.phone) === cleanPhone
        );

        if (duplicate) {
            await this._markCompleted(ctx);
            return duplicate;
        }

        const ref = firebase
            .database()
            .ref(`${ctx.root}/${ctx.id}/familyMembers`)
            .push();

        const record = {
            name: cleanName,
            relationship: cleanRelationship,
            phone: cleanPhone,
            isPrimary: primary || members.length === 0,
            safetyContact: true,
            accountRole: ctx.role,
            addedAt:
                firebase.database.ServerValue.TIMESTAMP
        };

        await ref.set(record);
        await this._markCompleted(ctx);

        return {
            id: ref.key,
            ...record
        };
    },

    _removeModal() {
        document
            .querySelector('.asiye-safety-modal-layer')
            ?.remove();

        document.body.classList.remove(
            'asiye-safety-modal-open'
        );
    },

    _createLayer(html) {
        this._removeModal();

        const layer = document.createElement('div');

        layer.className =
            'asiye-safety-modal-layer';

        layer.innerHTML = html;

        document.body.appendChild(layer);

        document.body.classList.add(
            'asiye-safety-modal-open'
        );

        return layer;
    },

    async _showRequiredSetup(ctx) {
        return new Promise(resolve => {
            const layer = this._createLayer(`
                <section
                    class="asiye-safety-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="asiyeSafetyTitle"
                >
                    <div class="asiye-safety-shield">
                        <i class="fas fa-shield-halved"></i>
                    </div>

                    <div class="asiye-safety-kicker">
                        ASIYE SAFETY
                    </div>

                    <h2 id="asiyeSafetyTitle">
                        Add a trusted family member
                    </h2>

                    <p class="asiye-safety-copy">
                        For your safety, every passenger and driver
                        must save one trusted contact once before
                        using Asiye rides.
                    </p>

                    <div class="asiye-safety-note">
                        <i class="fas fa-lock"></i>
                        <span>
                            You will not be asked again after this
                            contact is saved. Only add someone who
                            has agreed to be your safety contact.
                        </span>
                    </div>

                    <form
                        class="asiye-safety-form"
                        data-safety-contact-form
                    >
                        <label>
                            Full name
                            <input
                                name="name"
                                autocomplete="name"
                                maxlength="80"
                                placeholder="e.g. Nomsa Ndlovu"
                                required
                            >
                        </label>

                        <label>
                            Relationship
                            <select
                                name="relationship"
                                required
                            >
                                <option value="">
                                    Choose relationship
                                </option>
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
                                autocomplete="tel"
                                maxlength="24"
                                placeholder="082 123 4567"
                                required
                            >
                        </label>

                        <p
                            class="asiye-safety-error"
                            data-safety-error
                            role="alert"
                            hidden
                        ></p>

                        <button
                            class="asiye-safety-primary"
                            type="submit"
                        >
                            Save & continue
                        </button>
                    </form>
                </section>
            `);

            const form = layer.querySelector(
                '[data-safety-contact-form]'
            );

            const errorBox = layer.querySelector(
                '[data-safety-error]'
            );

            form.onsubmit = async event => {
                event.preventDefault();

                const button = form.querySelector(
                    '[type="submit"]'
                );

                button.disabled = true;
                button.textContent =
                    'Saving safety contact…';

                errorBox.hidden = true;

                try {
                    await this.saveMember({
                        context: ctx,
                        name:
                            form.elements.name.value,
                        relationship:
                            form.elements.relationship.value,
                        phone:
                            form.elements.phone.value,
                        primary: true
                    });

                    this._removeModal();

                    ctx.app?.ui?.toast?.(
                        'Safety contact saved.'
                    );

                    resolve(true);
                } catch (error) {
                    errorBox.textContent =
                        error?.message ||
                        'Unable to save your safety contact. Check your connection and try again.';

                    errorBox.hidden = false;
                    button.disabled = false;
                    button.textContent =
                        'Save & continue';
                }
            };

            setTimeout(
                () => form.elements.name?.focus(),
                80
            );
        });
    },

    async ensure({
        role = null
    } = {}) {
        const ctx = this._context(role);

        if (!ctx) return false;

        try {
            const members =
                await this.getMembers(ctx);

            if (members.length) {
                await this._markCompleted(ctx);
                return true;
            }
        } catch (error) {
            console.warn(
                'Safety contact check failed:',
                error?.code || error
            );
        }

        if (!this._pendingEnsure) {
            this._pendingEnsure =
                this._showRequiredSetup(ctx)
                    .finally(() => {
                        this._pendingEnsure = null;
                    });
        }

        return this._pendingEnsure;
    },

    async _shareTrip(requestId) {
        const url =
            `https://asiye.cloud/track.html?trip=${encodeURIComponent(requestId)}`;

        const text =
            `Follow my Asiye trip live: ${url}`;

        if (
            window.AsiyeNativeAuth?.post({
                action: 'share',
                text
            })
        ) {
            return true;
        }

        if (navigator.share) {
            await navigator.share({
                title: 'My Asiye trip',
                text,
                url
            });

            return true;
        }

        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }

        return false;
    },

    async offerTripShare(
        requestId,
        {
            role = 'passenger'
        } = {}
    ) {
        if (!requestId) return false;

        const ready =
            await this.ensure({ role });

        if (!ready) return false;

        const ctx = this._context(role);
        const primary =
            await this.getPrimary(ctx);

        const name =
            primary?.name ||
            'your trusted contact';

        return new Promise(resolve => {
            const layer = this._createLayer(`
                <section
                    class="asiye-safety-modal asiye-safety-share"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="asiyeShareTitle"
                >
                    <div class="asiye-safety-shield">
                        <i class="fas fa-location-dot"></i>
                    </div>

                    <div class="asiye-safety-kicker">
                        LIVE TRIP SAFETY
                    </div>

                    <h2 id="asiyeShareTitle">
                        Share your live trip?
                    </h2>

                    <p class="asiye-safety-copy">
                        ${this._escape(name)} is saved as your
                        trusted safety contact. You can share
                        your live trip now.
                    </p>

                    <div class="asiye-safety-actions">
                        <button
                            type="button"
                            class="asiye-safety-secondary"
                            data-share-later
                        >
                            Not now
                        </button>

                        <button
                            type="button"
                            class="asiye-safety-primary"
                            data-share-now
                        >
                            <i class="fas fa-share-nodes"></i>
                            Share trip
                        </button>
                    </div>
                </section>
            `);

            layer.querySelector(
                '[data-share-later]'
            ).onclick = () => {
                this._removeModal();
                resolve(false);
            };

            layer.querySelector(
                '[data-share-now]'
            ).onclick = async event => {
                const button =
                    event.currentTarget;

                button.disabled = true;
                button.textContent =
                    'Opening share…';

                try {
                    const shared =
                        await this._shareTrip(
                            requestId
                        );

                    this._removeModal();
                    resolve(shared);
                } catch (error) {
                    if (
                        error?.name ===
                        'AbortError'
                    ) {
                        this._removeModal();
                        resolve(false);
                        return;
                    }

                    button.disabled = false;
                    button.innerHTML =
                        '<i class="fas fa-share-nodes"></i> Share trip';

                    ctx?.app?.ui?.toast?.(
                        'Unable to open sharing right now.'
                    );
                }
            };
        });
    }
};

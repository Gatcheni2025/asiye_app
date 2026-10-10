/* ============================================================
   ASIYE DRIVER V2 — PROTECTED GO FARE NEGOTIATION UI
   ============================================================ */

window.ASIYE_DRIVER =
    window.ASIYE_DRIVER || {};

ASIYE_DRIVER.goNegotiation = {

    isProtectedGo(request) {
        return Boolean(
            request &&
            request.type !==
                'club' &&
            request.type !==
                'delivery' &&
            String(
                request.rideType ||
                'go'
            ) ===
                'go' &&
            request.negotiationEnabled ===
                true
        );
    },


    money(value) {
        const number =
            Number(
                value || 0
            );

        return Number.isFinite(
            number
        )
            ? number.toFixed(2)
            : '0.00';
    },


    decorateIncomingRequest(
        request,
        content
    ) {

        if (
            !this.isProtectedGo(
                request
            ) ||
            !content ||
            request.fareStatus ===
                'agreed'
        ) {
            return;
        }


        const passengerOffer =
            Math.round(
                Number(
                    request.passengerOffer ||
                    request.finalAmount ||
                    request.calculatedPrice ||
                    0
                )
            );


        const maximum =
            Math.max(
                passengerOffer,
                Math.floor(
                    Number(
                        request.maximumFareOffer ||
                        passengerOffer
                    )
                )
            );


        const commissionRate =
            Number(
                request.commissionRate ||
                0.20
            );


        const asiyeCommission =
            Number(
                request.platformCommission ??
                (
                    passengerOffer *
                    commissionRate
                )
            );


        const driverReceives =
            Number(
                request.driverNetFare ??
                (
                    passengerOffer -
                    asiyeCommission
                )
            );


        const panel =
            document.createElement(
                'div'
            );


        panel.className =
            'driver-go-negotiation';


        const suggestedCounter =
            Math.min(
                maximum,
                Math.max(
                    passengerOffer,
                    passengerOffer + 5
                )
            );


        panel.innerHTML = `
            <div class="driver-go-negotiation-title">
                Protected Asiye Go fare
            </div>

            <div class="driver-go-negotiation-summary">
                <div>
                    <span>Passenger offer</span>
                    <strong>
                        R${passengerOffer.toFixed(0)}
                    </strong>
                </div>

                <div>
                    <span>Asiye ${Math.round(
                        commissionRate *
                        100
                    )}%</span>
                    <strong>
                        R${this.money(
                            asiyeCommission
                        )}
                    </strong>
                </div>

                <div>
                    <span>You receive</span>
                    <strong>
                        R${this.money(
                            driverReceives
                        )}
                    </strong>
                </div>
            </div>

            <div class="driver-go-negotiation-copy">
                Accept the passenger offer, or counter between
                <strong>
                    R${passengerOffer.toFixed(0)}
                </strong>
                and
                <strong>
                    R${maximum.toFixed(0)}
                </strong>.
                The server will reject anything outside this protected range.
            </div>

            <div class="driver-go-counter-row">
                <span>R</span>

                <input
                    id="driverCounterFareInput"
                    type="number"
                    inputmode="decimal"
                    min="${passengerOffer}"
                    max="${maximum}"
                    step="1"
                    value="${suggestedCounter}"
                    aria-label="Driver counter fare"
                >

                <button
                    id="counterFareButton"
                    type="button"
                    class="driver-btn driver-btn-secondary"
                    ${passengerOffer >= maximum
                        ? 'disabled'
                        : ''}
                >
                    Counter
                </button>
            </div>

            <small>
                No payment is taken until the fare is agreed.
            </small>
        `;


        content.appendChild(
            panel
        );


        const acceptButton =
            document.getElementById(
                'acceptRequestButton'
            );


        if (acceptButton) {
            acceptButton.textContent =
                `Accept R${passengerOffer.toFixed(0)}`;
        }


        const counterButton =
            document.getElementById(
                'counterFareButton'
            );


        counterButton
            ?.addEventListener(
                'click',
                async event => {

                    const button =
                        event.currentTarget;

                    const input =
                        document.getElementById(
                            'driverCounterFareInput'
                        );

                    const amount =
                        Math.round(
                            Number(
                                input?.value
                            )
                        );


                    if (
                        !Number.isFinite(
                            amount
                        ) ||
                        amount <
                            passengerOffer ||
                        amount >
                            maximum
                    ) {

                        ASIYE_DRIVER.ui
                            ?.toast?.(
                                `Counter between R${passengerOffer} and R${maximum}.`,
                                'danger'
                            );

                        return;
                    }


                    button.disabled =
                        true;

                    button.textContent =
                        'Sending...';


                    try {

                        await ASIYE_DRIVER.requests
                            .counterFare(
                                amount,
                                request.requestId ||
                                request.key
                            );


                        ASIYE_DRIVER.ui
                            ?.closeIncomingRequest?.();


                    } catch (error) {

                        console.error(
                            'Counter fare failed:',
                            error
                        );


                        ASIYE_DRIVER.ui
                            ?.toast?.(
                                error.message ||
                                'Could not send counter offer.',
                                'danger'
                            );


                        button.disabled =
                            false;

                        button.textContent =
                            'Counter';
                    }
                }
            );
    }
};

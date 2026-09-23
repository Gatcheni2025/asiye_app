/* Passenger wallet top-ups via manual EFT instructions sent by Twilio SMS. */
window.ASIYE = window.ASIYE || {};

ASIYE.wallet = {
    createTopupUrl:
        'https://us-central1-asiye-80386.cloudfunctions.net/createEftSmsTopup',

    async startTopup(amount, phone = null) {
        const value =
            Number(amount);

        if (
            !Number.isFinite(value) ||
            value < 10 ||
            value > 5000
        ) {
            throw new Error(
                'Enter an amount between R10 and R5,000.'
            );
        }

        const user =
            firebase.auth()
                .currentUser;

        if (!user) {
            throw new Error(
                'Sign in again before adding funds.'
            );
        }

        const token =
            await user
                .getIdToken();

        const bodyData = {
            amount: value.toFixed(2)
        };
        if (phone) {
            bodyData.phone = phone;
        }

        const response =
            await fetch(
                this.createTopupUrl,
                {
                    method:
                        'POST',

                    headers: {
                        'Authorization':
                            `Bearer ${token}`,

                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify(bodyData)
                }
            );

        const payment =
            await response
                .json()
                .catch(
                    () => ({})
                );

        if (
            !response.ok ||
            !payment.ok
        ) {
            throw new Error(
                payment.error ||
                'Unable to send the EFT banking details.'
            );
        }

        return payment;
    }
};

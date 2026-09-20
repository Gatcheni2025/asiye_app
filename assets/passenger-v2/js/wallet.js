/* Passenger wallet top-ups. Ozow credentials stay server-side. */
window.ASIYE = window.ASIYE || {};

ASIYE.wallet = {
    createTopupUrl:
        'https://us-central1-asiye-80386.cloudfunctions.net/createOzowWalletTopup',

    async startTopup(amount) {
        const value = Number(amount);

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
            firebase.auth().currentUser;

        if (!user) {
            throw new Error(
                'Sign in again before adding funds.'
            );
        }

        const token =
            await user.getIdToken();

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
                        JSON.stringify({
                            amount:
                                value.toFixed(2)
                        })
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
            !payment.redirectUrl
        ) {
            throw new Error(
                payment.error ||
                'Unable to open the EFT payment.'
            );
        }

        /*
         * Keep Ozow inside the Asiye WebView. Banking-app links from
         * the hosted page are handed to the phone by Flutter when
         * required. Ozow returns to ozowWalletReturn, which Flutter
         * intercepts and loads the Asiye app again.
         */
        window.location.href =
            payment.redirectUrl;
    }
};

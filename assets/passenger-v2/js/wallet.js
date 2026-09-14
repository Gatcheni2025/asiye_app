/* Passenger wallet top-ups. PayFast credentials and signatures stay server-side. */
window.ASIYE = window.ASIYE || {};

ASIYE.wallet = {
    createTopupUrl:
        'https://us-central1-asiye-80386.cloudfunctions.net/createPayfastWalletTopup',

    async startTopup(amount) {
        const value = Number(amount);
        if (!Number.isFinite(value) || value < 10 || value > 5000) {
            throw new Error('Enter an amount between R10 and R5,000.');
        }

        const user = firebase.auth().currentUser;
        if (!user) {
            throw new Error('Sign in again before adding funds.');
        }

        const token = await user.getIdToken();
        const response = await fetch(this.createTopupUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ amount: value.toFixed(2) })
        });

        const payment = await response.json().catch(() => ({}));
        if (!response.ok || !payment.action || !payment.fields) {
            throw new Error(payment.error || 'Unable to connect to PayFast Sandbox.');
        }

        const form = document.createElement('form');
        form.method = 'POST';
        form.action = payment.action;
        Object.entries(payment.fields).forEach(([name, value]) => {
            const field = document.createElement('input');
            field.type = 'hidden';
            field.name = name;
            field.value = String(value);
            form.appendChild(field);
        });
        document.body.appendChild(form);
        form.submit();
    }
};

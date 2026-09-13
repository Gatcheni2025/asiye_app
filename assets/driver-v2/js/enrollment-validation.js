window.EnrollmentValidation = {
    phone(value) {
        const text = String(value || '').trim();
        const digits = text.replace(/\D/g, '');
        return /^\+?[0-9 ()-]+$/.test(text) && digits.length >= 7 && digits.length <= 15;
    },
    phoneKey(value) {
        const digits = String(value).replace(/\D/g, '');
        return digits.length === 10 && digits.startsWith('0') ? '27' + digits.slice(1) : digits;
    }
};

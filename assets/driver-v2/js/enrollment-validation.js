window.EnrollmentValidation = {
    references(data) {
        return Object.fromEntries([1, 2, 3].map(i => [`reference${i}`, {
            name: String(data.get(`refName${i}`) || '').trim(),
            phone: String(data.get(`refPhone${i}`) || '').trim(),
            relationship: String(data.get(`refRelation${i}`) || '').trim()
        }]));
    },
    async licenceType(file) {
        if (!file || !file.size || file.size > 10 * 1024 * 1024) return null;
        const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        const starts = values => values.every((value, i) => bytes[i] === value);
        if (starts([37, 80, 68, 70, 45])) return 'application/pdf';
        if (starts([255, 216, 255])) return 'image/jpeg';
        if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
        if (starts([82, 73, 70, 70]) && [87, 69, 66, 80].every((value, i) => bytes[i + 8] === value)) return 'image/webp';
        return null;
    },
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
